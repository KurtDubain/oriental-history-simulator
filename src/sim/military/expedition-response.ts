import { keyedRandom, stableCompare } from '../random';
import { emitSimulationFact, projectFactLinks } from '../facts';
import type { CharacterState, HistoryEvent, RelationshipState, WorldState } from '../types';
import type { MutableTurnContext } from '../turn-context-state';
import { addBiography } from '../v02';
import type { V03EventInput } from '../v03-context';
import { personalForce } from './personal-forces';

export type ExpeditionResponseOutcome = 'responded' | 'stayed' | 'refused';
export interface ExpeditionResponseDecision {
  characterId: string;
  outcome: ExpeditionResponseOutcome;
  publicRefusal: boolean;
  reason: string;
}
export interface ExpeditionResponseSelection {
  participantIds: string[];
  decisions: ExpeditionResponseDecision[];
  notableStayerIds: string[];
}

function relation(world: WorldState, sourceId: string, targetId: string): RelationshipState | undefined {
  return world.relationships.find((item) => item.sourceId === sourceId && item.targetId === targetId);
}

export function isAvailableForExpedition(
  world: Pick<WorldState, 'characters' | 'personalForces'>,
  polityId: string,
  character: CharacterState,
): boolean {
  const force = personalForce(world, character.id);
  return character.alive && character.polityId === polityId
    && Boolean(force?.soldiers && force.formationId === null)
    && !character.commandingArmyId && !character.commandingFleetId;
}

/** The commander brings their whole force; a bounded relationship roll chooses up to four companions. */
export function selectExpeditionResponses(
  world: WorldState,
  polity: WorldState['polities'][number],
  commander: CharacterState,
  region: WorldState['regions'][number],
): ExpeditionResponseSelection {
  const war = world.wars.find((item) => item.active && (item.attackerId === polity.id || item.defenderId === polity.id));
  const candidates = world.characters.filter((item) => item.id !== commander.id && isAvailableForExpedition(world, polity.id, item))
    .map((character) => {
      const force = personalForce(world, character.id)!;
      const tie = relation(world, character.id, commander.id);
      const sameFaction = Boolean(character.factionId && character.factionId === commander.factionId);
      const kin = character.familyId === commander.familyId || character.spouseIds.includes(commander.id)
        || character.parentIds.includes(commander.id) || commander.parentIds.includes(character.id);
      const front = Boolean(war?.targetRegionIds.some((id) => id === character.governedRegionId
        || id === force.homeRegionId || id === character.locationRegionId));
      const duty = character.id === polity.rulerId ? 22 : character.governedRegionId ? 12
        : character.locationRegionId === polity.capitalRegionId ? 7 : 0;
      const hostile = (tie?.grievance ?? 0) >= 58 || ((tie?.trust ?? 40) <= 20 && character.loyalty <= 34)
        || character.insubordination >= 68;
      const score = 31 + (character.locationRegionId === region.id ? 18 : 0) + (sameFaction ? 15 : 0)
        + (kin ? 10 : 0) + (front ? 11 : 0) + ((tie?.trust ?? 40) - 40) * .38
        + (tie?.gratitude ?? 0) * .13 + (tie?.affinity ?? 0) * .1 - (tie?.grievance ?? 0) * .46
        + (character.loyalty - 50) * .18 + (force.readiness - 50) * .12 - duty
        - Math.max(0, character.ambition - 76) * .08 - character.insubordination * .08
        + (keyedRandom(world.seed, world.turn, 'expedition-response', commander.id, character.id, region.id) - .5) * 12;
      const reason = hostile ? '与主将积怨或离心' : duty >= 12 ? '另有守土或中枢职责'
        : sameFaction ? '同属一系' : kin ? '家门相连' : tie && tie.trust >= 70 ? '彼此信任' : front ? '自身根基牵涉战线' : '衡量军令与自身处境';
      return { character, hostile, reason, score };
    }).sort((left, right) => right.score - left.score || stableCompare(left.character.id, right.character.id));
  const participantIds = [commander.id];
  const decisions: ExpeditionResponseDecision[] = [];
  const factionCounts = new Map<string, number>();
  for (const item of candidates) {
    const factionId = item.character.factionId;
    const concentration = factionId ? factionCounts.get(factionId) ?? 0 : 0;
    const adjusted = item.score - concentration * 17;
    const joins = participantIds.length < 5 && adjusted >= 50;
    const publicRefusal = !joins && item.hostile && adjusted < 22;
    decisions.push({ characterId: item.character.id, outcome: joins ? 'responded' : publicRefusal ? 'refused' : 'stayed', publicRefusal, reason: item.reason });
    if (joins) {
      participantIds.push(item.character.id);
      if (factionId) factionCounts.set(factionId, concentration + 1);
    }
  }
  return { participantIds, decisions, notableStayerIds: decisions.filter((item) => item.outcome !== 'responded').slice(0, 2).map((item) => item.characterId) };
}

export function recordPublicExpeditionRefusal(
  world: WorldState,
  context: MutableTurnContext,
  selection: ExpeditionResponseSelection,
  army: WorldState['armies'][number],
  commander: CharacterState,
  region: WorldState['regions'][number],
  emit: (input: V03EventInput) => HistoryEvent,
): void {
  const decision = selection.decisions.find((item) => item.publicRefusal);
  const refuser = decision && world.characters.find((item) => item.id === decision.characterId);
  if (!decision || !refuser) return;
  const regionIds = [...new Set([refuser.locationRegionId, region.id])];
  const causes = [
    { label: '征召关系', role: '结构' as const, weight: .6, evidence: `${commander.name}召集本国人物随军` },
    { label: '公开拒令', role: '结果' as const, weight: .4, evidence: `${refuser.name}因${decision.reason}留守，${personalForce(world, refuser.id)?.soldiers ?? 0}人部曲未入${army.name}` },
  ];
  const fact = emitSimulationFact(world, context, {
    kind: 'expedition_response', category: '军事', importance: refuser.influence >= 60 || refuser.factionId ? 2 : 1,
    actorIds: [refuser.id, commander.id], polityIds: [army.polityId], regionIds, causes, stateDeltas: [], sourceFactIds: [],
    payload: { characterId: refuser.id, commanderId: commander.id, armyId: army.id, polityId: army.polityId, outcome: 'refused', reason: decision.reason },
  });
  addBiography(refuser, emit({
    category: '军事', kind: 'expedition_refused', title: `${refuser.name}拒绝随${commander.name}出征`,
    summary: `${commander.name}在${region.name}集结${army.name}时，${refuser.name}因${decision.reason}公开留守，其部曲与所在地均未改变。`,
    importance: fact.importance, actorIds: [refuser.id, commander.id], polityIds: [army.polityId], regionIds, causes, stateDeltas: [], ...projectFactLinks(fact),
  }), '拒绝出征');
}

export function expeditionAssemblyText(world: WorldState, selection: ExpeditionResponseSelection): string {
  const names = (ids: readonly string[]) => ids.map((id) => world.characters.find((item) => item.id === id)?.name).filter(Boolean).join('、');
  const responders = names(selection.participantIds.slice(1));
  const stayers = names(selection.notableStayerIds);
  return `${responders ? `；${responders}响应随征` : ''}${stayers ? `，${stayers}留守` : ''}`;
}

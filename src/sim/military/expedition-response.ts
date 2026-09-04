import { keyedRandom, stableCompare } from '../random';
import { emitSimulationFact, projectFactLinks } from '../facts';
import type { CharacterState, HistoryEvent, StateDelta, WorldState } from '../types';
import type { MutableTurnContext } from '../turn-context-state';
import { addBiography, ensureRelationship, remember as rememberRelationship } from '../v02';
import type { V03EventInput } from '../v03-context';
import { isBattleReadyCharacter } from './battle-readiness';
import { personalForce } from './personal-forces';

export type ExpeditionResponseOutcome = 'responded' | 'stayed' | 'refused';
export interface ExpeditionResponseDecision {
  characterId: string;
  outcome: ExpeditionResponseOutcome;
  reason: string;
  priority: number;
}
export interface ExpeditionResponseSelection {
  participantIds: string[];
  decisions: ExpeditionResponseDecision[];
}

function relation(world: WorldState, sourceId: string, targetId: string) {
  return world.relationships.find((item) => item.sourceId === sourceId && item.targetId === targetId);
}

function hasRecentJointBattle(world: WorldState, leftId: string, rightId: string): boolean {
  return world.facts.some((fact) => fact.kind === 'battle' && fact.turn >= world.turn - 8
    && fact.actorIds.includes(leftId) && fact.actorIds.includes(rightId));
}

function isKin(left: CharacterState, right: CharacterState): boolean {
  return left.familyId === right.familyId || left.spouseIds.includes(right.id)
    || left.parentIds.includes(right.id) || right.parentIds.includes(left.id);
}

export function isAvailableForExpedition(
  world: Pick<WorldState, 'characters' | 'personalForces' | 'facts' | 'turn'>,
  polityId: string,
  character: CharacterState,
): boolean {
  const force = personalForce(world, character.id);
  return character.alive && character.polityId === polityId && isBattleReadyCharacter(world, character)
    && Boolean(force?.soldiers && force.formationId === null)
    && !character.commandingArmyId && !character.commandingFleetId;
}

/** Resolve only people tied to this commander, place or front. Clear duties win outright; chance only breaks conflicted motives. */
export function selectExpeditionResponses(
  world: WorldState,
  polity: WorldState['polities'][number],
  commander: CharacterState,
  region: WorldState['regions'][number],
): ExpeditionResponseSelection {
  const war = world.wars.find((item) => item.active && (item.attackerId === polity.id || item.defenderId === polity.id));
  const decisions = world.characters
    .filter((item) => item.id !== commander.id && isAvailableForExpedition(world, polity.id, item))
    .map((character): ExpeditionResponseDecision | null => {
      const force = personalForce(world, character.id)!;
      const tie = relation(world, character.id, commander.id);
      const sameFaction = Boolean(character.factionId && character.factionId === commander.factionId);
      const kin = isKin(character, commander);
      const jointBattle = hasRecentJointBattle(world, character.id, commander.id);
      const front = Boolean(war?.targetRegionIds.some((id) => id === character.governedRegionId
        || id === force.homeRegionId || id === character.locationRegionId));
      const samePlace = character.locationRegionId === region.id;
      const trusted = (tie?.trust ?? 40) >= 68 || (tie?.gratitude ?? 0) >= 48;
      const hostile = ((tie?.grievance ?? 0) >= 52 && (tie?.trust ?? 40) <= 42)
        || ((tie?.trust ?? 40) <= 26 && character.loyalty <= 48)
        || (character.insubordination >= 68 && character.loyalty <= 42);
      const rulerDuty = character.id === polity.rulerId;
      const localDuty = Boolean(character.governedRegionId && character.governedRegionId !== region.id && !front);
      const capitalDuty = character.locationRegionId === polity.capitalRegionId && region.id !== polity.capitalRegionId
        && character.influence >= 65 && !front;
      const relevant = samePlace || sameFaction || kin || jointBattle || trusted || hostile || front || rulerDuty || localDuty;
      if (!relevant) return null;

      if (hostile && (samePlace || sameFaction || kin) && !front) return {
        characterId: character.id, outcome: 'refused',
        reason: tie && tie.grievance >= 52 ? '与主将旧怨未解' : '不肯把部曲交由主将节制', priority: 1,
      };

      if (rulerDuty && !front) return { characterId: character.id, outcome: 'stayed', reason: '须坐镇国中', priority: 0 };
      if (localDuty) return { characterId: character.id, outcome: 'stayed', reason: '所守地方不在此路', priority: 0 };
      if (capitalDuty && character.caution >= 58) return { characterId: character.id, outcome: 'stayed', reason: '须留守中枢', priority: 0 };

      if (jointBattle && !hostile) return { characterId: character.id, outcome: 'responded', reason: '曾与主将共同临阵', priority: 0 };
      if (kin && trusted) return { characterId: character.id, outcome: 'responded', reason: '家门相连且彼此信任', priority: 1 };
      if (trusted && (samePlace || sameFaction)) return {
        characterId: character.id, outcome: 'responded',
        reason: sameFaction ? '同系且素有信任' : '虽非同系但愿再共战', priority: 1,
      };
      if (front && character.caution < 76) return { characterId: character.id, outcome: 'responded',
        reason: hostile ? '虽与主将有隙，仍以守土为先' : '自身根基正受战线牵动', priority: 2 };

      const roll = keyedRandom(world.seed, world.turn, 'expedition-grey-choice', commander.id, character.id, region.id);
      let joins: boolean;
      let reason: string;
      if (character.caution >= Math.max(character.ambition, character.loyalty)) {
        joins = front || (samePlace && force.readiness >= 65 && roll < .34);
        reason = joins ? '确认战线牵动自身后响应' : '谨慎保全部曲';
      } else if (character.ambition >= Math.max(character.caution, character.loyalty)) {
        joins = (commander.renown >= 58 || front) && roll < (sameFaction ? .58 : .38);
        reason = joins ? '愿借此役争取功名' : '不愿把本部押在此役';
      } else {
        joins = character.loyalty >= 62 && roll < (samePlace ? .62 : .4);
        reason = joins ? '看重军令与旧日情分' : '情分未足以离开本地';
      }
      return { characterId: character.id, outcome: joins ? 'responded' : 'stayed', reason, priority: 3 };
    })
    .filter((item): item is ExpeditionResponseDecision => Boolean(item));

  const responders = decisions.filter((item) => item.outcome === 'responded')
    .sort((left, right) => left.priority - right.priority
      || keyedRandom(world.seed, world.turn, 'expedition-order', commander.id, left.characterId)
      - keyedRandom(world.seed, world.turn, 'expedition-order', commander.id, right.characterId)
      || stableCompare(left.characterId, right.characterId))
    .slice(0, 4);
  const accepted = new Set(responders.map((item) => item.characterId));
  for (const item of decisions) if (item.outcome === 'responded' && !accepted.has(item.characterId)) {
    item.outcome = 'stayed';
    item.reason = '此行营人手已足，仍留本地待命';
  }
  return { participantIds: [commander.id, ...responders.map((item) => item.characterId)], decisions };
}

function applyRefusalConsequence(world: WorldState, decision: ExpeditionResponseDecision, commander: CharacterState): StateDelta[] {
  const person = world.characters.find((item) => item.id === decision.characterId)!;
  const tie = ensureRelationship(world, commander.id, person.id);
  const before = { trust: tie.trust, grievance: tie.grievance };
  rememberRelationship(world, commander.id, person.id, '背叛', 14, `${person.name}公开拒绝随征`, null);
  return (['trust', 'grievance'] as const).map((field) => ({
    entityType: 'relationship', entityId: tie.id, field, before: before[field], after: tie[field], delta: tie[field] - before[field],
  }));
}

export function recordPublicExpeditionRefusals(
  world: WorldState,
  context: MutableTurnContext,
  selection: ExpeditionResponseSelection,
  army: WorldState['armies'][number],
  commander: CharacterState,
  region: WorldState['regions'][number],
  emit: (input: V03EventInput) => HistoryEvent,
): void {
  const decision = selection.decisions.find((item) => item.outcome === 'refused');
  const person = decision && world.characters.find((item) => item.id === decision.characterId);
  if (decision && person) {
    const stateDeltas = applyRefusalConsequence(world, decision, commander);
    const summary = `${person.name}因${decision.reason}拒绝加入${army.name}，本部${personalForce(world, person.id)?.soldiers ?? 0}人留守；双方关系随之转冷。`;
    const causes = [{ label: '公开拒令', role: '结果' as const, weight: 1, evidence: summary }];
    const fact = emitSimulationFact(world, context, {
      kind: 'expedition_response', category: '军事', importance: person.influence >= 60 || person.factionId ? 2 : 1,
      actorIds: [person.id, commander.id], polityIds: [army.polityId], regionIds: [...new Set([person.locationRegionId, region.id])],
      causes, stateDeltas, sourceFactIds: [],
      payload: { characterId: person.id, commanderId: commander.id, armyId: army.id, polityId: army.polityId,
        outcome: 'refused', reason: decision.reason },
    });
    const event = emit({
      category: '军事', kind: 'expedition_refused', title: `${person.name}拒绝随${commander.name}出征`,
      summary: `${commander.name}在${region.name}集结时，${summary}`,
      importance: fact.importance, actorIds: [person.id, commander.id], polityIds: [army.polityId], regionIds: fact.regionIds,
      causes, stateDeltas, ...projectFactLinks(fact),
    });
    const tie = relation(world, commander.id, person.id);
    const memory = tie?.memories.at(-1);
    if (memory?.turn === world.turn && memory.eventId === null) memory.eventId = event.id;
    addBiography(person, event, '拒绝出征');
  }
}

export function expeditionAssemblyText(world: WorldState, selection: ExpeditionResponseSelection): string {
  const names = (ids: readonly string[]) => ids.map((id) => world.characters.find((item) => item.id === id)?.name).filter(Boolean).join('、');
  const responders = names(selection.participantIds.slice(1));
  const stayers = names(selection.decisions.filter((item) => item.outcome === 'refused'
    || item.outcome === 'stayed' && item.priority === 0).slice(0, 2).map((item) => item.characterId));
  return `${responders ? `；${responders}响应随征` : ''}${stayers ? `，${stayers}因本职或旧隙留守` : ''}`;
}

import { keyedRandom, stableCompare } from '../random';
import type { CharacterState, WorldState } from '../types';
import { isBattleReadyCharacter } from './battle-readiness';
import { personalForce } from './personal-forces';

export type ExpeditionResponseOutcome = 'responded' | 'stayed';
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

const unit = (value: number) => Math.max(0, Math.min(1, value / 100));
const smooth = (value: number) => value * value * (3 - 2 * value);
type Motive = readonly [label: string, weight: number];

function strongest(motives: readonly Motive[], fallback: string): string {
  return [...motives].sort((left, right) => right[1] - left[1] || stableCompare(left[0], right[0]))[0]?.[0] ?? fallback;
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

/** Competing motives stay continuous; keyed chance settles the actual tension without exposing a score threshold. */
export function selectExpeditionResponses(
  world: WorldState,
  polity: WorldState['polities'][number],
  commander: CharacterState,
  region: WorldState['regions'][number],
): ExpeditionResponseSelection {
  const war = world.wars.find((item) => item.active && (item.attackerId === polity.id || item.defenderId === polity.id));
  const enemyId = war ? war.attackerId === polity.id ? war.defenderId : war.attackerId : null;
  const enemyFrontStrength = world.armies.filter((army) => army.polityId === enemyId
    && Boolean(war?.targetRegionIds.includes(army.regionId))).reduce((sum, army) => sum + army.soldiers, 0);
  const decisions = world.characters
    .filter((item) => item.id !== commander.id && item.id !== polity.rulerId && isAvailableForExpedition(world, polity.id, item))
    .map((character): ExpeditionResponseDecision | null => {
      const force = personalForce(world, character.id)!;
      const tie = relation(world, character.id, commander.id);
      const sameFaction = Boolean(character.factionId && character.factionId === commander.factionId);
      const kin = isKin(character, commander);
      const jointBattle = hasRecentJointBattle(world, character.id, commander.id);
      const front = Boolean(war?.targetRegionIds.some((id) => id === character.governedRegionId
        || id === force.homeRegionId || id === character.locationRegionId));
      const samePlace = character.locationRegionId === region.id;
      const localDuty = Boolean(character.governedRegionId && character.governedRegionId !== region.id && !front);
      const capitalDuty = character.locationRegionId === polity.capitalRegionId && region.id !== polity.capitalRegionId && !front;
      const relevant = samePlace || sameFaction || kin || jointBattle || front || localDuty || capitalDuty
        || Boolean(tie?.memories.length);
      if (!relevant) return null;
      const trust = smooth(unit(tie?.trust ?? 40));
      const gratitude = smooth(unit(tie?.gratitude ?? 0));
      const grievance = smooth(unit(tie?.grievance ?? 0));
      const readiness = smooth(unit(force.readiness));
      const responseMotives: Motive[] = [
        ['自身根基正受战线牵动', front ? .9 : 0], ['曾与主将共同临阵', jointBattle ? .7 : 0],
        ['正在同地集结', samePlace ? .55 : 0], ['彼此信任', trust * .5], ['旧恩尚在', gratitude * .35],
        ['同属一系', sameFaction ? .3 : 0], ['家门相连', kin ? .34 : 0], ['愿借此役争取功名', smooth(unit(character.ambition)) * .22],
      ];
      const stayMotives: Motive[] = [
        ['所守地方不在此路', localDuty ? .88 : 0],
        ['须留守中枢', capitalDuty ? .58 : 0], ['谨慎保全部曲', smooth(unit(character.caution)) * .32],
        ['本部尚未齐备', (1 - readiness) * .48], ['路途遥远', samePlace ? 0 : .22],
      ];
      const pressure = (motives: readonly Motive[], base: number) => Math.pow(base + motives.reduce((sum, [, value]) => sum + value, 0), 1.7);
      const response = pressure(responseMotives, .1 + smooth(unit(character.loyalty)) * .18 + readiness * .16);
      const stay = pressure(stayMotives, .12 + grievance * .18);
      const total = response + stay;
      const roll = keyedRandom(world.seed, world.turn, 'expedition-motive-choice', commander.id, character.id, region.id) * total;
      const outcome: ExpeditionResponseOutcome = roll < response ? 'responded' : 'stayed';
      const reason = outcome === 'responded' ? strongest(responseMotives, '愿意随军')
        : strongest(stayMotives, '留在本地待命');
      return { characterId: character.id, outcome, reason, priority: Math.round((1 - response / total) * 10_000) };
    })
    .filter((item): item is ExpeditionResponseDecision => Boolean(item));

  const candidates = decisions.filter((item) => item.outcome === 'responded')
    .sort((left, right) => left.priority - right.priority
      || keyedRandom(world.seed, world.turn, 'expedition-order', commander.id, left.characterId)
      - keyedRandom(world.seed, world.turn, 'expedition-order', commander.id, right.characterId)
      || stableCompare(left.characterId, right.characterId));
  const commanderSoldiers = personalForce(world, commander.id)?.soldiers ?? 0;
  const required = Math.max(2_600, Math.min(8_000, enemyFrontStrength * .62 + region.strategicValue * 135));
  const commandCapacity = 2_800 + commander.leadership * 55 + commander.cunning * 16;
  const target = Math.min(required, commandCapacity);
  const responders: ExpeditionResponseDecision[] = [];
  let assembled = commanderSoldiers;
  for (const candidate of candidates) {
    if (assembled >= target || responders.length >= 17) break;
    const soldiers = personalForce(world, candidate.characterId)?.soldiers ?? 0;
    const need = Math.max(0, Math.min(1, (target - assembled) / Math.max(1, target)));
    const usefulShare = Math.max(0, Math.min(1, soldiers / Math.max(1, target * .22)));
    const commandRoom = Math.max(0, Math.min(1, (commandCapacity - assembled) / Math.max(1, commandCapacity)));
    const coordination = smooth(responders.length / Math.max(2.5, 2.5 + commander.leadership / 20));
    const value = Math.max(.04, Math.min(.98,
      .08 + smooth(need) * .62 + smooth(usefulShare) * .22 + smooth(commandRoom) * .12 - coordination * .42));
    if (keyedRandom(world.seed, world.turn, 'expedition-assembly-value', commander.id, candidate.characterId, responders.length) < value) {
      responders.push(candidate);
      assembled += soldiers;
    }
  }
  const accepted = new Set(responders.map((item) => item.characterId));
  for (const item of decisions) if (item.outcome === 'responded' && !accepted.has(item.characterId)) {
    item.outcome = 'stayed';
    item.reason = '此行营兵力已足，仍留本地待命';
  }
  return { participantIds: [commander.id, ...responders.map((item) => item.characterId)], decisions };
}

export function expeditionAssemblyText(world: WorldState, selection: ExpeditionResponseSelection): string {
  const names = (ids: readonly string[]) => ids.map((id) => world.characters.find((item) => item.id === id)?.name).filter(Boolean).join('、');
  const responders = names(selection.participantIds.slice(1));
  return responders ? `；${responders}响应随征` : '';
}

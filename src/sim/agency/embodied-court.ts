import { stableCompare } from '../random';
import {
  COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD,
  COURT_ALLIANCE_DURATION_TURNS,
  COURT_ALLIANCE_TARGET_COHESION_THRESHOLD,
} from '../politics/court-alliance-contract';
import {
  createEmbodiedCommand,
  embodiedCommandsMatch,
  type EmbodiedCommandIdentity,
} from './embodied-identity';

interface CourtCharacterView {
  id: string;
  name: string;
  age: number;
  alive: boolean;
  polityId: string;
  role: string;
  factionId: string | null;
}

interface CourtFactionView {
  id: string;
  polityId: string;
  name: string;
  leaderId: string;
  memberIds: readonly string[];
  power: number;
  cohesion: number;
  alliedFactionIds: readonly string[];
  active: boolean;
}

interface CourtWorldView {
  seed: string;
  turn: number;
  season: string;
  characters: readonly CourtCharacterView[];
  factions: readonly CourtFactionView[];
  polities: readonly { id: string; rulerId: string; alive: boolean }[];
  offices: readonly { active: boolean; holderId: string; polityId: string; kind: string }[];
}

interface EmbodiedCourtProjection {
  command: EmbodiedCommandIdentity & { kind: 'form_court_alliance' };
  label: string;
  targetLabel: string;
  intent: string;
  cost: string;
  obstacle: string;
  nextSignal: string;
  available: boolean;
  unavailableReason: string | null;
}

interface CourtAllianceFrame {
  actor: CourtCharacterView;
  actorFaction: CourtFactionView;
  targetFaction: CourtFactionView | null;
  targetLeaderName: string | null;
}

const COURT_ALLIANCE_OFFICES = new Set(['宰辅', '枢密使', '廷臣']);

function eligibleTargets(world: CourtWorldView, actorFaction: CourtFactionView): CourtFactionView[] {
  return world.factions
    .filter((faction) => (
      faction.active
      && faction.polityId === actorFaction.polityId
      && faction.id !== actorFaction.id
      && faction.memberIds.length > 0
      && world.characters.some((character) => character.id === faction.leaderId && character.alive)
    ))
    .sort((left, right) => right.power - left.power || stableCompare(left.id, right.id));
}

function preferredTarget(world: CourtWorldView, actorFaction: CourtFactionView): CourtFactionView | null {
  const targets = eligibleTargets(world, actorFaction);
  const notAllied = targets.filter((faction) => !actorFaction.alliedFactionIds.includes(faction.id));
  return notAllied.find((faction) => (
    faction.cohesion >= COURT_ALLIANCE_TARGET_COHESION_THRESHOLD
    && actorFaction.cohesion + faction.cohesion >= COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD
  )) ?? notAllied[0] ?? targets[0] ?? null;
}

function courtAllianceFrame(
  world: CourtWorldView,
  actorId: string,
  exactTargetFactionId?: string,
): CourtAllianceFrame | null {
  const actor = world.characters.find((character) => character.id === actorId);
  const polity = actor ? world.polities.find((item) => item.id === actor.polityId) : null;
  if (!actor || actor.role !== '廷臣' || actor.id === polity?.rulerId) return null;
  const actorFaction = actor.factionId
    ? world.factions.find((faction) => (
        faction.id === actor.factionId
        && faction.active
        && faction.memberIds.length > 0
      )) ?? null
    : null;
  const hasCourtOffice = world.offices.some((office) => (
    office.active
    && office.holderId === actor.id
    && office.polityId === actor.polityId
    && COURT_ALLIANCE_OFFICES.has(office.kind)
  ));
  if (
    !actorFaction
    || actorFaction.polityId !== actor.polityId
    || actorFaction.leaderId !== actor.id
    || !hasCourtOffice
  ) return null;
  const targetFaction = exactTargetFactionId
    ? eligibleTargets(world, actorFaction).find((faction) => faction.id === exactTargetFactionId) ?? null
    : preferredTarget(world, actorFaction);
  const targetLeaderName = targetFaction
    ? world.characters.find((character) => character.id === targetFaction.leaderId && character.alive)?.name ?? null
    : null;
  return { actor, actorFaction, targetFaction, targetLeaderName };
}

function unavailableReason(world: CourtWorldView, frame: CourtAllianceFrame): string | null {
  const { actor, actorFaction, targetFaction } = frame;
  if (!actor.alive) return '此人已经不在人世';
  if (actor.age < 16) return '尚未成年，不能独自参与朝议';
  if (!world.polities.some((polity) => polity.id === actor.polityId && polity.alive)) return '所属政权已经退出历史舞台';
  if (!targetFaction) return '朝中没有另一支可明确协商的在场派系';
  if (actorFaction.alliedFactionIds.includes(targetFaction.id)) return `${targetFaction.name}已经与本派结盟，无需重复议约`;
  if (world.season !== '冬') return '交换来年朝中支持只在冬季议定';
  if (targetFaction.cohesion < COURT_ALLIANCE_TARGET_COHESION_THRESHOLD) {
    return `${targetFaction.name}凝聚仅${Math.round(targetFaction.cohesion)}，尚不足以共同作出承诺`;
  }
  const combined = actorFaction.cohesion + targetFaction.cohesion;
  if (combined < COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD) {
    return `双方凝聚合计${Math.round(combined)}，尚未达到议约所需的${COURT_ALLIANCE_COMBINED_COHESION_THRESHOLD}`;
  }
  return null;
}

function projectionForFrame(world: CourtWorldView, frame: CourtAllianceFrame): EmbodiedCourtProjection {
  const target = frame.targetFaction;
  const unavailable = unavailableReason(world, frame);
  return {
    command: createEmbodiedCommand(
      world.seed,
      world.turn,
      frame.actor.id,
      'form_court_alliance',
      'faction',
      target?.id ?? 'missing',
    ),
    label: '交换朝中支持',
    targetLabel: target
      ? `${target.name}${frame.targetLeaderName ? ` · ${frame.targetLeaderName}` : ''}`
      : '暂无可议对象',
    intent: target
      ? `与${target.name}约定在朝廷议程中彼此相助，不以清洗夺取盟友席位。`
      : '寻找一支能够在朝议中彼此相助的派系。',
    cost: `一项最长维持${COURT_ALLIANCE_DURATION_TURNS / 4}年的政治承诺`,
    obstacle: target
      ? `本派凝聚${Math.round(frame.actorFaction.cohesion)}、对方${Math.round(target.cohesion)}，合计${Math.round(frame.actorFaction.cohesion + target.cohesion)}；本季同一政权只议成一项盟约`
      : '缺少仍在朝中活动的另一支派系',
    nextSignal: target
      ? `观察${frame.actorFaction.name}与${target.name}是否结盟，以及双方权势根基如何变化`
      : '观察朝中是否出现新的派系领袖与议约对象',
    available: unavailable === null,
    unavailableReason: unavailable,
  };
}

/** Pure role projection with a deliberately narrow world dependency. */
export function projectEmbodiedCourtAction(
  world: CourtWorldView,
  actorId: string,
): EmbodiedCourtProjection | null {
  const frame = courtAllianceFrame(world, actorId);
  return frame ? projectionForFrame(world, frame) : null;
}

export function isEmbodiedCourtAction<TCommand extends EmbodiedCommandIdentity>(
  command: TCommand | null | undefined,
): command is TCommand & { kind: 'form_court_alliance' } {
  return Boolean(command && command.kind === 'form_court_alliance');
}

export interface EmbodiedCourtAllianceRequest {
  option: EmbodiedCourtProjection | null;
  actorFactionId: string | null;
  targetFactionId: string | null;
  valid: boolean;
}

/** Rebuilds exact player identity; the political domain remains the eligibility owner. */
export function courtAllianceIdentityFromCommand(
  world: CourtWorldView,
  command: EmbodiedCommandIdentity,
): EmbodiedCourtAllianceRequest {
  if (!isEmbodiedCourtAction(command) || command.targetKind !== 'faction') {
    return { option: null, actorFactionId: null, targetFactionId: null, valid: false };
  }
  const frame = courtAllianceFrame(world, command.actorId, command.targetId);
  const option = frame ? projectionForFrame(world, frame) : null;
  const valid = Boolean(
    frame?.targetFaction
    && command.issuedTurn === world.turn
    && option
    && embodiedCommandsMatch(option.command, command)
    && option.available,
  );
  return {
    option,
    actorFactionId: valid ? frame?.actorFaction.id ?? null : null,
    targetFactionId: valid ? frame?.targetFaction?.id ?? null : null,
    valid,
  };
}

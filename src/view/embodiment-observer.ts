import {
  EMBODIED_ACTION_KINDS,
  type EmbodiedActionCommand,
} from '../sim/agency/embodiment';
import type { CharacterState, WorldState } from '../sim/types';

export const EMBODIMENT_OBSERVER_STORAGE_PREFIX = 'canghai-embodiment-view-v1';
export const MAX_EMBODIMENT_OBSERVER_BYTES = 16_384;

export interface EmbodimentWorldAnchor {
  seed: string;
  turn: number;
  hash: string;
}

export interface EmbodimentActorRef {
  id: string;
  name: string;
}

export interface EmbodimentClosure {
  actorId: string;
  actorName: string;
  reason: 'died' | 'missing';
  turn: number;
  age: number | null;
  role: string | null;
  summary: string;
  highlights: readonly string[];
  sourceEventId: string | null;
}

export interface EmbodimentObserverState {
  version: 1;
  anchor: EmbodimentWorldAnchor | null;
  activeActor: EmbodimentActorRef | null;
  pendingAction: EmbodiedActionCommand | null;
  closure: EmbodimentClosure | null;
}

function anchorFor(world: WorldState): EmbodimentWorldAnchor {
  return { seed: world.seed, turn: world.turn, hash: world.hash };
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160;
}

function parseCommand(value: unknown): EmbodiedActionCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const command = value as Partial<EmbodiedActionCommand>;
  if (!validIdentifier(command.actionId)
    || !Number.isInteger(command.issuedTurn)
    || (command.issuedTurn as number) < 0
    || !validIdentifier(command.actorId)
    || !EMBODIED_ACTION_KINDS.includes(command.kind as (typeof EMBODIED_ACTION_KINDS)[number])
    || !['character', 'faction', 'army', 'region'].includes(command.targetKind ?? '')
    || !validIdentifier(command.targetId)
    || ![null, 'support', 'oppose'].includes(command.stance ?? null)) return null;
  return {
    actionId: command.actionId,
    issuedTurn: command.issuedTurn as number,
    actorId: command.actorId,
    kind: command.kind as EmbodiedActionCommand['kind'],
    targetKind: command.targetKind as EmbodiedActionCommand['targetKind'],
    targetId: command.targetId,
    stance: command.stance ?? null,
  };
}

function parseClosure(value: unknown): EmbodimentClosure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const closure = value as Partial<EmbodimentClosure>;
  if (!validIdentifier(closure.actorId)
    || !validIdentifier(closure.actorName)
    || !['died', 'missing'].includes(closure.reason ?? '')
    || !Number.isInteger(closure.turn)
    || (closure.turn as number) < 0
    || typeof closure.summary !== 'string') return null;
  const highlights = Array.isArray(closure.highlights)
    ? closure.highlights.filter((item): item is string => typeof item === 'string').slice(0, 3)
    : [];
  return {
    actorId: closure.actorId,
    actorName: closure.actorName,
    reason: closure.reason as EmbodimentClosure['reason'],
    turn: closure.turn as number,
    age: typeof closure.age === 'number' && Number.isFinite(closure.age) ? closure.age : null,
    role: typeof closure.role === 'string' ? closure.role : null,
    summary: closure.summary.slice(0, 360),
    highlights,
    sourceEventId: validIdentifier(closure.sourceEventId) ? closure.sourceEventId : null,
  };
}

function highlightsFor(character: CharacterState | null | undefined): string[] {
  if (!character) return [];
  const highlights: string[] = [];
  const seen = new Set<string>();
  for (let index = character.biography.length - 1; index >= 0 && highlights.length < 3; index -= 1) {
    const summary = character.biography[index]?.summary.trim();
    if (!summary || seen.has(summary)) continue;
    seen.add(summary);
    highlights.push(summary);
  }
  return highlights;
}

function closureFor(
  previous: WorldState | null,
  world: WorldState,
  actor: EmbodimentActorRef,
): EmbodimentClosure {
  const character = world.characters.find((item) => item.id === actor.id)
    ?? previous?.characters.find((item) => item.id === actor.id)
    ?? null;
  const deathFact = [...world.facts].reverse().find((fact) => (
    fact.kind === 'character_death' && fact.payload.characterId === actor.id
  ));
  const deathEvent = deathFact
    ? [...world.history].reverse().find((event) => (
        event.sourceFactIds.includes(deathFact.id)
        && (event.kind === 'character_death' || event.kind === 'character_battle_death')
      )) ?? [...world.history].reverse().find((event) => event.sourceFactIds.includes(deathFact.id))
    : null;
  const died = Boolean(character && !character.alive) || Boolean(deathFact);
  const age = deathFact?.kind === 'character_death' ? deathFact.payload.age : character?.age ?? null;
  const role = deathFact?.kind === 'character_death' ? deathFact.payload.role : character?.role ?? null;
  return {
    actorId: actor.id,
    actorName: character?.name ?? actor.name,
    reason: died ? 'died' : 'missing',
    turn: world.turn,
    age,
    role,
    summary: died
      ? `${role ?? '人物'}${character?.name ?? actor.name}一生至此${age === null ? '' : `，享年${age}岁`}。世界仍会沿着此人留下的关系、家门与旧事继续演变。`
      : `${actor.name}已不在当前世界的人物名册中，这一观察视角无法继续。已经写入世界的行动与经历不受影响。`,
    highlights: highlightsFor(character),
    sourceEventId: deathEvent?.id ?? null,
  };
}

export function embodimentObserverStorageKey(seed: string, mapContentVersion?: string): string {
  const worldKey = mapContentVersion
    ? `${encodeURIComponent(mapContentVersion)}:${encodeURIComponent(seed)}`
    : encodeURIComponent(seed);
  return `${EMBODIMENT_OBSERVER_STORAGE_PREFIX}:${worldKey}`;
}

export function createEmbodimentObserverState(world: WorldState | null = null): EmbodimentObserverState {
  return {
    version: 1,
    anchor: world ? anchorFor(world) : null,
    activeActor: null,
    pendingAction: null,
    closure: null,
  };
}

export function serializeEmbodimentObserverState(state: EmbodimentObserverState): string {
  const encoded = JSON.stringify(state);
  if (encoded.length > MAX_EMBODIMENT_OBSERVER_BYTES) throw new Error('人物观察视角记录超过容量上限');
  return encoded;
}

export function parseEmbodimentObserverState(raw: string | null): EmbodimentObserverState {
  if (!raw || raw.length > MAX_EMBODIMENT_OBSERVER_BYTES) return createEmbodimentObserverState();
  try {
    const candidate = JSON.parse(raw) as Partial<EmbodimentObserverState>;
    const anchor = candidate.anchor;
    if (candidate.version !== 1
      || !anchor
      || !validIdentifier(anchor.seed)
      || !Number.isInteger(anchor.turn)
      || (anchor.turn as number) < 0
      || !validIdentifier(anchor.hash)) return createEmbodimentObserverState();
    const active = candidate.activeActor;
    const activeActor = active && validIdentifier(active.id) && validIdentifier(active.name)
      ? { id: active.id, name: active.name }
      : null;
    return {
      version: 1,
      anchor: { seed: anchor.seed, turn: anchor.turn as number, hash: anchor.hash },
      activeActor,
      pendingAction: parseCommand(candidate.pendingAction),
      closure: parseClosure(candidate.closure),
    };
  } catch {
    return createEmbodimentObserverState();
  }
}

/** Restore only against an exact world anchor; stale metadata never crosses branches. */
export function restoreEmbodimentObserverState(
  world: WorldState,
  raw: string | null,
): EmbodimentObserverState {
  const parsed = parseEmbodimentObserverState(raw);
  if (!parsed.anchor
    || parsed.anchor.seed !== world.seed
    || parsed.anchor.turn !== world.turn
    || parsed.anchor.hash !== world.hash) return createEmbodimentObserverState(world);
  const activeCharacter = parsed.activeActor
    ? world.characters.find((item) => item.id === parsed.activeActor?.id)
    : null;
  if (parsed.activeActor && !activeCharacter?.alive) {
    return {
      version: 1,
      anchor: anchorFor(world),
      activeActor: null,
      pendingAction: null,
      closure: closureFor(null, world, parsed.activeActor),
    };
  }
  const submittedThisTurn = world.facts.some((fact) => (
    fact.turn === world.turn && fact.kind === 'embodied_action_submitted'
  ));
  const pendingActor = parsed.pendingAction
    ? world.characters.find((item) => item.id === parsed.pendingAction?.actorId && item.alive)
    : null;
  const pendingAction = parsed.pendingAction
    && !submittedThisTurn
    && parsed.pendingAction.issuedTurn === world.turn
    && pendingActor
      ? parsed.pendingAction
      : null;
  return {
    version: 1,
    anchor: anchorFor(world),
    activeActor: activeCharacter ? { id: activeCharacter.id, name: activeCharacter.name } : null,
    pendingAction,
    closure: parsed.closure,
  };
}

export function enterEmbodimentObserverState(
  state: EmbodimentObserverState,
  world: WorldState,
  characterId: string,
): EmbodimentObserverState | null {
  const character = world.characters.find((item) => item.id === characterId && item.alive);
  if (!character) return null;
  return {
    ...state,
    anchor: anchorFor(world),
    activeActor: { id: character.id, name: character.name },
    closure: null,
  };
}

export function leaveEmbodimentObserverState(
  state: EmbodimentObserverState,
  world: WorldState,
): EmbodimentObserverState {
  return { ...state, anchor: anchorFor(world), activeActor: null, closure: null };
}

export function queueEmbodiedObserverAction(
  state: EmbodimentObserverState,
  world: WorldState,
  command: EmbodiedActionCommand,
): EmbodimentObserverState | null {
  if (state.activeActor?.id !== command.actorId || command.issuedTurn !== world.turn) return null;
  return { ...state, anchor: anchorFor(world), pendingAction: { ...command } };
}

export function cancelEmbodiedObserverAction(
  state: EmbodimentObserverState,
  world: WorldState,
): EmbodimentObserverState {
  return { ...state, anchor: anchorFor(world), pendingAction: null };
}

export function reanchorEmbodimentObserverState(
  state: EmbodimentObserverState,
  world: WorldState,
): EmbodimentObserverState {
  const active = state.activeActor
    ? world.characters.find((item) => item.id === state.activeActor?.id && item.alive)
    : null;
  return {
    ...state,
    anchor: anchorFor(world),
    activeActor: active ? { id: active.id, name: active.name } : null,
    pendingAction: state.pendingAction?.issuedTurn === world.turn ? state.pendingAction : null,
  };
}

export function advanceEmbodimentObserverState(
  state: EmbodimentObserverState,
  previous: WorldState,
  world: WorldState,
): EmbodimentObserverState {
  if (!state.activeActor) {
    return { ...state, anchor: anchorFor(world), pendingAction: null };
  }
  const active = world.characters.find((item) => item.id === state.activeActor?.id);
  if (active?.alive) {
    return {
      ...state,
      anchor: anchorFor(world),
      activeActor: { id: active.id, name: active.name },
      pendingAction: null,
    };
  }
  return {
    version: 1,
    anchor: anchorFor(world),
    activeActor: null,
    pendingAction: null,
    closure: closureFor(previous, world, state.activeActor),
  };
}

export function dismissEmbodimentClosure(
  state: EmbodimentObserverState,
): EmbodimentObserverState {
  return { ...state, closure: null };
}

import { describe, expect, it } from 'vitest';
import { advanceWorld, createWorld, serializeWorld } from '../sim';
import { projectCharacterEmbodiedActions } from '../sim/agency';
import {
  advanceEmbodimentObserverState,
  cancelEmbodiedObserverAction,
  createEmbodimentObserverState,
  enterEmbodimentObserverState,
  parseEmbodimentObserverState,
  queueEmbodiedObserverAction,
  restoreEmbodimentObserverState,
  serializeEmbodimentObserverState,
} from './embodiment-observer';

describe('ARC03/EMB08 embodiment observer state', () => {
  it('restores an active character and pending choice only at the exact world anchor', () => {
    const world = createWorld('入世视角续读');
    const actor = world.characters.find((item) => item.alive && item.age >= 16);
    if (!actor) throw new Error('fixture requires a living adult');
    const option = projectCharacterEmbodiedActions(world, actor.id).find((item) => item.available);
    if (!option) throw new Error('fixture requires an available action');
    const entered = enterEmbodimentObserverState(createEmbodimentObserverState(world), world, actor.id);
    if (!entered) throw new Error('actor should be enterable');
    const queued = queueEmbodiedObserverAction(entered, world, option.command);
    if (!queued) throw new Error('action should be queueable');
    const worldBefore = serializeWorld(world);
    const restored = restoreEmbodimentObserverState(world, serializeEmbodimentObserverState(queued));

    expect(restored.activeActor).toEqual({ id: actor.id, name: actor.name });
    expect(restored.pendingAction).toEqual(option.command);
    expect(serializeWorld(world)).toBe(worldBefore);
    expect(worldBefore).not.toContain('activeActor');

    const advanced = advanceWorld(world);
    const stale = restoreEmbodimentObserverState(advanced, serializeEmbodimentObserverState(queued));
    expect(stale.activeActor).toBeNull();
    expect(stale.pendingAction).toBeNull();
  });

  it('keeps leaving and canceling observer-only while an already submitted fact remains authoritative', () => {
    const world = createWorld('换人不刷新次数');
    const actors = world.characters.filter((item) => item.alive && item.age >= 16).slice(0, 2);
    const option = projectCharacterEmbodiedActions(world, actors[0]?.id ?? '').find((item) => item.available);
    if (actors.length < 2 || !option) throw new Error('fixture requires two actors and an action');
    const first = enterEmbodimentObserverState(createEmbodimentObserverState(world), world, actors[0]!.id);
    if (!first) throw new Error('first actor should be enterable');
    const queued = queueEmbodiedObserverAction(first, world, option.command);
    if (!queued) throw new Error('action should be queueable');
    const switched = enterEmbodimentObserverState(queued, world, actors[1]!.id);
    if (!switched) throw new Error('second actor should be enterable');
    const restored = restoreEmbodimentObserverState(world, serializeEmbodimentObserverState(switched));

    expect(restored.activeActor?.id).toBe(actors[1]!.id);
    expect(restored.pendingAction).toEqual(option.command);

    const next = advanceWorld(world, { embodiedAction: option.command });
    const submitted = next.facts.filter((fact) => fact.turn === world.turn && fact.kind === 'embodied_action_submitted');
    let state = enterEmbodimentObserverState(createEmbodimentObserverState(next), next, actors[1]!.id);
    if (!state) throw new Error('second actor should remain enterable');
    state = cancelEmbodiedObserverAction(state, next);

    expect(submitted).toHaveLength(1);
    expect(next.facts.some((fact) => fact.kind === 'embodied_action_resolved')).toBe(true);
    expect(projectCharacterEmbodiedActions(next, actors[1]!.id)).toHaveLength(3);
  });

  it('turns a dead or missing active actor into a durable life closure', () => {
    let world = createWorld('入世生平收束');
    let transition: { previous: typeof world; next: typeof world; actorId: string } | null = null;
    for (let turn = 0; turn < 80 && !transition; turn += 1) {
      const next = advanceWorld(world);
      const dead = next.characters.find((item) => (
        !item.alive && world.characters.find((before) => before.id === item.id)?.alive
      ));
      if (dead) transition = { previous: world, next, actorId: dead.id };
      else world = next;
    }
    if (!transition) throw new Error('fixture requires a natural death');
    const previousActor = transition.previous.characters.find((item) => item.id === transition?.actorId);
    if (!previousActor) throw new Error('missing previous actor');
    const state = {
      ...createEmbodimentObserverState(transition.previous),
      activeActor: { id: previousActor.id, name: previousActor.name },
    };
    const reconciled = advanceEmbodimentObserverState(state, transition.previous, transition.next);

    expect(reconciled.activeActor).toBeNull();
    expect(reconciled.pendingAction).toBeNull();
    expect(reconciled.closure?.reason).toBe('died');
    expect(reconciled.closure?.actorName).toBe(previousActor.name);
    expect(reconciled.closure?.summary).toContain('一生至此');
    expect(reconciled.closure?.sourceEventId).toBeTruthy();
    expect(transition.next.history.find((event) => event.id === reconciled.closure?.sourceEventId)?.kind)
      .toBe('character_death');
  });

  it('rejects malformed metadata without affecting play', () => {
    expect(parseEmbodimentObserverState('{broken')).toEqual(createEmbodimentObserverState());
    expect(parseEmbodimentObserverState(JSON.stringify({ version: 1, anchor: { seed: '', turn: -1, hash: '' } })))
      .toEqual(createEmbodimentObserverState());
  });
});

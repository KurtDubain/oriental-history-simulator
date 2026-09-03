import { describe, expect, it } from 'vitest';

import {
  advanceWorld,
  computeWorldHash,
  createWorld,
  projectCharacterEmbodiedActions,
  projectEmbodiedActions,
  stableHash,
  validateTurnRuntime,
  type EmbodiedActionCommand,
  type WorldState,
} from '../index';

function playable(world: WorldState) {
  for (const character of world.characters) {
    const action = projectEmbodiedActions(world, character.id).find((item) => item.available);
    if (action) return { character, action };
  }
  throw new Error('Embodiment fixture requires one available action');
}

const IDENTITY_ACTIONS = new Set([
  'cultivate_military_support',
  'request_backing',
  'request_independent_command',
]);

function militaryPlayable(seed: string) {
  let world = createWorld(seed);
  for (let turn = 0; turn < 32; turn += 1) {
    for (const actor of world.agencyDecisionSystem.actors) {
      const action = projectCharacterEmbodiedActions(world, actor.characterId)
        .find((item) => IDENTITY_ACTIONS.has(item.command.kind) && item.available);
      if (action) return { world, actorId: actor.characterId, action };
    }
    world = advanceWorld(world);
  }
  throw new Error('Identity action fixture requires an eligible deputy');
}

describe('EMB01-04 embodied character action', () => {
  it('projects actions without mutating authoritative state', () => {
    const world = createWorld('入世投影纯度');
    const before = stableHash(world);
    const hash = computeWorldHash(world);
    const { character } = playable(world);

    const actions = projectEmbodiedActions(world, character.id);

    expect(actions).toHaveLength(3);
    expect(actions.map((item) => item.label)).toEqual(['经营关系', '争取机会', expect.stringMatching(/表明支持|公开反对/)]);
    expect(actions.every((item) => item.targetLabel && item.cost && item.obstacle && item.nextSignal)).toBe(true);
    expect(stableHash(world)).toBe(before);
    expect(world.hash).toBe(hash);
  });

  it('resolves the same command deterministically through Facts, Chronicle, memory and biography', () => {
    const initial = createWorld('入世结算确定性');
    const { character, action } = playable(initial);
    const before = stableHash(initial);

    const first = advanceWorld(initial, { embodiedAction: action.command });
    const second = advanceWorld(initial, { embodiedAction: action.command });
    const submission = first.facts.find((fact) => fact.kind === 'embodied_action_submitted');
    const resolution = first.facts.find((fact) => fact.kind === 'embodied_action_resolved');

    expect(first).toEqual(second);
    expect(stableHash(initial)).toBe(before);
    expect(submission?.payload.source).toBe('player_embodied');
    expect(resolution?.payload.submissionFactId).toBe(submission?.id);
    if (action.command.targetKind === 'character') {
      expect(resolution?.payload.nextSignal).toContain(action.targetLabel.split(' · ')[0]);
    }
    expect(first.history.some((event) => event.sourceFactIds.includes(resolution?.id ?? 'missing'))).toBe(true);
    expect(first.characters.find((item) => item.id === character.id)?.biography.some((item) => item.factId === resolution?.id)).toBe(true);
    expect(first.agencySystem.characters.find((item) => item.characterId === character.id)?.memories.some((item) => item.sourceFactIds.includes(resolution?.id ?? 'missing'))).toBe(true);
    expect(validateTurnRuntime(initial, first)).toEqual([]);
  });

  it('records a forged or stale request as invalidated and applies no state delta', () => {
    const initial = createWorld('入世无权限审计');
    const { action } = playable(initial);
    const forged: EmbodiedActionCommand = { ...action.command, targetId: 'character_missing' };

    const next = advanceWorld(initial, { embodiedAction: forged });
    const resolution = next.facts.find((fact) => fact.kind === 'embodied_action_resolved');

    expect(resolution?.payload.outcome).toBe('invalidated');
    expect(resolution?.stateDeltas).toEqual([]);
    expect(next.facts.filter((fact) => fact.kind === 'embodied_action_submitted')).toHaveLength(1);
    expect(next.facts.filter((fact) => fact.kind === 'embodied_action_resolved')).toHaveLength(1);
    expect(validateTurnRuntime(initial, next)).toEqual([]);
  });
});

describe('EMB05-06 deputy identity action', () => {
  it('adds at most one stage-specific military action without mutating the world', () => {
    const { world, actorId, action } = militaryPlayable('副将入世投影');
    const before = stableHash(world);
    const actions = projectCharacterEmbodiedActions(world, actorId);

    expect(actions).toHaveLength(4);
    expect(action.targetLabel).toBeTruthy();
    expect(action.intent).toMatch(/军|帅|君|将校/);
    expect(action.cost).toBeTruthy();
    expect(action.obstacle).toBeTruthy();
    expect(action.nextSignal).toBeTruthy();
    expect(stableHash(world)).toBe(before);
  });

  it('uses the same Agency resolver result as the AI action and records one observer envelope', () => {
    const { world, actorId, action } = militaryPlayable('副将共用裁决');
    const baseline = advanceWorld(world);
    const played = advanceWorld(world, { embodiedAction: action.command });
    const submission = played.facts.find((fact) => (
      fact.turn === world.turn
      && fact.kind === 'embodied_action_submitted'
      && fact.payload.actionId === action.command.actionId
    ));
    const wrapper = played.facts.find((fact) => (
      fact.turn === world.turn
      && fact.kind === 'embodied_action_resolved'
      && fact.payload.actionId === action.command.actionId
    ));

    expect(submission?.kind).toBe('embodied_action_submitted');
    expect(wrapper?.kind).toBe('embodied_action_resolved');
    if (wrapper?.kind !== 'embodied_action_resolved') throw new Error('missing identity wrapper');
    expect(wrapper.payload.domainFactId).not.toBeNull();
    expect(wrapper.stateDeltas).toEqual([]);
    expect(wrapper.sourceFactIds).toEqual([submission?.id, wrapper.payload.domainFactId]);
    const domain = played.facts.find((fact) => fact.id === wrapper.payload.domainFactId);
    const baselineDomain = baseline.facts.find((fact) => (
      fact.turn === world.turn
      && fact.payload && 'actorId' in fact.payload
      && fact.payload.actorId === actorId
      && ((domain?.kind === 'agency_support_resolved' && fact.kind === 'agency_support_resolved')
        || (domain?.kind === 'agency_intent_resolved' && fact.kind === 'agency_intent_resolved'))
    ));
    expect(domain?.kind).toMatch(/agency_(support|intent)_resolved/);
    expect(baselineDomain?.kind).toBe(domain?.kind);
    if (domain?.kind === 'agency_support_resolved' && baselineDomain?.kind === 'agency_support_resolved') {
      expect(domain.payload.outcome).toBe(baselineDomain.payload.outcome);
      expect(domain.payload.strength).toBe(baselineDomain.payload.strength);
      expect(domain.stateDeltas).toEqual(baselineDomain.stateDeltas);
    } else if (domain?.kind === 'agency_intent_resolved' && baselineDomain?.kind === 'agency_intent_resolved') {
      expect(domain.payload.outcome).toBe(baselineDomain.payload.outcome);
      expect(domain.payload.reasonCode).toBe(baselineDomain.payload.reasonCode);
      expect(domain.payload.decisionScore).toBe(baselineDomain.payload.decisionScore);
      expect(domain.stateDeltas).toEqual(baselineDomain.stateDeltas);
    }
    const memories = played.agencySystem.characters.find((item) => item.characterId === actorId)?.memories ?? [];
    expect(memories.some((item) => item.sourceFactIds.includes(domain?.id ?? 'missing'))).toBe(true);
    expect(memories.some((item) => item.sourceFactIds.includes(wrapper.id))).toBe(false);
    expect(played.history.some((event) => event.sourceFactIds.includes(domain?.id ?? 'missing'))).toBe(true);
    expect(validateTurnRuntime(world, played)).toEqual([]);
  });

  it('invalidates a forged identity target without invoking a domain resolver', () => {
    const { world, action } = militaryPlayable('副将身份防滥用');
    const forged: EmbodiedActionCommand = { ...action.command, targetId: 'army_missing' };
    const next = advanceWorld(world, { embodiedAction: forged });
    const wrapper = next.facts.find((fact) => (
      fact.turn === world.turn
      && fact.kind === 'embodied_action_resolved'
      && fact.payload.actionId === forged.actionId
    ));

    expect(wrapper?.kind).toBe('embodied_action_resolved');
    if (wrapper?.kind !== 'embodied_action_resolved') throw new Error('missing invalid identity wrapper');
    expect(wrapper.payload.outcome).toBe('invalidated');
    expect(wrapper.payload.domainFactId).toBeNull();
    expect(wrapper.stateDeltas).toEqual([]);
    expect(validateTurnRuntime(world, next)).toEqual([]);
  });

  it('lets a player-held deputy carry support into a next-quarter request using the same intent resolver', () => {
    let world = createWorld('军权春秋');
    let chain: { actorId: string; afterSupport: WorldState; request: ReturnType<typeof projectCharacterEmbodiedActions>[number] } | null = null;
    for (let turn = 0; turn < 32 && !chain; turn += 1) {
      for (const actor of world.agencyDecisionSystem.actors) {
        const supports = projectCharacterEmbodiedActions(world, actor.characterId).filter((item) => (
          item.available
          && (item.command.kind === 'cultivate_military_support' || item.command.kind === 'request_backing')
        ));
        for (const support of supports) {
          const afterSupport = advanceWorld(world, { embodiedAction: support.command });
          const request = projectCharacterEmbodiedActions(afterSupport, actor.characterId)
            .find((item) => item.command.kind === 'request_independent_command' && item.available);
          if (request) { chain = { actorId: actor.characterId, afterSupport, request }; break; }
        }
        if (chain) break;
      }
      if (!chain) world = advanceWorld(world);
    }
    expect(chain?.request.label).toBe('请领独立军令');
    if (!chain) throw new Error('fixture requires a successful support action that unlocks a command request');
    const naturallyRequesting = chain.actorId;
    const afterSupport = chain.afterSupport;
    const request = chain.request;

    const aiResult = advanceWorld(afterSupport);
    const playerResult = advanceWorld(afterSupport, { embodiedAction: request.command });
    const wrapper = playerResult.facts.find((fact) => (
      fact.turn === afterSupport.turn
      && fact.kind === 'embodied_action_resolved'
      && fact.payload.actionId === request.command.actionId
    ));
    if (wrapper?.kind !== 'embodied_action_resolved' || !wrapper.payload.domainFactId) {
      throw new Error('formal player request must link its domain resolution');
    }
    const playerDomain = playerResult.facts.find((fact) => fact.id === wrapper.payload.domainFactId);
    const aiDomain = aiResult.facts.find((fact) => (
      fact.turn === afterSupport.turn
      && fact.kind === 'agency_intent_resolved'
      && fact.payload.actorId === naturallyRequesting
    ));
    expect(playerDomain?.kind).toBe('agency_intent_resolved');
    expect(aiDomain?.kind).toBe('agency_intent_resolved');
    if (playerDomain?.kind !== 'agency_intent_resolved' || aiDomain?.kind !== 'agency_intent_resolved') {
      throw new Error('missing comparable command resolutions');
    }
    expect(playerDomain.payload.outcome).toBe(aiDomain.payload.outcome);
    expect(playerDomain.payload.reasonCode).toBe(aiDomain.payload.reasonCode);
    expect(playerDomain.payload.decisionScore).toBe(aiDomain.payload.decisionScore);
    expect(playerDomain.stateDeltas).toEqual(aiDomain.stateDeltas);
    expect(validateTurnRuntime(afterSupport, playerResult)).toEqual([]);
  });
});

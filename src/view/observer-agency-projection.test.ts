import { describe, expect, it } from 'vitest';
import { createWorld, serializeWorld } from '../sim';
import {
  agencyDossierOptions,
  agencyShadowRestoreToken,
  agencyTrackedCharacterIds,
} from './observer-agency-projection';
import {
  attachAgencyShadowBranch,
  createAgencyShadowLedger,
  ensureAgencyShadowCharacters,
} from './v1-agency-shadow';

describe('observer Agency projection boundary', () => {
  it('keeps restore tokens stable and tracks a bounded deterministic cast', () => {
    const world = createWorld('架构-人物连续性');
    const before = serializeWorld(world);
    const selected = world.characters[0];
    const ids = agencyTrackedCharacterIds(
      world,
      { kind: 'person', id: selected.id },
      [{ kind: 'person', id: selected.id, label: selected.name, detail: '', alert: false }],
    );

    expect(agencyShadowRestoreToken('autosave')).toBe('autosave');
    expect(agencyShadowRestoreToken('branch_a')).toBe('collection:branch_a');
    expect(ids[0]).toBe(selected.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(serializeWorld(world)).toBe(before);
  });

  it('builds dossier options from the observer ledger without owning world state', () => {
    const world = createWorld('架构-人物档案');
    const character = world.characters[0];
    const attached = attachAgencyShadowBranch(createAgencyShadowLedger(), world, 'create');
    const ledger = ensureAgencyShadowCharacters(
      attached.ledger,
      attached.branchId,
      world,
      [character.id],
    );

    expect(agencyDossierOptions(createAgencyShadowLedger(), null, character.id)).toEqual({});
    expect(agencyDossierOptions(ledger, attached.branchId, character.id).projection).toMatchObject({
      characterId: character.id,
      seed: world.seed,
      sourceWorldHash: world.hash,
    });
  });
});

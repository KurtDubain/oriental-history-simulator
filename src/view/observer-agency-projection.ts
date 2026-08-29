import type { PersonAgencyQuarterChoiceView } from '../components/Inspector';
import type { WorldState } from '../sim/types';
import type { PersonAgencyDossierOptions } from './person-dossier-adapter';
import type { Selection } from './observer-shell-contract';
import {
  MAX_AGENCY_SHADOW_CHARACTERS,
  getAgencyShadowProjection,
  toAgencyShadowPlayerEntries,
  type AgencyShadowLedger,
  type AgencyShadowPlayerEntry,
} from './v1-agency-shadow';
import type { ObserverWatchItem } from './v1-observer';

export function agencyShadowRestoreToken(slot: string): string {
  return slot === 'autosave' ? 'autosave' : `collection:${slot}`;
}

function agencyPeriodLabel(turn: number): string {
  const seasons = ['春', '夏', '秋', '冬'] as const;
  const safeTurn = Math.max(0, Math.floor(turn));
  return `第 ${Math.floor(safeTurn / 4) + 1} 年${seasons[safeTurn % 4]}`;
}

export function agencyTrackedCharacterIds(
  world: WorldState,
  selection: Selection,
  watchlist: readonly ObserverWatchItem[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id) || !world.characters.some((character) => character.id === id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (selection?.kind === 'person') add(selection.id);
  watchlist.filter((item) => item.kind === 'person').forEach((item) => add(item.id));
  [...world.armies].sort((left, right) => left.id.localeCompare(right.id)).forEach((army) => add(army.deputyCommanderId));
  [...world.fleets].sort((left, right) => left.id.localeCompare(right.id)).forEach((fleet) => add(fleet.deputyCommanderId));
  [...world.situationSystem.situations]
    .filter((situation) => situation.status === 'open')
    .sort((left, right) => right.tension - left.tension || left.id.localeCompare(right.id))
    .forEach((situation) => {
      situation.executableActorIds.forEach(add);
      situation.participants.coreCharacterIds.forEach(add);
    });
  [...world.polities]
    .filter((polity) => polity.alive)
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((polity) => add(polity.rulerId));
  [...world.armies].sort((left, right) => left.id.localeCompare(right.id)).forEach((army) => add(army.commanderId));
  [...world.characters]
    .filter((character) => character.alive)
    .sort((left, right) => right.influence - left.influence || right.renown - left.renown || left.id.localeCompare(right.id))
    .forEach((character) => add(character.id));
  return ids.slice(0, MAX_AGENCY_SHADOW_CHARACTERS);
}

function quarterChoiceFromAgencyEntry(entry: AgencyShadowPlayerEntry): PersonAgencyQuarterChoiceView {
  const outcome = entry.conclusion === '相合'
    ? 'aligned'
    : entry.conclusion === '仅见盘算'
      ? 'unobserved'
      : entry.conclusion === '仅见旧制'
        ? 'not_applicable'
        : 'diverged';
  return {
    periodLabel: agencyPeriodLabel(entry.turn),
    intended: entry.intended ?? '季初没有留下可与此事核对的明确打算',
    actual: entry.actual ?? '本季没有出现与这项盘算相应的主帅任命',
    outcome,
    reason: entry.reason,
    sourceEventId: entry.sourceEventId,
  };
}

export function agencyDossierOptions(
  ledger: AgencyShadowLedger,
  branchId: string | null,
  characterId: string,
): PersonAgencyDossierOptions {
  if (!branchId) return {};
  const projection = getAgencyShadowProjection(ledger, branchId, characterId);
  const branch = ledger.branches.find((item) => item.id === branchId);
  const comparison = branch
    ? toAgencyShadowPlayerEntries(
        branch.comparisons.filter((item) => item.actorId === characterId),
        1,
      )[0]
    : undefined;
  return {
    projection,
    quarterChoice: comparison ? quarterChoiceFromAgencyEntry(comparison) : null,
  };
}

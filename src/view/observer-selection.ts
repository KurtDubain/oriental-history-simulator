import type { WorldState } from '../sim/types';
import { compact } from './dossier-adapter-shared';
import { toSystemInspector } from './map-dossier-adapter';
import { projectSituationSnapshotItem } from './situation-snapshot';
import type { Selection } from './observer-shell-contract';
import type { ObserverWatchItem } from './v1-observer';

/** Resolve a current observer selection without changing the supplied world. */
export function selectedEntityLabel(world: WorldState, selection: Selection): string | null {
  if (!selection) return null;
  if (selection.kind === 'region') return world.regions.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'country') return world.polities.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'family') return world.families?.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'person') return world.characters.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'seaZone') return world.seaZones.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'army') return world.armies.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'fleet') return world.fleets.find((item) => item.id === selection.id)?.name ?? null;
  if (selection.kind === 'practice') return world.practices.find((item) => item.id === selection.id)?.name ?? null;
  const system = toSystemInspector(world, selection.kind, selection.id);
  return system?.name ?? null;
}

export function watchItemForSelection(
  world: WorldState,
  selection: Exclude<Selection, null>,
): ObserverWatchItem | null {
  const label = selectedEntityLabel(world, selection);
  if (!label) return null;
  let detail = '等待下一条相关史事';
  if (selection.kind === 'country') {
    const item = world.polities.find((candidate) => candidate.id === selection.id);
    if (item) detail = `${item.alive ? item.governmentForm : '已亡政权'} · ${item.controlledRegionIds.length}州域`;
  } else if (selection.kind === 'family') {
    const item = world.families.find((candidate) => candidate.id === selection.id);
    if (item) detail = `${item.memberIds.length}名成员 · 声望${Math.round(item.prestige)}`;
  } else if (selection.kind === 'person') {
    const item = world.characters.find((candidate) => candidate.id === selection.id);
    if (item) detail = `${item.alive ? item.role : '已故'} · ${item.age}岁 · 影响${Math.round(item.influence)}`;
  } else if (selection.kind === 'region') {
    const item = world.regions.find((candidate) => candidate.id === selection.id);
    const owner = item ? world.polities.find((candidate) => candidate.id === item.controllerId) : null;
    if (item) detail = `${owner?.name ?? '无主'} · 人口${compact.format(item.population)} · 动荡${Math.round(item.unrest)}`;
  } else {
    const system = toSystemInspector(world, selection.kind, selection.id);
    if (system) detail = system.subtitle;
  }
  return { kind: selection.kind, id: selection.id, label, detail, alert: false };
}

export function watchItemForSituation(
  world: WorldState,
  situationId: string,
): ObserverWatchItem | null {
  const situation = world.situationSystem.situations.find((item) => item.id === situationId);
  if (!situation) return null;
  const snapshot = projectSituationSnapshotItem(situation, world);
  return {
    kind: 'situation',
    id: situation.id,
    label: snapshot.title,
    detail: `${snapshot.statusLabel} · ${snapshot.phaseLabel} · 张力${Math.round(snapshot.tension)}`,
    alert: false,
  };
}

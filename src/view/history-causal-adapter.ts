import type { CausalEvent, CausalFactor, CausalReference } from '../components/CausalDrawer';
import type { ChronicleEvent, ChronicleTone } from '../components/Chronicle';
import type { EventCategory, HistoryEvent, WorldState } from '../sim/types';
import {
  character,
  family,
  polity,
  region,
  uniqueArchiveLinks,
} from './dossier-adapter-shared';

function tone(category: EventCategory, kind: string): ChronicleTone {
  if (kind.includes('继承') || kind.includes('即位') || kind.includes('建国')) return 'succession';
  if (category === '军事' || category === '外交') return 'conflict';
  if (kind.includes('饥') || kind.includes('叛') || kind.includes('灭亡')) return 'crisis';
  if (category === '经济' || category === '人口') return 'prosperity';
  return 'neutral';
}

export function toChronicleEvent(world: WorldState, item: HistoryEvent): ChronicleEvent {
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    category: item.category,
    title: item.title,
    summary: item.summary,
    location: item.regionIds.map((id) => region(world, id)?.name).filter(Boolean).join('、'),
    actors: item.actorIds.map((id) => character(world, id)?.name).filter((name): name is string => Boolean(name)),
    tone: tone(item.category, item.kind),
    isMajor: item.importance >= 4,
    causeCount: item.causes.length,
  };
}

function factorRole(index: number, total: number, explicitRole?: HistoryEvent['causes'][number]['role']): CausalFactor['role'] {
  if (explicitRole === '结构') return 'structure';
  if (explicitRole === '条件') return 'condition';
  if (explicitRole === '触发') return 'trigger';
  if (explicitRole === '选择') return 'choice';
  if (explicitRole === '结果') return 'outcome';
  if (index === total - 1) return 'trigger';
  if (index === 0) return 'structure';
  return 'condition';
}

function causalActorSummary(world: WorldState, item: HistoryEvent) {
  if (!item.actorIds.length) return undefined;
  if (item.kind === 'world_created') return `${item.actorIds.length}名初始人物`;
  const names = item.actorIds
    .map((id) => character(world, id)?.name)
    .filter((name): name is string => Boolean(name));
  const shown = names.slice(0, 6).join('、');
  return names.length > 6 ? `${shown}等${names.length}人` : shown || `${item.actorIds.length}名相关人物`;
}

function causalReference(world: WorldState, ref: NonNullable<HistoryEvent['causes'][number]['refs']>[number]): CausalReference | null {
  const detail = ref.field ? `${ref.label} · ${ref.field}` : ref.label;
  if (ref.entityType === 'region') {
    const item = region(world, ref.entityId);
    return item ? { id: item.id, kind: 'region', label: item.name, detail } : null;
  }
  if (ref.entityType === 'seaZone') {
    const item = world.seaZones.find((candidate) => candidate.id === ref.entityId);
    return item ? { id: item.id, kind: 'seaZone', label: item.name, detail } : null;
  }
  if (ref.entityType === 'fleet') {
    const item = world.fleets.find((candidate) => candidate.id === ref.entityId);
    return item ? { id: item.id, kind: 'fleet', label: item.name, detail } : null;
  }
  if (ref.entityType === 'tradeCorridor') {
    const item = world.tradeCorridors.find((candidate) => candidate.id === ref.entityId);
    const from = item ? region(world, item.originRegionId) : undefined;
    const to = item ? region(world, item.destinationRegionId) : undefined;
    return item ? { id: item.id, kind: 'tradeCorridor', label: `${from?.name ?? '起地'}—${to?.name ?? '讫地'}`, detail } : null;
  }
  if (ref.entityType === 'practice') {
    const state = world.practiceStates.find((candidate) => candidate.id === ref.entityId);
    const item = world.practices.find((candidate) => candidate.id === (state?.practiceId ?? ref.entityId));
    const practiceRegion = state ? region(world, state.regionId) : undefined;
    return item ? { id: item.id, kind: 'practice', label: item.name, detail: practiceRegion ? `${practiceRegion.name} · ${detail}` : detail } : null;
  }
  if (ref.entityType === 'infection') {
    const infection = world.infections.find((candidate) => candidate.id === ref.entityId);
    const pathogen = world.pathogens.find((candidate) => candidate.id === infection?.pathogenId);
    return infection ? { id: infection.id, kind: 'outbreak', label: pathogen?.name ?? '疫病记录', detail } : null;
  }
  if (ref.entityType === 'pathogen') {
    const infection = world.infections.find((candidate) => candidate.pathogenId === ref.entityId);
    const pathogen = world.pathogens.find((candidate) => candidate.id === ref.entityId);
    return infection ? { id: infection.id, kind: 'outbreak', label: pathogen?.name ?? '疫病记录', detail } : null;
  }
  if (ref.entityType === 'shipment' || ref.entityType === 'migration') {
    const shipment = world.lastTurn?.trade.shipments.find((candidate) => candidate.id === ref.entityId);
    return shipment?.kind === '迁徙' ? { id: shipment.id, kind: 'migration', label: '当季迁徙', detail } : null;
  }
  if (ref.entityType === 'port') {
    const port = world.ports.find((candidate) => candidate.id === ref.entityId);
    const portRegion = region(world, port?.regionId);
    return portRegion ? { id: portRegion.id, kind: 'region', label: portRegion.name, detail: `港口 · ${detail}` } : null;
  }
  if (ref.entityType === 'character') {
    const item = character(world, ref.entityId);
    return item ? { id: item.id, kind: 'person', label: item.name, detail } : null;
  }
  if (ref.entityType === 'polity') {
    const item = polity(world, ref.entityId);
    return item ? { id: item.id, kind: 'country', label: item.name, detail } : null;
  }
  if (ref.entityType === 'army') {
    const army = world.armies.find((candidate) => candidate.id === ref.entityId);
    const commander = character(world, army?.commanderId);
    return commander ? { id: commander.id, kind: 'person', label: army?.name ?? commander.name, detail: `军团 · ${detail}` } : null;
  }
  return null;
}

export function toCausalEvent(world: WorldState, item: HistoryEvent): CausalEvent {
  const actorSummary = causalActorSummary(world, item);
  const factors: CausalFactor[] = item.causes.map((cause, index) => ({
    id: `${item.id}-cause-${index}`,
    role: factorRole(index, item.causes.length, cause.role),
    label: cause.label,
    detail: cause.weight >= 0.7 ? '这是促成该结果的主导压力。' : '这一条件放大了行动发生或成功的可能。',
    actor: (item.kind === 'world_created' && index === 0)
      || cause.role === '选择'
      || (!cause.role && index === item.causes.length - 1)
      ? actorSummary
      : undefined,
    evidence: cause.evidence,
    refs: (cause.refs ?? []).map((ref) => causalReference(world, ref)).filter((ref): ref is CausalReference => Boolean(ref)),
  }));
  factors.push({
    id: `${item.id}-outcome`,
    role: 'outcome',
    label: item.title,
    detail: item.summary,
    evidence: item.stateDeltas.length
      ? `${item.stateDeltas.length} 项世界状态发生改变`
      : item.evidence[0],
  });
  return {
    id: item.id,
    date: `第 ${item.year} 年 · ${item.season}`,
    title: item.title,
    summary: item.summary,
    factors,
    subjects: uniqueArchiveLinks([
      ...item.actorIds.map((id) => {
        const actor = character(world, id);
        return actor ? { id: actor.id, kind: 'person' as const, label: actor.name, detail: actor.role } : null;
      }),
      ...item.actorIds.map((id) => {
        const actorFamily = family(world, character(world, id)?.familyId);
        return actorFamily ? { id: actorFamily.id, kind: 'family' as const, label: actorFamily.name, detail: '相关人物家族' } : null;
      }),
      ...item.polityIds.map((id) => {
        const eventPolity = polity(world, id);
        return eventPolity ? { id: eventPolity.id, kind: 'country' as const, label: eventPolity.name, detail: '相关政权' } : null;
      }),
      ...item.causes.flatMap((cause) => (cause.refs ?? []).map((ref) => {
        const resolved = causalReference(world, ref);
        return resolved ? { id: resolved.id, kind: resolved.kind, label: resolved.label, detail: resolved.detail } : null;
      })),
    ]).slice(0, 8),
    consequence: item.stateDeltas.slice(0, 2).map((delta) => `${delta.field}：${String(delta.before)} → ${String(delta.after)}`).join('；'),
  };
}


import type { ArchiveDossier } from '../components/HistoricalArchive';
import type { FamilyInspectorData } from '../components/Inspector';
import type { CharacterState, FamilyState, HistoryEvent, WorldState } from '../sim/types';
import { readWorldHistory } from '../sim/archive';
import { isDefaultVisibleHistoryEvent } from './history-visibility';
import {
  character,
  compact,
  eventArchiveRecord,
  family,
  polity,
  scopedHistory,
  turnLabel,
  uniqueArchiveLinks,
} from './dossier-adapter-shared';
import {
  projectFamilyPoliticalFocus,
  type PoliticalFocusLink,
} from './political-focus';

export type FamilyInspectorProjection = FamilyInspectorData & {
  politicalFocus: readonly PoliticalFocusLink[];
};

export type FamilyArchiveProjection = ArchiveDossier & {
  politicalFocus: readonly PoliticalFocusLink[];
};

function familyEvent(item: FamilyState, event: HistoryEvent) {
  const memberIds = new Set(item.memberIds);
  return event.actorIds.some((id) => memberIds.has(id))
    || event.stateDeltas.some((delta) => delta.entityType === 'family' && delta.entityId === item.id);
}

export function toFamilyInspector(world: WorldState, item: FamilyState): FamilyInspectorProjection {
  const owner = polity(world, item.polityId);
  const founder = character(world, item.founderId);
  const head = character(world, item.headId);
  const members = item.memberIds
    .map((id) => character(world, id))
    .filter((candidate): candidate is CharacterState => Boolean(candidate))
    .sort((a, b) => Number(b.id === item.headId) - Number(a.id === item.headId)
      || Number(b.alive) - Number(a.alive)
      || (b.influence ?? b.renown) - (a.influence ?? a.renown));
  const alliances = item.marriageAllianceFamilyIds
    .map((id) => family(world, id))
    .filter((candidate): candidate is FamilyState => Boolean(candidate))
    .map((candidate) => ({ id: candidate.id, name: candidate.name, detail: '以婚姻维系的盟族' }));
  const leadingTradition = Object.entries(item.traditions)
    .sort(([, a], [, b]) => b - a)[0]?.[0];
  const traditionLabel = ({ political: '从政', military: '军旅', commercial: '商贸', scholarly: '学术' } as Record<string, string>)[leadingTradition] ?? '立身';
  return {
    id: item.id,
    name: item.name,
    branch: item.branchName ?? undefined,
    polity: owner?.name,
    polityId: owner?.id ?? null,
    founder: founder?.name ?? '始祖失考',
    founderId: founder?.id,
    head: head?.name ?? '家主未定',
    headId: head?.id,
    founded: turnLabel(item.foundedTurn),
    memberCount: members.length,
    prestige: item.prestige,
    wealth: item.wealth,
    politicalInfluence: item.politicalInfluence,
    traditions: item.traditions,
    alliances,
    members: members.slice(0, 20).map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      age: member.age,
      influence: member.influence ?? member.renown,
      alive: member.alive,
    })),
    history: scopedHistory(world, (event) => familyEvent(item, event)),
    politicalFocus: projectFamilyPoliticalFocus(world, item),
    summary: item.politicalInfluence >= 65
      ? `${item.name}已成为${owner?.name ?? '当世'}朝局中不可忽视的门第，以${traditionLabel}传统维系声名。`
      : item.prestige >= 60
        ? `${item.name}声望渐著，族中人物正在把${traditionLabel}传统转化为实际地位。`
        : `${item.name}仍在积累家产、婚盟与可传之后世的功名。`,
  };
}

export function toFamilyArchive(world: WorldState, item: FamilyState): FamilyArchiveProjection {
  const inspector = toFamilyInspector(world, item);
  const founder = character(world, item.founderId);
  const head = character(world, item.headId);
  const owner = polity(world, item.polityId);
  const relatedEvents = readWorldHistory(world)
    .filter((event) => isDefaultVisibleHistoryEvent(event) && familyEvent(item, event));
  const records = [
    { turn: item.foundedTurn, record: { id: `${item.id}-founded`, date: turnLabel(item.foundedTurn), title: `${item.name}立族`, summary: `${founder?.name ?? '先祖'}被后世奉为家族始祖。`, importance: 3 } },
    ...relatedEvents.map((event) => ({ turn: event.turn, record: eventArchiveRecord(event) })),
  ].sort((a, b) => a.turn - b.turn || a.record.id.localeCompare(b.record.id)).map((entry) => entry.record);
  const tradition = item.traditions;
  return {
    id: item.id,
    kind: 'family',
    eyebrow: '家族史 · 谱牒世录',
    title: `${item.name}世录`,
    subtitle: `${owner?.name ?? '无属'} · ${item.branchName ?? '本宗'} · ${item.memberIds.length} 名入谱人物`,
    lead: `${item.name}的兴衰由婚姻、家产、官职与每一代人的选择累积而成。声望能够继承，风险也会沿着血缘与盟约传给后人。`,
    facts: [
      { label: '始祖', value: inspector.founder }, { label: '家主', value: inspector.head },
      { label: '家望', value: String(Math.round(item.prestige)) }, { label: '家产', value: compact.format(item.wealth) },
      { label: '政治影响', value: String(Math.round(item.politicalInfluence)) }, { label: '婚盟', value: `${item.marriageAllianceFamilyIds.length} 家` },
    ],
    chapters: [
      { id: 'lineage', title: '源流与门第', paragraphs: [`${inspector.founder}于${turnLabel(item.foundedTurn)}开此一族，今由${inspector.head}主家。${inspector.summary ?? ''}`, item.parentFamilyId ? `此支由${family(world, item.parentFamilyId)?.name ?? '旧族'}分出，另号${item.branchName ?? '支族'}。` : '此族被视作独立本宗，未见更早分支记录。'] },
      { id: 'tradition', title: '家风所长', paragraphs: [`从政传统${Math.round(tradition.political)}，军旅传统${Math.round(tradition.military)}，商业传统${Math.round(tradition.commercial)}，学术传统${Math.round(tradition.scholarly)}。`, `这些传统不是永久加成，而是族人经历、任职与社会记忆的沉积；后代仍需以行动维持。`] },
      { id: 'marriage', title: '婚盟与人脉', paragraphs: [inspector.alliances?.length ? `${item.name}已与${inspector.alliances.map((alliance) => alliance.name).join('、')}结为婚盟。` : '此族尚无稳定婚盟，政治风险更多由本族独自承担。', `族中现有${inspector.members?.filter((member) => member.alive).length ?? 0}名在世人物可查，其中${inspector.members?.[0]?.name ?? '尚无人'}影响最著。`] },
    ],
    records,
    politicalFocus: inspector.politicalFocus,
    links: uniqueArchiveLinks([
      head ? { id: head.id, kind: 'person', label: head.name, detail: '当代家主' } : null,
      founder ? { id: founder.id, kind: 'person', label: founder.name, detail: '家族始祖' } : null,
      owner ? { id: owner.id, kind: 'country', label: owner.name, detail: '所属政权' } : null,
      ...(inspector.members ?? []).slice(0, 5).map((member) => ({ id: member.id, kind: 'person' as const, label: member.name, detail: member.alive ? member.role : '已故族人' })),
      ...(inspector.alliances ?? []).map((alliance) => ({ id: alliance.id, kind: 'family' as const, label: alliance.name, detail: alliance.detail })),
    ]).slice(0, 10),
  };
}

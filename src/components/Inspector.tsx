import {
  Activity,
  Anchor,
  BookOpenText,
  Castle,
  Crown,
  Handshake,
  HeartPulse,
  MapPin,
  Network,
  Route,
  ScrollText,
  Star,
  Sparkles,
  Swords,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ArchiveEntityKind } from './HistoricalArchive';
import '../styles/observer-ui.css';

export type DisplayValue = string | number;

export interface RegionInspectorData {
  id: string;
  name: string;
  terrain: string;
  climate?: string;
  polityName?: string;
  population: DisplayValue;
  food: DisplayValue;
  foodTrend?: number;
  cityLevel: DisplayValue;
  defense: number;
  unrest: number;
  governor?: string;
  resources?: string[];
  summary?: string;
  related?: Array<{ id: string; kind: ArchiveEntityKind; label: string; detail: string }>;
}

export interface InspectorRecord {
  id: string;
  date: string;
  title: string;
  summary: string;
  eventId?: string | null;
  importance?: number;
}

export interface CountryFactionView {
  id: string;
  name: string;
  kind: string;
  leaderId: string;
  leader: string;
  power: number;
  cohesion: number;
  agenda: string;
}

export interface CountryPowerholderView {
  id: string;
  name: string;
  office: string;
  influence: number;
  faction?: string;
}

export interface CountryDiplomacyView {
  polityId: string;
  polity: string;
  status: string;
  trust: number;
  threat: number;
  grievance: number;
  tradeDependency: number;
}

export interface CountryInspectorData {
  id: string;
  name: string;
  ruler: string;
  rulerId?: string;
  capital: string;
  government?: string;
  rulingFamily?: string;
  rulingFamilyId?: string | null;
  population: DisplayValue;
  treasury: DisplayValue;
  food: DisplayValue;
  regionCount: number;
  legitimacy: number;
  centralAuthority: number;
  administration: number;
  courtInfluence?: number;
  atWarWith?: string[];
  factions?: CountryFactionView[];
  powerholders?: CountryPowerholderView[];
  diplomacy?: CountryDiplomacyView[];
  history?: InspectorRecord[];
  status?: string;
  tradeRevenue?: DisplayValue;
  navalBudget?: DisplayValue;
  maritimeOrientation?: number;
  maritimeAssets?: SystemInspectorLink[];
}

export interface PersonAbilitySet {
  command: number;
  martial: number;
  governance: number;
  strategy: number;
  charisma: number;
  scholarship: number;
}

export interface PersonRelationshipView {
  id: string;
  targetId: string;
  name: string;
  relation: string;
  sentiment: string;
  detail?: string;
  memories?: string[];
}

export interface PersonInspectorData {
  id: string;
  name: string;
  courtesyName?: string;
  age: number;
  gender: string;
  role: string;
  lifeStage?: string;
  politicalClass?: string;
  tier?: string;
  origin?: string;
  family?: string;
  familyId?: string | null;
  polity?: string;
  health?: number;
  influence?: number;
  personalWealth?: DisplayValue;
  merit?: number;
  deputyExperience?: number;
  insubordination?: number;
  ambition: number;
  loyalty: number;
  caution: number;
  abilities: PersonAbilitySet;
  desires?: string[];
  traits?: string[];
  relationships?: PersonRelationshipView[];
  experiences?: InspectorRecord[];
  summary?: string;
}

export interface FamilyMemberView {
  id: string;
  name: string;
  role: string;
  age: number;
  influence: number;
  alive: boolean;
}

export interface FamilyAllianceView {
  id: string;
  name: string;
  detail: string;
}

export interface FamilyInspectorData {
  id: string;
  name: string;
  branch?: string;
  polity?: string;
  polityId?: string | null;
  founder: string;
  founderId?: string;
  head: string;
  headId?: string;
  founded: string;
  memberCount: number;
  prestige: number;
  wealth: DisplayValue;
  politicalInfluence: number;
  traditions: {
    political: number;
    military: number;
    commercial: number;
    scholarly: number;
  };
  alliances?: FamilyAllianceView[];
  members?: FamilyMemberView[];
  history?: InspectorRecord[];
  summary?: string;
}

export interface SystemInspectorLink {
  id: string;
  kind: ArchiveEntityKind;
  label: string;
  detail: string;
  value?: DisplayValue;
}

export interface SystemInspectorData {
  id: string;
  kind: 'seaZone' | 'fleet' | 'tradeCorridor' | 'practice' | 'outbreak' | 'migration';
  name: string;
  subtitle: string;
  summary: string;
  facts: Array<{ label: string; value: DisplayValue }>;
  meters?: Array<{ label: string; value: number }>;
  links?: SystemInspectorLink[];
  history?: InspectorRecord[];
}

interface InspectorSharedProps {
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  onClose?: () => void;
  onOpenArchive?: () => void;
  onSelectEntity?: (kind: ArchiveEntityKind, id: string) => void;
  onSelectEvent?: (eventId: string) => void;
}

export type InspectorProps =
  | (InspectorSharedProps & { kind: 'region'; data: RegionInspectorData })
  | (InspectorSharedProps & { kind: 'country'; data: CountryInspectorData })
  | (InspectorSharedProps & { kind: 'family'; data: FamilyInspectorData })
  | (InspectorSharedProps & { kind: 'person'; data: PersonInspectorData })
  | (InspectorSharedProps & { kind: 'system'; data: SystemInspectorData });

const COMPACT_NUMBER = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });

function display(value: DisplayValue) {
  return typeof value === 'number' ? COMPACT_NUMBER.format(value) : value;
}

function Meter({ label, value }: { label: string; value: number }) {
  const normalized = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className="observer-meter">
      <div className="observer-meter__label"><span>{label}</span><strong>{Math.round(normalized)}</strong></div>
      <span className="observer-meter__track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}>
        <span className="observer-meter__fill" style={{ width: `${normalized}%` }} />
      </span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: DisplayValue }) {
  if (value === undefined || value === '') return null;
  return <div className="observer-fact"><dt>{label}</dt><dd>{display(value)}</dd></div>;
}

function InspectorActions({ label, isFollowing, onToggleFollow, onOpenArchive, onClose }: InspectorSharedProps & { label: string }) {
  return (
    <div className="observer-inspector__actions">
      {onOpenArchive ? <button type="button" className="observer-icon-button" aria-label={`展开${label}史卷`} onClick={onOpenArchive}><BookOpenText size={17} aria-hidden="true" /></button> : null}
      {onToggleFollow ? (
        <button type="button" className="observer-icon-button" data-active={isFollowing || undefined} aria-label={isFollowing ? `取消关注${label}` : `关注${label}`} aria-pressed={isFollowing} onClick={onToggleFollow}>
          <Star size={17} fill={isFollowing ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      ) : null}
      {onClose ? <button type="button" className="observer-icon-button" aria-label="关闭档案" onClick={onClose}><X size={18} aria-hidden="true" /></button> : null}
    </div>
  );
}

function InspectorTabs<T extends string>({ value, items, onChange }: { value: T; items: Array<{ id: T; label: string }>; onChange: (value: T) => void }) {
  const id = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, items.findIndex((item) => item.id === value));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    onChange(items[nextIndex].id);
    requestAnimationFrame(() => tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus());
  };
  return (
    <div ref={tabsRef} className="observer-inspector-tabs" role="tablist" aria-label="档案分页" onKeyDown={moveFocus}>
      {items.map((item) => (
        <button key={item.id} id={`${id}-tab-${item.id}`} type="button" role="tab" aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function LinkedName({ kind, id, children, onSelect }: { kind: ArchiveEntityKind; id?: string | null; children: string; onSelect?: (kind: ArchiveEntityKind, id: string) => void }) {
  if (!id || !onSelect) return <>{children}</>;
  return <button type="button" className="observer-text-link" onClick={() => onSelect(kind, id)}>{children}</button>;
}

function RecordList({ records, onSelectEvent }: { records: InspectorRecord[]; onSelectEvent?: (eventId: string) => void }) {
  if (!records.length) return <p className="observer-inspector__empty">尚无可按年月查考的记载。</p>;
  return (
    <ol className="observer-inspector-records">
      {records.map((record) => (
        <li key={record.id} data-major={(record.importance ?? 0) >= 4 || undefined}>
          <span>{record.date}</span>
          {record.eventId && onSelectEvent ? (
            <button type="button" onClick={() => onSelectEvent(record.eventId!)}><strong>{record.title}</strong><small>{record.summary}</small></button>
          ) : <div><strong>{record.title}</strong><small>{record.summary}</small></div>}
        </li>
      ))}
    </ol>
  );
}

function relationshipTone(sentiment: string): 'positive' | 'negative' | 'cautious' | 'neutral' {
  if (/亲|信|恩/.test(sentiment)) return 'positive';
  if (/怨|不睦/.test(sentiment)) return 'negative';
  if (/惧/.test(sentiment)) return 'cautious';
  return 'neutral';
}

function RelationshipConstellation({
  name,
  relationships,
  onSelect,
}: {
  name: string;
  relationships: PersonRelationshipView[];
  onSelect?: (kind: ArchiveEntityKind, id: string) => void;
}) {
  const visible = relationships.slice(0, 8);
  if (!visible.length) return null;
  return (
    <svg className="observer-relationship-map" viewBox="0 0 300 190" role="img" aria-label={`${name}的关系图，含${visible.length}名相关人物`}>
      <title>{name}的关系图</title>
      {visible.map((relation, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / visible.length;
        const x = 150 + Math.cos(angle) * 102;
        const y = 95 + Math.sin(angle) * 66;
        return <line key={`line-${relation.id}`} x1="150" y1="95" x2={x} y2={y} data-tone={relationshipTone(relation.sentiment)} />;
      })}
      <g className="observer-relationship-map__center" aria-hidden="true">
        <circle cx="150" cy="95" r="27" />
        <text x="150" y="99">{name.slice(0, 4)}</text>
      </g>
      {visible.map((relation, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / visible.length;
        const x = 150 + Math.cos(angle) * 102;
        const y = 95 + Math.sin(angle) * 66;
        return (
          <g
            className="observer-relationship-map__node"
            key={relation.id}
            data-tone={relationshipTone(relation.sentiment)}
            role="button"
            tabIndex={0}
            aria-label={`${relation.name}，${relation.relation}，${relation.sentiment}`}
            onClick={() => onSelect?.('person', relation.targetId)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect?.('person', relation.targetId);
              }
            }}
          >
            <circle cx={x} cy={y} r="19" />
            <text x={x} y={y + 3}>{relation.name.slice(0, 4)}</text>
            <text className="observer-relationship-map__relation" x={x} y={y + 30}>{relation.sentiment}</text>
          </g>
        );
      })}
    </svg>
  );
}

function RegionInspector({ data, ...actions }: Extract<InspectorProps, { kind: 'region' }>) {
  return (
    <>
      <div className="observer-inspector__header">
        <div className="observer-inspector__identity"><span className="observer-inspector__kind"><MapPin size={14} aria-hidden="true" />地域档案</span><h2>{data.name}</h2><p>{[data.polityName, data.terrain, data.climate].filter(Boolean).join(' · ')}</p></div>
        <InspectorActions label={data.name} {...actions} />
      </div>
      {data.summary ? <p className="observer-inspector__summary">{data.summary}</p> : null}
      <section className="observer-inspector__section" aria-labelledby="region-ledger-heading"><h3 id="region-ledger-heading">地方帐簿</h3><dl className="observer-facts"><Fact label="人口" value={data.population} /><Fact label="粮储" value={data.food} /><Fact label="城邑" value={data.cityLevel} /><Fact label="长官" value={data.governor ?? '暂缺'} /></dl></section>
      <section className="observer-inspector__section" aria-labelledby="region-stability-heading"><h3 id="region-stability-heading">局势</h3><Meter label="城防" value={data.defense} /><Meter label="动荡" value={data.unrest} /></section>
      {data.resources?.length ? <section className="observer-inspector__section" aria-labelledby="region-resource-heading"><h3 id="region-resource-heading">地方所产</h3><ul className="observer-tag-list">{data.resources.map((resource) => <li key={resource}>{resource}</li>)}</ul></section> : null}
      {data.related?.length ? <section className="observer-inspector__section" aria-labelledby="region-flow-heading"><h3 id="region-flow-heading"><Route size={14} aria-hidden="true" />流通、疫病与技艺</h3><ul className="observer-entity-list">{data.related.map((link) => <li key={`${link.kind}-${link.id}`}><button type="button" onClick={() => actions.onSelectEntity?.(link.kind, link.id)}><span><strong>{link.label}</strong><small>{link.detail}</small></span></button></li>)}</ul></section> : null}
    </>
  );
}

function CountryInspector({ data, ...actions }: Extract<InspectorProps, { kind: 'country' }>) {
  const [tab, setTab] = useState<'realm' | 'court' | 'maritime' | 'diplomacy' | 'history'>('realm');
  useEffect(() => setTab('realm'), [data.id]);
  return (
    <>
      <div className="observer-inspector__header">
        <div className="observer-inspector__identity"><span className="observer-inspector__kind"><Castle size={14} aria-hidden="true" />国家档案</span><h2>{data.name}</h2><p>{[data.government, `都于${data.capital}`].filter(Boolean).join(' · ')}</p></div>
        <InspectorActions label={data.name} {...actions} />
      </div>
      {data.status ? <p className="observer-inspector__summary">{data.status}</p> : null}
      <InspectorTabs value={tab} onChange={setTab} items={[{ id: 'realm', label: '国势' }, { id: 'court', label: '朝局' }, { id: 'maritime', label: '海贸' }, { id: 'diplomacy', label: '邦交' }, { id: 'history', label: '国史' }]} />
      {tab === 'realm' ? (
        <div role="tabpanel">
          <section className="observer-inspector__section" aria-labelledby="country-ledger-heading">
            <h3 id="country-ledger-heading">国计</h3>
            <dl className="observer-facts"><Fact label="君主" value={data.ruler} /><Fact label="领地" value={`${data.regionCount} 郡`} /><Fact label="人口" value={data.population} /><Fact label="府库" value={data.treasury} /><Fact label="粮储" value={data.food} /><Fact label="宗主家族" value={data.rulingFamily} /></dl>
            {data.rulingFamily ? <p className="observer-inspector__jump"><Network size={13} aria-hidden="true" /><LinkedName kind="family" id={data.rulingFamilyId} onSelect={actions.onSelectEntity}>{data.rulingFamily}</LinkedName></p> : null}
          </section>
          <section className="observer-inspector__section" aria-labelledby="country-power-heading"><h3 id="country-power-heading">政权根基</h3><Meter label="合法性" value={data.legitimacy} /><Meter label="中央权威" value={data.centralAuthority} /><Meter label="行政能力" value={data.administration} />{data.courtInfluence !== undefined ? <Meter label="朝廷控制" value={data.courtInfluence} /> : null}</section>
          {data.atWarWith?.length ? <section className="observer-inspector__section observer-inspector__section--warning" aria-labelledby="country-war-heading"><h3 id="country-war-heading"><Swords size={14} aria-hidden="true" />战事中</h3><p>正与 {data.atWarWith.join('、')} 交战</p></section> : null}
        </div>
      ) : null}
      {tab === 'court' ? (
        <div role="tabpanel">
          <section className="observer-inspector__section" aria-labelledby="country-powerholder-heading">
            <h3 id="country-powerholder-heading"><Crown size={14} aria-hidden="true" />权力中枢</h3>
            {data.powerholders?.length ? <ul className="observer-entity-list">{data.powerholders.map((person) => <li key={person.id}><button type="button" onClick={() => actions.onSelectEntity?.('person', person.id)}><span><strong>{person.name}</strong><small>{person.office}{person.faction ? ` · ${person.faction}` : ''}</small></span><b>{Math.round(person.influence)}</b></button></li>)}</ul> : <p className="observer-inspector__empty">朝中尚无足以独据一席的权臣。</p>}
          </section>
          <section className="observer-inspector__section" aria-labelledby="country-faction-heading">
            <h3 id="country-faction-heading"><UsersRound size={14} aria-hidden="true" />朝中派系</h3>
            {data.factions?.length ? data.factions.map((faction) => <div className="observer-faction" key={faction.id}><div><strong>{faction.name}</strong><span>{faction.kind} · 所图：{faction.agenda}</span></div><button type="button" onClick={() => actions.onSelectEntity?.('person', faction.leaderId)}>{faction.leader}领袖</button><Meter label="权势" value={faction.power} /><Meter label="凝聚" value={faction.cohesion} /></div>) : <p className="observer-inspector__empty">派系尚未形成稳定名目。</p>}
          </section>
        </div>
      ) : null}
      {tab === 'maritime' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="country-maritime-heading"><h3 id="country-maritime-heading"><Anchor size={14} aria-hidden="true" />海贸与舰政</h3><dl className="observer-facts"><Fact label="贸易收入" value={data.tradeRevenue} /><Fact label="海军预算" value={data.navalBudget} /></dl>{data.maritimeOrientation !== undefined ? <Meter label="向海倾向" value={data.maritimeOrientation} /> : null}{data.maritimeAssets?.length ? <ul className="observer-entity-list observer-entity-list--after-meter">{data.maritimeAssets.map((asset) => <li key={`${asset.kind}-${asset.id}`}><button type="button" onClick={() => actions.onSelectEntity?.(asset.kind, asset.id)}><span><strong>{asset.label}</strong><small>{asset.detail}</small></span>{asset.value !== undefined ? <b>{display(asset.value)}</b> : null}</button></li>)}</ul> : <p className="observer-inspector__empty">尚无足以维持远海行动的舰队或港口。</p>}</section></div> : null}
      {tab === 'diplomacy' ? (
        <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="country-diplomacy-heading"><h3 id="country-diplomacy-heading"><Handshake size={14} aria-hidden="true" />邦交形势</h3>
          {data.diplomacy?.length ? <ul className="observer-diplomacy-list">{data.diplomacy.map((relation) => <li key={relation.polityId} data-status={relation.status}><button type="button" onClick={() => actions.onSelectEntity?.('country', relation.polityId)}><span><strong>{relation.polity}</strong><small>{relation.status} · 信任 {Math.round(relation.trust)}</small></span><span><b>威胁 {Math.round(relation.threat)}</b><small>宿怨 {Math.round(relation.grievance)} · 商贸 {Math.round(relation.tradeDependency)}</small></span></button></li>)}</ul> : <p className="observer-inspector__empty">暂无可考的邦交往来。</p>}
        </section></div>
      ) : null}
      {tab === 'history' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="country-history-heading"><h3 id="country-history-heading"><ScrollText size={14} aria-hidden="true" />国史摘录</h3><RecordList records={data.history ?? []} onSelectEvent={actions.onSelectEvent} /></section></div> : null}
    </>
  );
}

function FamilyInspector({ data, ...actions }: Extract<InspectorProps, { kind: 'family' }>) {
  const [tab, setTab] = useState<'standing' | 'members' | 'history'>('standing');
  useEffect(() => setTab('standing'), [data.id]);
  return (
    <>
      <div className="observer-inspector__header">
        <div className="observer-inspector__identity"><span className="observer-inspector__kind"><Network size={14} aria-hidden="true" />家族档案</span><h2>{data.name}</h2><p>{[data.branch, data.polity, `${data.memberCount}名录中成员`].filter(Boolean).join(' · ')}</p></div>
        <InspectorActions label={data.name} {...actions} />
      </div>
      {data.summary ? <p className="observer-inspector__summary">{data.summary}</p> : null}
      <InspectorTabs value={tab} onChange={setTab} items={[{ id: 'standing', label: '门第' }, { id: 'members', label: '谱系' }, { id: 'history', label: '家史' }]} />
      {tab === 'standing' ? <div role="tabpanel">
        <section className="observer-inspector__section" aria-labelledby="family-ledger-heading"><h3 id="family-ledger-heading">门第帐</h3><dl className="observer-facts"><Fact label="始祖" value={data.founder} /><Fact label="家主" value={data.head} /><Fact label="立族" value={data.founded} /><Fact label="家产" value={data.wealth} /></dl>{data.polity && data.polityId ? <p className="observer-inspector__jump"><Castle size={13} aria-hidden="true" /><LinkedName kind="country" id={data.polityId} onSelect={actions.onSelectEntity}>{data.polity}</LinkedName></p> : null}</section>
        <section className="observer-inspector__section" aria-labelledby="family-standing-heading"><h3 id="family-standing-heading">家势与传统</h3><Meter label="家族声望" value={data.prestige} /><Meter label="政治影响" value={data.politicalInfluence} /><Meter label="从政传统" value={data.traditions.political} /><Meter label="军旅传统" value={data.traditions.military} /><Meter label="商业传统" value={data.traditions.commercial} /><Meter label="学术传统" value={data.traditions.scholarly} /></section>
        {data.alliances?.length ? <section className="observer-inspector__section" aria-labelledby="family-alliance-heading"><h3 id="family-alliance-heading"><Handshake size={14} aria-hidden="true" />婚姻盟族</h3><ul className="observer-entity-list">{data.alliances.map((alliance) => <li key={alliance.id}><button type="button" onClick={() => actions.onSelectEntity?.('family', alliance.id)}><span><strong>{alliance.name}</strong><small>{alliance.detail}</small></span></button></li>)}</ul></section> : null}
      </div> : null}
      {tab === 'members' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="family-members-heading"><h3 id="family-members-heading"><UsersRound size={14} aria-hidden="true" />族中人物</h3>{data.members?.length ? <ul className="observer-entity-list">{data.members.map((member) => <li key={member.id} data-muted={!member.alive || undefined}><button type="button" onClick={() => actions.onSelectEntity?.('person', member.id)}><span><strong>{member.name}</strong><small>{member.alive ? `${member.age}岁 · ${member.role}` : '已故 · 载于族谱'}</small></span><b>{Math.round(member.influence)}</b></button></li>)}</ul> : <p className="observer-inspector__empty">族谱中尚无可展开的人物。</p>}</section></div> : null}
      {tab === 'history' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="family-history-heading"><h3 id="family-history-heading"><ScrollText size={14} aria-hidden="true" />家史摘录</h3><RecordList records={data.history ?? []} onSelectEvent={actions.onSelectEvent} /></section></div> : null}
    </>
  );
}

function PersonInspector({ data, ...actions }: Extract<InspectorProps, { kind: 'person' }>) {
  const [tab, setTab] = useState<'life' | 'mind' | 'relations' | 'history'>('life');
  useEffect(() => setTab('life'), [data.id]);
  const abilities: Array<[string, number]> = [['统率', data.abilities.command], ['武勇', data.abilities.martial], ['政略', data.abilities.governance], ['谋略', data.abilities.strategy], ['魅力', data.abilities.charisma], ['学识', data.abilities.scholarship]];
  return (
    <>
      <div className="observer-inspector__header">
        <div className="observer-inspector__identity"><span className="observer-inspector__kind"><UserRound size={14} aria-hidden="true" />人物档案</span><h2>{data.name}{data.courtesyName ? <small> 字{data.courtesyName}</small> : null}</h2><p>{[data.polity, data.role, data.lifeStage, data.tier, `${data.age}岁`].filter(Boolean).join(' · ')}</p></div>
        <InspectorActions label={data.name} {...actions} />
      </div>
      {data.summary ? <p className="observer-inspector__summary">{data.summary}</p> : null}
      <InspectorTabs value={tab} onChange={setTab} items={[{ id: 'life', label: '生平' }, { id: 'mind', label: '心志' }, { id: 'relations', label: '关系' }, { id: 'history', label: '经历' }]} />
      {tab === 'life' ? <div role="tabpanel">
        <section className="observer-inspector__section" aria-labelledby="person-origin-heading"><h3 id="person-origin-heading">身世与处境</h3><dl className="observer-facts"><Fact label="性别" value={data.gender} /><Fact label="出身" value={data.origin} /><Fact label="阶层" value={data.politicalClass} /><Fact label="家族" value={data.family} /><Fact label="影响" value={data.influence} /><Fact label="私产" value={data.personalWealth} /></dl>{data.family ? <p className="observer-inspector__jump"><Network size={13} aria-hidden="true" /><LinkedName kind="family" id={data.familyId} onSelect={actions.onSelectEntity}>{data.family}</LinkedName></p> : null}{data.health !== undefined ? <div className="observer-health"><HeartPulse size={14} aria-hidden="true" /><Meter label="健康" value={data.health} /></div> : null}</section>
        <section className="observer-inspector__section" aria-labelledby="person-ability-heading"><h3 id="person-ability-heading">才能</h3><div className="observer-ability-grid">{abilities.map(([label, value]) => <div className="observer-ability" key={label}><span>{label}</span><strong>{Math.round(value)}</strong></div>)}</div><dl className="observer-facts observer-facts--after-grid"><Fact label="功绩" value={data.merit} /><Fact label="副将历练" value={data.deputyExperience} /></dl></section>
      </div> : null}
      {tab === 'mind' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="person-motive-heading"><h3 id="person-motive-heading">心性与所求</h3><Meter label="野心" value={data.ambition} /><Meter label="忠诚" value={data.loyalty} /><Meter label="谨慎" value={data.caution} />{data.insubordination !== undefined ? <Meter label="抗命倾向" value={data.insubordination} /> : null}{[...(data.traits ?? []), ...(data.desires ?? []).map((item) => `所求·${item}`)].length ? <ul className="observer-tag-list">{[...(data.traits ?? []), ...(data.desires ?? []).map((item) => `所求·${item}`)].map((item) => <li key={item}>{item}</li>)}</ul> : null}</section></div> : null}
      {tab === 'relations' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="person-relation-heading"><h3 id="person-relation-heading"><Network size={14} aria-hidden="true" />关系与记忆</h3>{data.relationships?.length ? <><RelationshipConstellation name={data.name} relationships={data.relationships} onSelect={actions.onSelectEntity} /><ul className="observer-relation-list">{data.relationships.map((relation) => <li key={relation.id}><button type="button" onClick={() => actions.onSelectEntity?.('person', relation.targetId)}><span><strong>{relation.name}</strong><small>{relation.relation} · {relation.sentiment}</small></span>{relation.detail ? <b>{relation.detail}</b> : null}</button>{relation.memories?.length ? <p>{relation.memories.join('；')}</p> : null}</li>)}</ul></> : <p className="observer-inspector__empty">此人尚无足以入档的人际记忆。</p>}</section></div> : null}
      {tab === 'history' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="person-history-heading"><h3 id="person-history-heading"><ScrollText size={14} aria-hidden="true" />人生经历</h3><RecordList records={data.experiences ?? []} onSelectEvent={actions.onSelectEvent} /></section></div> : null}
    </>
  );
}

const SYSTEM_META = {
  seaZone: { label: '海域档案', icon: Anchor },
  fleet: { label: '舰队档案', icon: Anchor },
  tradeCorridor: { label: '商路档案', icon: Route },
  practice: { label: '知识档案', icon: Sparkles },
  outbreak: { label: '疫病档案', icon: Activity },
  migration: { label: '迁徙档案', icon: Route },
} satisfies Record<SystemInspectorData['kind'], { label: string; icon: typeof Anchor }>;

function SystemInspector({ data, ...actions }: Extract<InspectorProps, { kind: 'system' }>) {
  const [tab, setTab] = useState<'status' | 'history'>('status');
  useEffect(() => setTab('status'), [data.id]);
  const meta = SYSTEM_META[data.kind];
  const Icon = meta.icon;
  return (
    <>
      <div className="observer-inspector__header">
        <div className="observer-inspector__identity">
          <span className="observer-inspector__kind"><Icon size={14} aria-hidden="true" />{meta.label}</span>
          <h2>{data.name}</h2>
          <p>{data.subtitle}</p>
        </div>
        <InspectorActions label={data.name} {...actions} />
      </div>
      <p className="observer-inspector__summary">{data.summary}</p>
      <InspectorTabs value={tab} onChange={setTab} items={[{ id: 'status', label: '现状' }, { id: 'history', label: '沿革' }]} />
      {tab === 'status' ? <div role="tabpanel">
        <section className="observer-inspector__section" aria-labelledby="system-ledger-heading">
          <h3 id="system-ledger-heading">当季所见</h3>
          <dl className="observer-facts">{data.facts.map((fact) => <Fact key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} />)}</dl>
        </section>
        {data.meters?.length ? <section className="observer-inspector__section" aria-labelledby="system-pressure-heading"><h3 id="system-pressure-heading">势与风险</h3>{data.meters.map((meter) => <Meter key={meter.label} label={meter.label} value={meter.value} />)}</section> : null}
        {data.links?.length ? <section className="observer-inspector__section" aria-labelledby="system-links-heading"><h3 id="system-links-heading">相关地点与载体</h3><ul className="observer-entity-list">{data.links.map((link) => <li key={`${link.kind}-${link.id}`}><button type="button" onClick={() => actions.onSelectEntity?.(link.kind, link.id)}><span><strong>{link.label}</strong><small>{link.detail}</small></span>{link.value !== undefined ? <b>{display(link.value)}</b> : null}</button></li>)}</ul></section> : null}
      </div> : null}
      {tab === 'history' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="system-history-heading"><h3 id="system-history-heading"><ScrollText size={14} aria-hidden="true" />可追溯史事</h3><RecordList records={data.history ?? []} onSelectEvent={actions.onSelectEvent} /></section></div> : null}
    </>
  );
}

export function Inspector(props: InspectorProps) {
  return (
    <aside className="observer-inspector" aria-label="对象档案">
      {props.kind === 'region' ? <RegionInspector {...props} /> : null}
      {props.kind === 'country' ? <CountryInspector {...props} /> : null}
      {props.kind === 'family' ? <FamilyInspector {...props} /> : null}
      {props.kind === 'person' ? <PersonInspector {...props} /> : null}
      {props.kind === 'system' ? <SystemInspector {...props} /> : null}
    </aside>
  );
}

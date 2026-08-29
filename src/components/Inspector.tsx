import {
  Activity,
  Anchor,
  BookOpenText,
  Castle,
  ChevronDown,
  ChevronUp,
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
import type { PersonEmbodimentView } from '../view/embodiment-view';
import '../styles/observer-ui.css';

export type { PersonEmbodiedActionView, PersonEmbodimentView } from '../view/embodiment-view';

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
  resources?: readonly PoliticalPowerResourceView[];
  categories?: readonly PoliticalPowerCategoryView[];
  recentMovement?: PoliticalPowerMovementView | null;
}

export interface CountryPowerholderView {
  id: string;
  name: string;
  office: string;
  influence: number;
  faction?: string;
  standing?: string;
}

export interface PoliticalPowerResourceView {
  id: string;
  category: string;
  label: string;
  detail: string;
  value: number;
  sourceEventId?: string | null;
}

export interface PoliticalPowerCategoryView {
  key: string;
  label: string;
  value: number;
  maximum: number;
}

export interface PoliticalPowerMovementView {
  id: string;
  periodLabel: string;
  direction: 'gained' | 'held' | 'lost';
  label: string;
  detail: string;
  sourceEventId?: string | null;
}

export interface HistoricalSceneView {
  id: string;
  periodLabel: string;
  title: string;
  summary: string;
  result: string;
  sourceEventId?: string | null;
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
  courtScenes?: readonly HistoricalSceneView[];
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

export interface PersonAgencyDesireView {
  label: string;
  core: boolean;
  reason?: string;
}

export type PersonAgencyGoalStatus = 'active' | 'achieved' | 'invalidated' | 'abandoned';

export interface PersonAgencyGoalView {
  id: string;
  label: string;
  status: PersonAgencyGoalStatus;
  progress: number;
  commitment: number;
  reason: string;
  barrier: string;
}

export type PersonAgencyPlanStepStatus = 'completed' | 'available' | 'blocked' | 'invalidated';

export interface PersonAgencyPlanStepView {
  label: string;
  status: PersonAgencyPlanStepStatus;
  reason: string;
}

export interface PersonAgencyDecisionView {
  label: string;
  status: Exclude<PersonAgencyGoalStatus, 'active'>;
  reason: string;
}

export interface PersonAgencyMemoryView {
  id: string;
  dateLabel: string;
  scopeLabel: string;
  title: string;
  interpretation: string;
  pinned: boolean;
  sourceEventId?: string | null;
}

export type PersonAgencyQuarterChoiceOutcome = 'aligned' | 'diverged' | 'unobserved' | 'not_applicable';

export interface PersonAgencyQuarterChoiceView {
  periodLabel: string;
  intended: string;
  actual: string;
  outcome: PersonAgencyQuarterChoiceOutcome;
  reason: string;
  sourceEventId?: string | null;
}

export type PersonAgencyCommandRequestStage = 'planned' | 'preparing' | 'submitted' | 'approved' | 'blocked';

export interface PersonAgencyCommandRequestEvidenceView {
  tone: 'support' | 'barrier';
  label: string;
  detail: string;
}

export interface PersonAgencyCommandRequestView {
  id: string;
  stage: PersonAgencyCommandRequestStage;
  periodLabel?: string | null;
  statusLabel: string;
  title: string;
  summary: string;
  evidence: readonly PersonAgencyCommandRequestEvidenceView[];
  sourceEventId?: string | null;
}

export interface PersonAgencyView {
  availability: 'active' | 'dormant' | 'closed';
  reason: string;
  barrier: string | null;
  longTermDirectionLabel: string;
  desires: readonly PersonAgencyDesireView[];
  primaryGoal: PersonAgencyGoalView | null;
  secondaryGoals: readonly PersonAgencyGoalView[];
  currentPlanSteps: readonly PersonAgencyPlanStepView[];
  recentDecision?: PersonAgencyDecisionView | null;
  memories?: readonly PersonAgencyMemoryView[];
  quarterChoice?: PersonAgencyQuarterChoiceView | null;
  commandRequest?: PersonAgencyCommandRequestView | null;
  powerPosition?: {
    total: number;
    standing: string;
    groupName?: string | null;
    resources: readonly PoliticalPowerResourceView[];
    recentMovements: readonly PoliticalPowerMovementView[];
  } | null;
  recentPowerScenes?: readonly HistoricalSceneView[];
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
  agency?: PersonAgencyView;
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
  kind: 'seaZone' | 'army' | 'fleet' | 'tradeCorridor' | 'practice' | 'outbreak' | 'migration';
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
  embodiment?: PersonEmbodimentView;
  onEnterEmbodiment?: () => void;
  onLeaveEmbodiment?: () => void;
  onChooseEmbodiedAction?: (actionId: string) => void;
  onCancelEmbodiedAction?: () => void;
  onDismissEmbodimentClosure?: () => void;
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

function InspectorTabs<T extends string>({ value, items, onChange, idPrefix }: { value: T; items: Array<{ id: T; label: string }>; onChange: (value: T) => void; idPrefix?: string }) {
  const generatedId = useId();
  const id = idPrefix ?? generatedId;
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
        <button key={item.id} id={`${id}-tab-${item.id}`} type="button" role="tab" aria-selected={value === item.id} aria-controls={idPrefix ? `${id}-panel-${item.id}` : undefined} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)}>
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

function HistoricalSceneList({
  scenes,
  onSelectEvent,
}: {
  scenes: readonly HistoricalSceneView[];
  onSelectEvent?: (eventId: string) => void;
}) {
  return (
    <ol className="observer-scene-list">
      {scenes.map((scene) => (
        <li key={scene.id}>
          <span>{scene.periodLabel}</span>
          <strong>{scene.title}</strong>
          <p>{scene.summary}</p>
          {scene.result ? <small>{scene.result}</small> : null}
          {scene.sourceEventId && onSelectEvent ? (
            <button type="button" onClick={() => onSelectEvent(scene.sourceEventId!)}>查原事</button>
          ) : null}
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
          {data.courtScenes?.length ? (
            <section className="observer-inspector__section observer-court-scenes" aria-labelledby="country-court-scene-heading">
              <h3 id="country-court-scene-heading"><ScrollText size={14} aria-hidden="true" />朝局近事</h3>
              <HistoricalSceneList scenes={data.courtScenes} onSelectEvent={actions.onSelectEvent} />
            </section>
          ) : null}
          <section className="observer-inspector__section" aria-labelledby="country-powerholder-heading">
            <h3 id="country-powerholder-heading"><Crown size={14} aria-hidden="true" />权力中枢</h3>
            {data.powerholders?.length ? <ul className="observer-entity-list">{data.powerholders.map((person) => <li key={person.id}><button type="button" onClick={() => actions.onSelectEntity?.('person', person.id)}><span><strong>{person.name}</strong><small>{person.office}{person.faction ? ` · ${person.faction}` : ''}</small></span><b>{person.standing ?? '权势'} {Math.round(person.influence)}</b></button></li>)}</ul> : <p className="observer-inspector__empty">朝中尚无足以独据一席的权臣。</p>}
          </section>
          <section className="observer-inspector__section" aria-labelledby="country-faction-heading">
            <h3 id="country-faction-heading"><UsersRound size={14} aria-hidden="true" />朝中派系</h3>
            {data.factions?.length ? data.factions.map((faction) => (
              <article className="observer-faction" key={faction.id} data-testid="faction-power-ledger">
                <header>
                  <div><strong>{faction.name}</strong><span>{faction.kind} · 所图：{faction.agenda}</span></div>
                  <b>权势 {Math.round(faction.power)}</b>
                </header>
                {faction.categories?.length ? (
                  <dl className="observer-faction__categories">
                    {faction.categories.slice(0, 5).map((category) => <div key={category.key}><dt>{category.label}</dt><dd>{Math.round(category.value)}</dd></div>)}
                  </dl>
                ) : null}
                {faction.recentMovement ? (
                  <p className="observer-faction__movement" data-direction={faction.recentMovement.direction}>
                    <span>{faction.recentMovement.periodLabel} · {faction.recentMovement.label}</span>
                    <strong>{faction.recentMovement.detail}</strong>
                    {faction.recentMovement.sourceEventId && actions.onSelectEvent ? <button type="button" onClick={() => actions.onSelectEvent?.(faction.recentMovement!.sourceEventId!)}>查原事</button> : null}
                  </p>
                ) : null}
                {faction.resources?.length ? (
                  <details className="observer-faction__assets">
                    <summary>查看权势构成 <span>{faction.resources.length} 项</span></summary>
                    <ol>{faction.resources.map((resource) => <li key={resource.id}><span><strong>{resource.label}</strong><small>{resource.detail}</small></span><b>+{Math.round(resource.value)}</b></li>)}</ol>
                  </details>
                ) : null}
                <footer>
                  <button type="button" onClick={() => actions.onSelectEntity?.('person', faction.leaderId)}>看领袖 · {faction.leader}</button>
                  <span>凝聚 {Math.round(faction.cohesion)}</span>
                </footer>
              </article>
            )) : <p className="observer-inspector__empty">派系尚未形成稳定名目。</p>}
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

const PERSON_GOAL_STATUS_LABELS = {
  active: '正在谋求',
  achieved: '已经达成',
  invalidated: '已无从继续',
  abandoned: '已经搁下',
} satisfies Record<PersonAgencyGoalStatus, string>;

const PERSON_PLAN_STATUS_LABELS = {
  completed: '条件已具',
  available: '正在准备',
  blocked: '尚待前项',
  invalidated: '此路已断',
} satisfies Record<PersonAgencyPlanStepStatus, string>;

const PERSON_QUARTER_CHOICE_LABELS = {
  aligned: '照着盘算走',
  diverged: '实际另有去向',
  unobserved: '尚未见行动',
  not_applicable: '尚无可比',
} satisfies Record<PersonAgencyQuarterChoiceOutcome, string>;

function AgencyScale({ label, value }: { label: string; value: number }) {
  const normalized = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className="observer-agency-scale">
      <div><span>{label}</span><strong>{Math.round(normalized)}</strong></div>
      <span className="observer-agency-scale__track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}>
        <span style={{ width: `${normalized}%` }} />
      </span>
    </div>
  );
}

function agencyEmptyGoalCopy(agency: PersonAgencyView) {
  if (agency.availability === 'dormant') return { title: '尚未入局', detail: agency.reason || '年岁尚轻，眼下还没有真正进入世事。' };
  if (agency.availability === 'closed') return { title: '生平已定', detail: agency.reason || '此人已不再形成新的打算。' };
  return { title: '仍在权衡', detail: '此人还没有把心中所重化为明确打算。' };
}

export function PersonAgencySections({
  agency,
  onSelectEvent,
  embodiment,
  onChooseEmbodiedAction,
  onCancelEmbodiedAction,
}: {
  agency: PersonAgencyView;
  onSelectEvent?: (eventId: string) => void;
  embodiment?: PersonEmbodimentView;
  onChooseEmbodiedAction?: (actionId: string) => void;
  onCancelEmbodiedAction?: () => void;
}) {
  const [memoriesExpanded, setMemoriesExpanded] = useState(false);
  const emptyGoal = agencyEmptyGoalCopy(agency);
  const memories = (agency.memories ?? []).slice(0, 16);
  const memoryListId = useId();
  const visibleMemories = memoriesExpanded ? memories : memories.slice(0, 3);
  const hiddenMemoryCount = Math.max(0, memories.length - visibleMemories.length);
  const quarterChoice = agency.quarterChoice;
  const commandRequest = agency.commandRequest;
  const commandSourceEventId = commandRequest
    && ['submitted', 'approved', 'blocked'].includes(commandRequest.stage)
    ? commandRequest.sourceEventId
    : null;
  const choiceReasonLabel = quarterChoice?.outcome === 'aligned'
    ? '为何相合'
    : quarterChoice?.outcome === 'diverged'
      ? '为何有别'
      : '查考说明';
  return (
    <>
      {embodiment?.active ? (
        <section className="observer-inspector__section observer-embodiment-actions" aria-labelledby="person-embodiment-actions-heading" data-testid="embodiment-actions">
          <div className="observer-embodiment-actions__heading">
            <div><span>本季只定一事</span><h3 id="person-embodiment-actions-heading">此刻能做什么</h3></div>
            <b>入世</b>
          </div>
          {embodiment.pending ? (
            <div className="observer-embodiment-pending" role="status" aria-live="polite">
              <span>已定 · 随下一季结算</span>
              <strong>{embodiment.pending.actorName} · {embodiment.pending.label}</strong>
              <p>对象：{embodiment.pending.targetLabel}。推进季度后，系统会按人物当时的身份、资源和关系给出结果。</p>
              {onCancelEmbodiedAction ? <button type="button" onClick={onCancelEmbodiedAction}>撤回本季决定</button> : null}
            </div>
          ) : embodiment.usedThisQuarter ? (
            <p className="observer-inspector__empty">本季的决定已经进入史册；到下一季才可再定一事。</p>
          ) : (
            <ol className="observer-embodiment-action-list">
              {embodiment.actions.map((action) => (
                <li key={action.actionId} data-available={action.available || undefined}>
                  <button
                    type="button"
                    disabled={!action.available}
                    onClick={() => onChooseEmbodiedAction?.(action.actionId)}
                  >
                    <span><strong>{action.identityLabel ? <i>{action.identityLabel}</i> : null}{action.label}</strong><b>{action.targetLabel}</b></span>
                    <p>{action.intent}</p>
                    <dl>
                      <div><dt>代价</dt><dd>{action.cost}</dd></div>
                      <div><dt>难处</dt><dd>{action.obstacle}</dd></div>
                      <div><dt>之后看</dt><dd>{action.nextSignal}</dd></div>
                    </dl>
                    {!action.available ? <small>{action.unavailableReason}</small> : <em>定下此事</em>}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {embodiment.lastResult ? (
            <div className="observer-embodiment-result" data-outcome={embodiment.lastResult.outcome}>
              <span>{embodiment.lastResult.periodLabel} · 上次结果</span>
              <p>{embodiment.lastResult.summary}</p>
              <small>接着看：{embodiment.lastResult.nextSignal}</small>
              {embodiment.lastResult.sourceEventId && onSelectEvent ? (
                <button type="button" onClick={() => onSelectEvent(embodiment.lastResult!.sourceEventId!)}>查这件事</button>
              ) : null}
            </div>
          ) : null}
          <p className="observer-embodiment-actions__note">你只替此人定下意图，不保证成功；其他人物与天下仍照常行动。</p>
        </section>
      ) : null}
      <section className="observer-inspector__section observer-agency" aria-labelledby="person-agency-desire-heading">
        <h3 id="person-agency-desire-heading">此人所重</h3>
        {agency.desires.length ? (
          <ul className="observer-agency-desires">
            {agency.desires.map((desire) => (
              <li key={desire.label} data-core={desire.core || undefined}>
                <div><strong>{desire.label}</strong><span>{desire.label === agency.longTermDirectionLabel ? '长远所向' : '同样看重'}</span></div>
                {desire.reason ? <p>{desire.reason}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="observer-inspector__empty">此人的心中轻重尚未显明。</p>}
      </section>

      {agency.powerPosition ? (
        <section className="observer-inspector__section observer-agency observer-power-position" aria-labelledby="person-power-position-heading" data-testid="person-power-position">
          <div className="observer-power-position__heading">
            <h3 id="person-power-position-heading">手中权势</h3>
            <span><strong>{agency.powerPosition.standing}</strong>{agency.powerPosition.total}</span>
          </div>
          {agency.powerPosition.groupName ? <p className="observer-power-position__faction">身在 {agency.powerPosition.groupName}</p> : null}
          {agency.powerPosition.resources.length ? (
            <ol className="observer-power-position__resources">
              {agency.powerPosition.resources.map((resource) => (
                <li key={resource.id}>
                  <span><strong>{resource.label}</strong><small>{resource.detail}</small></span>
                  <b>+{Math.round(resource.value)}</b>
                  {resource.sourceEventId && onSelectEvent ? <button type="button" onClick={() => onSelectEvent(resource.sourceEventId!)}>查原事</button> : null}
                </li>
              ))}
            </ol>
          ) : <p className="observer-inspector__empty">尚无正式官位、军令或明确支持可供调用。</p>}
          {agency.powerPosition.recentMovements[0] ? (
            <p className="observer-power-position__movement" data-direction={agency.powerPosition.recentMovements[0].direction}>
              <span>{agency.powerPosition.recentMovements[0].periodLabel} · {agency.powerPosition.recentMovements[0].label}</span>
              <strong>{agency.powerPosition.recentMovements[0].detail}</strong>
            </p>
          ) : null}
          <p className="observer-power-position__note">权势只来自眼下真实官职、军令、家门、声望和明确支持。</p>
        </section>
      ) : null}

      {agency.recentPowerScenes?.length ? (
        <section className="observer-inspector__section observer-agency observer-person-scenes" aria-labelledby="person-power-scenes-heading" data-testid="person-power-scenes">
          <h3 id="person-power-scenes-heading">近来发生</h3>
          <HistoricalSceneList scenes={agency.recentPowerScenes} onSelectEvent={onSelectEvent} />
        </section>
      ) : null}

      <section className="observer-inspector__section observer-agency observer-agency-memories" aria-labelledby="person-agency-memory-heading">
        <div className="observer-agency-section-heading">
          <h3 id="person-agency-memory-heading">放在心上的事</h3>
          {memories.length > 3 ? (
            <button type="button" aria-expanded={memoriesExpanded} aria-controls={memoryListId} onClick={() => setMemoriesExpanded((current) => !current)}>
              {memoriesExpanded ? '收起旧事' : `再看 ${hiddenMemoryCount} 桩旧事`}
            </button>
          ) : null}
        </div>
        {visibleMemories.length ? (
          <ol id={memoryListId} className="observer-agency-memory-list">
            {visibleMemories.map((memory) => (
              <li key={memory.id} data-pinned={memory.pinned || undefined}>
                <div className="observer-agency-memory__meta">
                  <span>{[memory.scopeLabel, memory.dateLabel].filter(Boolean).join(' · ')}</span>
                  {memory.pinned ? <b>难忘</b> : null}
                </div>
                <strong>{memory.title}</strong>
                <p>{memory.interpretation}</p>
                {memory.sourceEventId && onSelectEvent ? (
                  <button type="button" className="observer-agency-memory__source" onClick={() => onSelectEvent(memory.sourceEventId!)}>查原事</button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p className="observer-inspector__empty">眼下没有哪桩旧事格外牵动此人。</p>}
        <p className="observer-agency-memory__note">这里只记此人仍放在心上的事，完整生平见“经历”。</p>
      </section>

      <section className="observer-inspector__section observer-agency" aria-labelledby="person-agency-goal-heading">
        <h3 id="person-agency-goal-heading">眼下所图</h3>
        {agency.primaryGoal ? (
          <div className="observer-agency-goal" data-status={agency.primaryGoal.status}>
            <header><span>{PERSON_GOAL_STATUS_LABELS[agency.primaryGoal.status]}</span><strong>{agency.primaryGoal.label}</strong></header>
            <p><b>因何起意</b>{agency.primaryGoal.reason}</p>
            <div className="observer-agency-goal__scales">
              <AgencyScale label="进展" value={agency.primaryGoal.progress} />
              <AgencyScale label="决心" value={agency.primaryGoal.commitment} />
            </div>
            {agency.primaryGoal.barrier ? <p className="observer-agency__barrier"><b>眼下难处</b>{agency.primaryGoal.barrier}</p> : null}
          </div>
        ) : (
          <div className="observer-agency-empty">
            <strong>{emptyGoal.title}</strong>
            <p>{emptyGoal.detail}</p>
            {agency.barrier ? <p className="observer-agency__barrier"><b>眼下难处</b>{agency.barrier}</p> : null}
          </div>
        )}
        {agency.secondaryGoals.length ? (
          <div className="observer-agency-secondary">
            <h4>还在留意</h4>
            <ul>{agency.secondaryGoals.map((goal) => <li key={goal.id}><span>{goal.label}</span><small>{PERSON_GOAL_STATUS_LABELS[goal.status]}</small></li>)}</ul>
          </div>
        ) : null}
      </section>

      <section className="observer-inspector__section observer-agency" aria-labelledby="person-agency-plan-heading">
        <h3 id="person-agency-plan-heading">所行之路</h3>
        {agency.currentPlanSteps.length ? (
          <ol className="observer-agency-plan">
            {agency.currentPlanSteps.map((step, index) => (
              <li key={`${index}-${step.label}`} data-status={step.status}>
                <span className="observer-agency-plan__mark">{index + 1}</span>
                <div><span>{PERSON_PLAN_STATUS_LABELS[step.status]}</span><strong>{step.label}</strong><p>{step.reason}</p></div>
              </li>
            ))}
          </ol>
        ) : <p className="observer-inspector__empty">眼下还没有形成可行的准备路径。</p>}
      </section>

      {commandRequest ? (
        <section
          className="observer-inspector__section observer-agency observer-agency-command"
          aria-labelledby="person-agency-command-heading"
          data-testid="person-command-request"
          data-request-id={commandRequest.id}
          data-stage={commandRequest.stage}
        >
          <h3 id="person-agency-command-heading">请令进展</h3>
          <div className="observer-agency-command__record" data-stage={commandRequest.stage}>
            <header>
              {commandRequest.periodLabel ? <span>{commandRequest.periodLabel}</span> : <span>眼下</span>}
              <strong role="status" aria-live="polite">{commandRequest.statusLabel}</strong>
            </header>
            <h4>{commandRequest.title}</h4>
            <p>{commandRequest.summary}</p>
            {commandRequest.evidence.length ? (
              <dl className="observer-agency-command__evidence">
                {commandRequest.evidence.slice(0, 3).map((item, index) => (
                  <div key={`${item.tone}-${item.label}-${index}`} data-tone={item.tone}>
                    <dt>{item.label}</dt>
                    <dd>{item.detail}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {commandSourceEventId && onSelectEvent ? (
              <button
                type="button"
                className="observer-agency-command__source"
                onClick={() => onSelectEvent(commandSourceEventId)}
              >
                {commandRequest.stage === 'submitted'
                  ? '查请令原事'
                  : commandRequest.stage === 'approved'
                    ? '查授令原事'
                    : commandRequest.stage === 'blocked'
                      ? commandRequest.statusLabel === '请令作罢'
                        ? '查作罢原事'
                        : commandRequest.statusLabel === '已遭削权'
                          ? '查削权原事'
                          : commandRequest.statusLabel === '另受安抚'
                            ? '查安抚原事'
                        : commandRequest.statusLabel === '暂缓授令'
                          ? '查暂缓原事'
                          : '查未准原事'
                      : '查本季原事'}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="observer-inspector__section observer-agency" aria-labelledby="person-agency-decision-heading">
        <h3 id="person-agency-decision-heading">最近取舍</h3>
        {quarterChoice ? (
          <div className="observer-agency-choice" data-outcome={quarterChoice.outcome}>
            <header><span>{quarterChoice.periodLabel}</span><strong>{PERSON_QUARTER_CHOICE_LABELS[quarterChoice.outcome]}</strong></header>
            <dl>
              <div><dt>原先打算</dt><dd>{quarterChoice.intended}</dd></div>
              <div><dt>本季所行</dt><dd>{quarterChoice.actual}</dd></div>
            </dl>
            <p><b>{choiceReasonLabel}</b>{quarterChoice.reason}</p>
            {quarterChoice.sourceEventId && onSelectEvent ? (
              <button type="button" className="observer-agency-choice__source" onClick={() => onSelectEvent(quarterChoice.sourceEventId!)}>查本季原事</button>
            ) : null}
          </div>
        ) : <p className="observer-inspector__empty">本季尚无可核对的盘算与行动。</p>}
        {agency.recentDecision ? (
          <div className="observer-agency-decision" data-status={agency.recentDecision.status} data-after-choice={quarterChoice ? true : undefined}>
            <div><strong>{quarterChoice ? `主意变了：${agency.recentDecision.label}` : agency.recentDecision.label}</strong><span>{PERSON_GOAL_STATUS_LABELS[agency.recentDecision.status]}</span></div>
            <p>{agency.recentDecision.reason}</p>
          </div>
        ) : null}
      </section>
      <p className="observer-agency__note">筹谋会随处境复核；是否成行，还要看职位、资源与关系。</p>
    </>
  );
}

export function PersonEmbodimentClosureNotice({
  closure,
  onSelectEvent,
  onDismiss,
}: {
  closure: NonNullable<PersonEmbodimentView['closure']>;
  onSelectEvent?: (eventId: string) => void;
  onDismiss?: () => void;
}) {
  return (
    <section className="observer-embodiment-closure" role="status" aria-live="polite" data-testid="embodiment-closure" data-reason={closure.reason}>
      <span>{closure.reason === 'died' ? '人物离世 · 已回到观察' : '人物离场 · 已回到观察'}</span>
      <h3>一生至此</h3>
      <p>{closure.summary}</p>
      {closure.highlights.length ? (
        <ul aria-label="此人生前留下的事">
          {closure.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
        </ul>
      ) : null}
      <div>
        {closure.sourceEventId && onSelectEvent
          ? <button type="button" onClick={() => onSelectEvent(closure.sourceEventId!)}>查最后一页</button>
          : null}
        {onDismiss ? <button type="button" onClick={onDismiss}>收起</button> : null}
      </div>
    </section>
  );
}

function PersonInspector({ data, onOpenMind, ...actions }: Extract<InspectorProps, { kind: 'person' }> & { onOpenMind?: () => void }) {
  const [tab, setTab] = useState<'life' | 'mind' | 'relations' | 'history'>('life');
  const tabsId = useId();
  useEffect(() => setTab('life'), [data.id]);
  const openMind = () => {
    setTab('mind');
    onOpenMind?.();
  };
  const enterEmbodiment = () => {
    actions.onEnterEmbodiment?.();
    openMind();
  };
  const abilities: Array<[string, number]> = [['统率', data.abilities.command], ['武勇', data.abilities.martial], ['政略', data.abilities.governance], ['谋略', data.abilities.strategy], ['魅力', data.abilities.charisma], ['学识', data.abilities.scholarship]];
  return (
    <>
      <div className="observer-inspector__header">
        <div className="observer-inspector__identity"><span className="observer-inspector__kind"><UserRound size={14} aria-hidden="true" />人物档案{actions.embodiment?.active ? <b className="observer-embodiment-seal">入世中</b> : null}</span><h2>{data.name}{data.courtesyName ? <small> 字{data.courtesyName}</small> : null}</h2><p>{[data.polity, data.role, data.lifeStage, data.tier, `${data.age}岁`].filter(Boolean).join(' · ')}</p></div>
        <InspectorActions label={data.name} {...actions} />
      </div>
      <div className="observer-embodiment-switch" data-active={actions.embodiment?.active || undefined}>
        <div>
          <strong>{actions.embodiment?.active ? '正从此人的位置看世事' : actions.embodiment?.activeCharacterName ? `当前以${actions.embodiment.activeCharacterName}入世` : '仍是历史观察者'}</strong>
          <span>{actions.embodiment?.active ? '每季可替此人定下一件事' : '入世不会接管国家，只增加一次人物决定'}</span>
        </div>
        {actions.embodiment?.active
          ? <button type="button" onClick={actions.onLeaveEmbodiment}>离开此人</button>
          : data.lifeStage !== '已故' && actions.onEnterEmbodiment
            ? <button type="button" onClick={enterEmbodiment}>{actions.embodiment?.activeCharacterName ? '改以此人入世' : '以此人入世'}</button>
            : null}
      </div>
      {actions.embodiment?.closure ? (
        <PersonEmbodimentClosureNotice
          closure={actions.embodiment.closure}
          onSelectEvent={actions.onSelectEvent}
          onDismiss={actions.onDismissEmbodimentClosure}
        />
      ) : null}
      {data.summary ? <p className="observer-inspector__summary">{data.summary}</p> : null}
      <button type="button" className="observer-person-quick-mind" aria-controls={`${tabsId}-panel-mind`} onClick={openMind}>
        <span><strong>看所图</strong><small>旧事、盘算与本季所行</small></span>
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      <InspectorTabs value={tab} onChange={setTab} idPrefix={tabsId} items={[{ id: 'life', label: '生平' }, { id: 'mind', label: '所图' }, { id: 'relations', label: '关系' }, { id: 'history', label: '经历' }]} />
      {tab === 'life' ? <div id={`${tabsId}-panel-life`} role="tabpanel" aria-labelledby={`${tabsId}-tab-life`}>
        <section className="observer-inspector__section" aria-labelledby="person-origin-heading"><h3 id="person-origin-heading">身世与处境</h3><dl className="observer-facts"><Fact label="性别" value={data.gender} /><Fact label="出身" value={data.origin} /><Fact label="阶层" value={data.politicalClass} /><Fact label="家族" value={data.family} /><Fact label="影响" value={data.influence} /><Fact label="私产" value={data.personalWealth} /></dl>{data.family ? <p className="observer-inspector__jump"><Network size={13} aria-hidden="true" /><LinkedName kind="family" id={data.familyId} onSelect={actions.onSelectEntity}>{data.family}</LinkedName></p> : null}{data.health !== undefined ? <div className="observer-health"><HeartPulse size={14} aria-hidden="true" /><Meter label="健康" value={data.health} /></div> : null}</section>
        <section className="observer-inspector__section" aria-labelledby="person-ability-heading"><h3 id="person-ability-heading">才能</h3><div className="observer-ability-grid">{abilities.map(([label, value]) => <div className="observer-ability" key={label}><span>{label}</span><strong>{Math.round(value)}</strong></div>)}</div><dl className="observer-facts observer-facts--after-grid"><Fact label="功绩" value={data.merit} /><Fact label="副将历练" value={data.deputyExperience} /></dl></section>
      </div> : null}
      {tab === 'mind' ? <div id={`${tabsId}-panel-mind`} role="tabpanel" aria-labelledby={`${tabsId}-tab-mind`}>{data.agency ? <PersonAgencySections key={data.id} agency={data.agency} onSelectEvent={actions.onSelectEvent} embodiment={actions.embodiment} onChooseEmbodiedAction={actions.onChooseEmbodiedAction} onCancelEmbodiedAction={actions.onCancelEmbodiedAction} /> : <section className="observer-inspector__section" aria-labelledby="person-motive-heading"><h3 id="person-motive-heading">心志与打算</h3><p className="observer-inspector__empty">现有记载不足以判断此人的打算。</p></section>}</div> : null}
      {tab === 'relations' ? <div id={`${tabsId}-panel-relations`} role="tabpanel" aria-labelledby={`${tabsId}-tab-relations`}><section className="observer-inspector__section" aria-labelledby="person-relation-heading"><h3 id="person-relation-heading"><Network size={14} aria-hidden="true" />关系与记忆</h3>{data.relationships?.length ? <><RelationshipConstellation name={data.name} relationships={data.relationships} onSelect={actions.onSelectEntity} /><ul className="observer-relation-list">{data.relationships.map((relation) => <li key={relation.id}><button type="button" onClick={() => actions.onSelectEntity?.('person', relation.targetId)}><span><strong>{relation.name}</strong><small>{relation.relation} · {relation.sentiment}</small></span>{relation.detail ? <b>{relation.detail}</b> : null}</button>{relation.memories?.length ? <p>{relation.memories.join('；')}</p> : null}</li>)}</ul></> : <p className="observer-inspector__empty">此人尚无足以入档的人际记忆。</p>}</section></div> : null}
      {tab === 'history' ? <div id={`${tabsId}-panel-history`} role="tabpanel" aria-labelledby={`${tabsId}-tab-history`}><section className="observer-inspector__section" aria-labelledby="person-history-heading"><h3 id="person-history-heading"><ScrollText size={14} aria-hidden="true" />人生经历</h3><RecordList records={data.experiences ?? []} onSelectEvent={actions.onSelectEvent} /></section></div> : null}
    </>
  );
}

const SYSTEM_META = {
  seaZone: { label: '海域档案', icon: Anchor },
  army: { label: '军团档案', icon: Swords },
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
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const inspectorId = useId();
  const selectionKey = `${props.kind}:${props.data.id}`;
  const embodimentClosureKey = props.kind === 'person' && props.embodiment?.closure
    ? `${props.data.id}:${props.embodiment.closure.reason}:${props.embodiment.closure.sourceEventId ?? 'no-event'}`
    : null;
  useEffect(() => setMobileExpanded(false), [selectionKey]);
  useEffect(() => {
    if (embodimentClosureKey) setMobileExpanded(true);
  }, [embodimentClosureKey]);
  return (
    <aside
      id={inspectorId}
      className="observer-inspector"
      aria-label="对象档案"
      data-kind={props.kind}
      data-mobile-expanded={mobileExpanded}
    >
      <div className="observer-inspector__mobile-toggle">
        <span>档案速览</span>
        <button
          type="button"
          aria-expanded={mobileExpanded}
          onClick={() => setMobileExpanded((current) => !current)}
        >
          {mobileExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
          {mobileExpanded ? '收起档案' : '展开档案'}
        </button>
      </div>
      {props.kind === 'region' ? <RegionInspector {...props} /> : null}
      {props.kind === 'country' ? <CountryInspector {...props} /> : null}
      {props.kind === 'family' ? <FamilyInspector {...props} /> : null}
      {props.kind === 'person' ? <PersonInspector {...props} onOpenMind={() => setMobileExpanded(true)} /> : null}
      {props.kind === 'system' ? <SystemInspector {...props} /> : null}
    </aside>
  );
}

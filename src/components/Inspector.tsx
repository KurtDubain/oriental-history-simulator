import {
  Activity,
  Anchor,
  ArrowLeft,
  Castle,
  ChevronDown,
  ChevronUp,
  Handshake,
  HeartPulse,
  Landmark,
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
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ArchiveEntityKind } from './HistoricalArchive';
import { gameAudio } from '../audio';
import type { PersonEmbodimentView } from '../view/embodiment-view';
import type { CourtProjectionView } from '../view/court-projection';
import type { CourtFactionTarget, CourtFocusRequest } from '../view/observer-navigation';
import type { PoliticalFocusLink } from '../view/political-focus';
import { compact } from '../view/compact-number';
import { CourtProjection } from './CourtProjection';
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
  supplyNote?: string;
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

export interface MilitaryPoliticalImpactView {
  summary: string;
  sourceEventId?: string | null;
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
  court?: CourtProjectionView;
  coreImpact?: MilitaryPoliticalImpactView | null;
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

export type PersonAgencyGoalStatus = 'active' | 'achieved' | 'invalidated';

export interface PersonAgencyGoalView {
  id: string;
  label: string;
  status: PersonAgencyGoalStatus;
  reason: string;
  barrier: string;
}

export type PersonAgencyPlanStepStatus = 'completed' | 'available' | 'blocked' | 'invalidated';

export interface PersonAgencyPlanStepView {
  label: string;
  status: PersonAgencyPlanStepStatus;
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
  currentPlanSteps: readonly PersonAgencyPlanStepView[];
  memories?: readonly PersonAgencyMemoryView[];
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
  politicalFocus?: readonly PoliticalFocusLink[];
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
  politicalFocus?: readonly PoliticalFocusLink[];
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
  coreImpact?: MilitaryPoliticalImpactView | null;
}

export type InspectorEntrySource = 'map' | 'roster' | 'link';

interface InspectorSharedProps {
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  onClose?: () => void;
  onOpenArchive?: () => void;
  onSelectEntity?: (kind: ArchiveEntityKind, id: string) => void;
  onSelectEvent?: (eventId: string) => void;
  onSelectCourtFaction?: (target: CourtFactionTarget) => void;
  embodiment?: PersonEmbodimentView;
  onEnterEmbodiment?: () => void;
  onLeaveEmbodiment?: () => void;
  onChooseEmbodiedAction?: (actionId: string) => void;
  onCancelEmbodiedAction?: () => void;
  onDismissEmbodimentClosure?: () => void;
  mobileExpanded?: boolean;
  onMobileExpandedChange?: (expanded: boolean) => void;
  entrySource?: InspectorEntrySource;
  returnToOrigin?: boolean;
  returnLabel?: string;
  showSupplyNote?: boolean;
}

export type InspectorProps =
  | (InspectorSharedProps & { kind: 'region'; data: RegionInspectorData })
  | (InspectorSharedProps & {
      kind: 'country';
      data: CountryInspectorData;
      initialTab?: 'court';
      tabRequestKey?: number;
      courtFocus?: CourtFocusRequest;
      onShowFactionRoots?: (factionId: string) => void;
    })
  | (InspectorSharedProps & { kind: 'family'; data: FamilyInspectorData })
  | (InspectorSharedProps & { kind: 'person'; data: PersonInspectorData })
  | (InspectorSharedProps & { kind: 'system'; data: SystemInspectorData });

function display(value: DisplayValue) {
  return typeof value === 'number' ? compact.format(value) : value;
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

function PoliticalFocusList({ links, onSelect }: { links: readonly PoliticalFocusLink[]; onSelect?: (target: CourtFactionTarget) => void }) {
  return (
    <ul className="observer-entity-list observer-political-focus-list">
      {links.map((link) => (
        <li key={link.factionId} data-muted={!link.active || undefined}>
          <button
            type="button"
            data-court-focus-faction={link.factionId}
            disabled={!link.active || !onSelect}
            title={link.detail}
            onClick={() => onSelect?.(link)}
          >
            <span><strong>{link.factionName}</strong><small>{link.polityName} · {link.detail}</small></span>
            <b>{link.active ? '看其朝局' : '已退场'}</b>
          </button>
        </li>
      ))}
    </ul>
  );
}

function InspectorActions({ label, isFollowing, onToggleFollow, onClose, entrySource, returnToOrigin, returnLabel }: InspectorSharedProps & { label: string }) {
  const returnsToRoster = entrySource === 'roster';
  const closeLabel = returnsToRoster ? returnLabel ?? '返回名单' : '关闭档案';
  return (
    <div className="observer-inspector__actions">
      {onToggleFollow ? (
        <button type="button" className="observer-icon-button observer-inspector__follow" data-active={isFollowing || undefined} aria-label={isFollowing ? `取消关注${label}` : `关注${label}`} aria-pressed={isFollowing} onClick={onToggleFollow}>
          <Star size={17} fill={isFollowing ? 'currentColor' : 'none'} aria-hidden="true" />
          <span>{isFollowing ? '已关注' : '关注'}</span>
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          className="observer-icon-button"
          autoFocus={returnsToRoster || returnToOrigin}
          aria-label={closeLabel}
          data-inspector-close
          data-inspector-return={returnsToRoster ? 'roster' : undefined}
          onClick={onClose}
        >
          {returnsToRoster ? <ArrowLeft size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />}
        </button>
      ) : null}
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
    gameAudio.play('select', 0.4);
    onChange(items[nextIndex].id);
    requestAnimationFrame(() => tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus());
  };
  return (
    <div ref={tabsRef} className="observer-inspector-tabs" role="tablist" aria-label="档案分页" onKeyDown={moveFocus}>
      {items.map((item) => (
        <button key={item.id} id={`${id}-tab-${item.id}`} type="button" role="tab" data-inspector-tab={item.id} aria-selected={value === item.id} aria-controls={idPrefix ? `${id}-panel-${item.id}` : undefined} tabIndex={value === item.id ? 0 : -1} onClick={() => { gameAudio.play('select', 0.4); onChange(item.id); }}>
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

function MilitaryPoliticalImpact({ impact, onSelectEvent }: { impact?: MilitaryPoliticalImpactView | null; onSelectEvent?: (eventId: string) => void }) {
  if (!impact) return null;
  return (
    <div className="observer-core-impact" data-testid="military-political-impact">
      <strong>军政牵动</strong><p>{impact.summary}</p>
      {impact.sourceEventId && onSelectEvent ? <button type="button" onClick={() => onSelectEvent(impact.sourceEventId!)}>查看实据</button> : null}
    </div>
  );
}

function RecordList({ records, onSelectEvent }: { records: InspectorRecord[]; onSelectEvent?: (eventId: string) => void }) {
  if (!records.length) return <p className="observer-inspector__empty">尚无可按年月查考的记载。</p>;
  return (
    <ol className="observer-inspector-records">
      {records.map((record) => (
        <li key={record.id} data-major={(record.importance ?? 0) >= 4 || undefined}>
          <span>{record.date}</span>
          {record.eventId && onSelectEvent ? (
            <button type="button" onClick={() => onSelectEvent(record.eventId!)}><strong>{record.title}</strong><small>{record.summary}</small><em>为何如此</em></button>
          ) : <div><strong>{record.title}</strong><small>{record.summary}</small></div>}
        </li>
      ))}
    </ol>
  );
}

export function EntityHistoryGateway({
  kind,
  label,
  onOpen,
}: {
  kind: 'country' | 'family' | 'person';
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="observer-entity-history-gateway"
      data-entity-history-gateway={kind}
      data-testid="entity-history-gateway"
      onClick={onOpen}
    >
      {label}
    </button>
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
            <button type="button" onClick={() => onSelectEvent(scene.sourceEventId!)}>为何如此</button>
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
            <circle cx={x} cy={y} r="22" />
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

function CountryInspector({ data, initialTab, tabRequestKey, courtFocus, onShowFactionRoots, ...actions }: Extract<InspectorProps, { kind: 'country' }>) {
  const requestedTab = initialTab === 'court' || courtFocus ? 'court' : 'realm';
  const [tab, setTab] = useState<'realm' | 'court' | 'maritime' | 'diplomacy' | 'history'>(requestedTab);
  const tabsId = useId();
  useEffect(() => setTab(requestedTab), [data.id, requestedTab, tabRequestKey, courtFocus?.requestKey]);
  return (
    <>
      <div className="observer-inspector__header">
        <div className="observer-inspector__identity"><span className="observer-inspector__kind"><Castle size={14} aria-hidden="true" />国家档案</span><h2>{data.name}</h2><p>{[data.government, `都于${data.capital}`].filter(Boolean).join(' · ')}</p></div>
        <InspectorActions label={data.name} {...actions} />
      </div>
      {data.status ? <p className="observer-inspector__summary">{data.status}</p> : null}
      <InspectorTabs value={tab} onChange={setTab} idPrefix={tabsId} items={[{ id: 'realm', label: '国势' }, { id: 'court', label: '朝局' }, { id: 'maritime', label: '海贸' }, { id: 'diplomacy', label: '邦交' }, { id: 'history', label: '国史' }]} />
      {tab === 'realm' ? (
        <div id={`${tabsId}-panel-realm`} role="tabpanel" aria-labelledby={`${tabsId}-tab-realm`}>
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
        <div id={`${tabsId}-panel-court`} role="tabpanel" aria-labelledby={`${tabsId}-tab-court`}>
          <MilitaryPoliticalImpact impact={data.coreImpact} onSelectEvent={actions.onSelectEvent} />
          {data.court ? (
            <CourtProjection
              court={data.court}
              factions={data.factions ?? []}
              focusRequest={courtFocus}
              onSelectPerson={(personId) => actions.onSelectEntity?.('person', personId)}
              onSelectEvent={actions.onSelectEvent}
              onShowFactionRoots={onShowFactionRoots}
            />
          ) : <p className="observer-inspector__empty">朝廷座次尚无足够记录。</p>}
          {data.courtScenes?.length ? (
            <section className="observer-inspector__section observer-court-scenes" aria-labelledby="country-court-scene-heading">
              <h3 id="country-court-scene-heading"><ScrollText size={14} aria-hidden="true" />朝局近事</h3>
              <HistoricalSceneList scenes={data.courtScenes} onSelectEvent={actions.onSelectEvent} />
            </section>
          ) : null}
        </div>
      ) : null}
      {tab === 'maritime' ? <div id={`${tabsId}-panel-maritime`} role="tabpanel" aria-labelledby={`${tabsId}-tab-maritime`}><section className="observer-inspector__section" aria-labelledby="country-maritime-heading"><h3 id="country-maritime-heading"><Anchor size={14} aria-hidden="true" />海贸与舰政</h3><dl className="observer-facts"><Fact label="贸易收入" value={data.tradeRevenue} /><Fact label="海军预算" value={data.navalBudget} /></dl>{data.maritimeOrientation !== undefined ? <Meter label="向海倾向" value={data.maritimeOrientation} /> : null}{data.maritimeAssets?.length ? <ul className="observer-entity-list observer-entity-list--after-meter">{data.maritimeAssets.map((asset) => <li key={`${asset.kind}-${asset.id}`}><button type="button" onClick={() => actions.onSelectEntity?.(asset.kind, asset.id)}><span><strong>{asset.label}</strong><small>{asset.detail}</small></span>{asset.value !== undefined ? <b>{display(asset.value)}</b> : null}</button></li>)}</ul> : <p className="observer-inspector__empty">尚无足以维持远海行动的舰队或港口。</p>}</section></div> : null}
      {tab === 'diplomacy' ? (
        <div id={`${tabsId}-panel-diplomacy`} role="tabpanel" aria-labelledby={`${tabsId}-tab-diplomacy`}><section className="observer-inspector__section" aria-labelledby="country-diplomacy-heading"><h3 id="country-diplomacy-heading"><Handshake size={14} aria-hidden="true" />邦交形势</h3>
          {data.diplomacy?.length ? <ul className="observer-diplomacy-list">{data.diplomacy.map((relation) => <li key={relation.polityId} data-status={relation.status}><button type="button" onClick={() => actions.onSelectEntity?.('country', relation.polityId)}><span><strong>{relation.polity}</strong><small>{relation.status} · 信任 {Math.round(relation.trust)}</small></span><span><b>威胁 {Math.round(relation.threat)}</b><small>宿怨 {Math.round(relation.grievance)} · 商贸 {Math.round(relation.tradeDependency)}</small></span></button></li>)}</ul> : <p className="observer-inspector__empty">暂无可考的邦交往来。</p>}
        </section></div>
      ) : null}
      {tab === 'history' ? <div id={`${tabsId}-panel-history`} role="tabpanel" aria-labelledby={`${tabsId}-tab-history`}><section className="observer-inspector__section" aria-labelledby="country-history-heading"><h3 id="country-history-heading"><ScrollText size={14} aria-hidden="true" />国史近录</h3><RecordList records={data.history ?? []} onSelectEvent={actions.onSelectEvent} />{actions.onOpenArchive ? <EntityHistoryGateway kind="country" label="读完整本纪" onOpen={actions.onOpenArchive} /> : null}</section></div> : null}
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
        {data.politicalFocus?.length ? <section className="observer-inspector__section" aria-labelledby="family-court-heading"><h3 id="family-court-heading"><Landmark size={14} aria-hidden="true" />族人在朝</h3><PoliticalFocusList links={data.politicalFocus} onSelect={actions.onSelectCourtFaction} /></section> : null}
        {data.alliances?.length ? <section className="observer-inspector__section" aria-labelledby="family-alliance-heading"><h3 id="family-alliance-heading"><Handshake size={14} aria-hidden="true" />婚姻盟族</h3><ul className="observer-entity-list">{data.alliances.map((alliance) => <li key={alliance.id}><button type="button" onClick={() => actions.onSelectEntity?.('family', alliance.id)}><span><strong>{alliance.name}</strong><small>{alliance.detail}</small></span></button></li>)}</ul></section> : null}
      </div> : null}
      {tab === 'members' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="family-members-heading"><h3 id="family-members-heading"><UsersRound size={14} aria-hidden="true" />族中人物</h3>{data.members?.length ? <ul className="observer-entity-list">{data.members.map((member) => <li key={member.id} data-muted={!member.alive || undefined}><button type="button" onClick={() => actions.onSelectEntity?.('person', member.id)}><span><strong>{member.name}</strong><small>{member.alive ? `${member.age}岁 · ${member.role}` : '已故 · 载于族谱'}</small></span><b>{Math.round(member.influence)}</b></button></li>)}</ul> : <p className="observer-inspector__empty">族谱中尚无可展开的人物。</p>}</section></div> : null}
      {tab === 'history' ? <div role="tabpanel"><section className="observer-inspector__section" aria-labelledby="family-history-heading"><h3 id="family-history-heading"><ScrollText size={14} aria-hidden="true" />家史近录</h3><RecordList records={data.history ?? []} onSelectEvent={actions.onSelectEvent} />{actions.onOpenArchive ? <EntityHistoryGateway kind="family" label="读完整世录" onOpen={actions.onOpenArchive} /> : null}</section></div> : null}
    </>
  );
}

const PERSON_GOAL_STATUS_LABELS = {
  active: '正在谋求',
  achieved: '已经达成',
  invalidated: '已无从继续',
} satisfies Record<PersonAgencyGoalStatus, string>;

const PERSON_PLAN_STATUS_LABELS = {
  completed: '条件已具',
  available: '正在准备',
  blocked: '尚待前项',
  invalidated: '此路已断',
} satisfies Record<PersonAgencyPlanStepStatus, string>;

function agencyEmptyGoalCopy(agency: PersonAgencyView) {
  if (agency.availability === 'dormant') return { title: '尚未入局', detail: agency.reason || '年岁尚轻，眼下还没有真正进入世事。' };
  if (agency.availability === 'closed') return { title: '生平已定', detail: agency.reason || '此人已不再形成新的打算。' };
  return { title: '尚无明确行动', detail: agency.reason || '眼下没有会进入季度结算的明确打算。' };
}

export function PersonAgencySections({
  agency,
  politicalFocus = [],
  onSelectEvent,
  onSelectCourtFaction,
  embodiment,
  onChooseEmbodiedAction,
  onCancelEmbodiedAction,
}: {
  agency: PersonAgencyView;
  politicalFocus?: readonly PoliticalFocusLink[];
  onSelectEvent?: (eventId: string) => void;
  onSelectCourtFaction?: (target: CourtFactionTarget) => void;
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
  const commandRequest = agency.commandRequest;
  const commandSourceEventId = commandRequest
    && ['submitted', 'approved', 'blocked'].includes(commandRequest.stage)
    ? commandRequest.sourceEventId
    : null;
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
                    data-embodied-action-kind={action.kind}
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
                <button type="button" onClick={() => onSelectEvent(embodiment.lastResult!.sourceEventId!)}>为何如此</button>
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
          {politicalFocus.length ? <PoliticalFocusList links={politicalFocus} onSelect={onSelectCourtFaction} /> : agency.powerPosition.groupName ? <p className="observer-power-position__faction">身在 {agency.powerPosition.groupName}</p> : null}
          {agency.powerPosition.resources.length ? (
            <ol className="observer-power-position__resources">
              {agency.powerPosition.resources.map((resource) => (
                <li key={resource.id}>
                  <span><strong>{resource.label}</strong><small>{resource.detail}</small></span>
                  <b>+{Math.round(resource.value)}</b>
                  {resource.sourceEventId && onSelectEvent ? <button type="button" onClick={() => onSelectEvent(resource.sourceEventId!)}>为何如此</button> : null}
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
                  <button type="button" className="observer-agency-memory__source" onClick={() => onSelectEvent(memory.sourceEventId!)}>为何如此</button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p className="observer-inspector__empty">眼下没有哪桩旧事格外牵动此人。</p>}
        <p className="observer-agency-memory__note">这里只记此人仍放在心上的事，完整纪年见“生平”。</p>
      </section>

      <section className="observer-inspector__section observer-agency" aria-labelledby="person-agency-goal-heading">
        <h3 id="person-agency-goal-heading">眼下所图</h3>
        {agency.primaryGoal ? (
          <div className="observer-agency-goal" data-status={agency.primaryGoal.status}>
            <header><span>{PERSON_GOAL_STATUS_LABELS[agency.primaryGoal.status]}</span><strong>{agency.primaryGoal.label}</strong></header>
            <p><b>因何起意</b>{agency.primaryGoal.reason}</p>
            {agency.primaryGoal.barrier ? <p className="observer-agency__barrier"><b>眼下难处</b>{agency.primaryGoal.barrier}</p> : null}
          </div>
        ) : (
          <div className="observer-agency-empty">
            <strong>{emptyGoal.title}</strong>
            <p>{emptyGoal.detail}</p>
            {agency.barrier ? <p className="observer-agency__barrier"><b>眼下难处</b>{agency.barrier}</p> : null}
          </div>
        )}
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
              >为何如此</button>
            ) : null}
          </div>
        </section>
      ) : null}

      <p className="observer-agency__note">这里只展示已经进入季度结算的明确打算；结果仍由职位、军权与朝局裁定。</p>
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
          ? <button type="button" onClick={() => onSelectEvent(closure.sourceEventId!)}>为何如此</button>
          : null}
        {onDismiss ? <button type="button" onClick={onDismiss}>收起</button> : null}
      </div>
    </section>
  );
}

function PersonInspector({ data, onOpenMind, mobileMindRequest = 0, ...actions }: Extract<InspectorProps, { kind: 'person' }> & { onOpenMind?: () => void; mobileMindRequest?: number }) {
  const [tab, setTab] = useState<'life' | 'mind' | 'relations' | 'history'>('life');
  const tabsId = useId();
  useEffect(() => setTab('life'), [data.id]);
  useEffect(() => {
    if (mobileMindRequest > 0) setTab('mind');
  }, [mobileMindRequest]);
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
      <InspectorTabs value={tab} onChange={setTab} idPrefix={tabsId} items={[{ id: 'life', label: '其人' }, { id: 'mind', label: '所图' }, { id: 'relations', label: '关系' }, { id: 'history', label: '生平' }]} />
      {tab === 'life' ? <div id={`${tabsId}-panel-life`} role="tabpanel" aria-labelledby={`${tabsId}-tab-life`}>
        <section className="observer-inspector__section" aria-labelledby="person-origin-heading"><h3 id="person-origin-heading">身世与处境</h3><dl className="observer-facts"><Fact label="性别" value={data.gender} /><Fact label="出身" value={data.origin} /><Fact label="阶层" value={data.politicalClass} /><Fact label="家族" value={data.family} /><Fact label="影响" value={data.influence} /><Fact label="私产" value={data.personalWealth} /></dl>{data.family ? <p className="observer-inspector__jump"><Network size={13} aria-hidden="true" /><LinkedName kind="family" id={data.familyId} onSelect={actions.onSelectEntity}>{data.family}</LinkedName></p> : null}{data.health !== undefined ? <div className="observer-health"><HeartPulse size={14} aria-hidden="true" /><Meter label="健康" value={data.health} /></div> : null}</section>
        <section className="observer-inspector__section" aria-labelledby="person-ability-heading"><h3 id="person-ability-heading">才能</h3><div className="observer-ability-grid">{abilities.map(([label, value]) => <div className="observer-ability" key={label}><span>{label}</span><strong>{Math.round(value)}</strong></div>)}</div><dl className="observer-facts observer-facts--after-grid"><Fact label="功绩" value={data.merit} /><Fact label="副将历练" value={data.deputyExperience} /></dl></section>
      </div> : null}
      {tab === 'mind' ? <div id={`${tabsId}-panel-mind`} role="tabpanel" aria-labelledby={`${tabsId}-tab-mind`}>{data.agency ? <PersonAgencySections key={data.id} agency={data.agency} politicalFocus={data.politicalFocus} onSelectEvent={actions.onSelectEvent} onSelectCourtFaction={actions.onSelectCourtFaction} embodiment={actions.embodiment} onChooseEmbodiedAction={actions.onChooseEmbodiedAction} onCancelEmbodiedAction={actions.onCancelEmbodiedAction} /> : <section className="observer-inspector__section" aria-labelledby="person-motive-heading"><h3 id="person-motive-heading">心志与打算</h3><p className="observer-inspector__empty">现有记载不足以判断此人的打算。</p></section>}</div> : null}
      {tab === 'relations' ? <div id={`${tabsId}-panel-relations`} role="tabpanel" aria-labelledby={`${tabsId}-tab-relations`}><section className="observer-inspector__section" aria-labelledby="person-relation-heading"><h3 id="person-relation-heading"><Network size={14} aria-hidden="true" />关系与记忆</h3>{data.relationships?.length ? <><RelationshipConstellation name={data.name} relationships={data.relationships} onSelect={actions.onSelectEntity} /><ul className="observer-relation-list">{data.relationships.map((relation) => <li key={relation.id}><button type="button" data-related-person-id={relation.targetId} onClick={() => actions.onSelectEntity?.('person', relation.targetId)}><span><strong>{relation.name}</strong><small>{relation.relation} · {relation.sentiment}</small></span></button>{relation.detail || relation.memories?.length ? <p>{[relation.detail, ...(relation.memories ?? [])].filter(Boolean).join('；')}</p> : null}</li>)}</ul></> : <p className="observer-inspector__empty">此人尚无足以入档的人际记忆。</p>}</section></div> : null}
      {tab === 'history' ? <div id={`${tabsId}-panel-history`} role="tabpanel" aria-labelledby={`${tabsId}-tab-history`}><section className="observer-inspector__section" aria-labelledby="person-history-heading"><h3 id="person-history-heading"><ScrollText size={14} aria-hidden="true" />生平纪年</h3><RecordList records={data.experiences ?? []} onSelectEvent={actions.onSelectEvent} />{actions.onOpenArchive ? <EntityHistoryGateway kind="person" label="读完整人物传" onOpen={actions.onOpenArchive} /> : null}</section></div> : null}
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
        {data.kind === 'army' ? <MilitaryPoliticalImpact impact={data.coreImpact} onSelectEvent={actions.onSelectEvent} /> : null}
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

interface MobileQuickLookView {
  eyebrow: string;
  name: string;
  ownerLabel: string;
  owner: string;
  current: string;
  destination: string;
}

function mobileQuickLookFor(props: InspectorProps): MobileQuickLookView {
  if (props.kind === 'region') return {
    eyebrow: '州域速览',
    name: props.data.name,
    ownerLabel: '辖属',
    owner: props.data.polityName ?? '无主之地',
    current: `${props.showSupplyNote && props.data.supplyNote ? `供养：${props.data.supplyNote}。` : props.data.summary ?? `${props.data.terrain}地势。`} 人口${display(props.data.population)}，粮况${display(props.data.food)}，动荡${Math.round(props.data.unrest)}。`,
    destination: '地方帐簿、局势与往来',
  };
  if (props.kind === 'country') {
    const targetsCourt = props.initialTab === 'court' || Boolean(props.courtFocus);
    return {
      eyebrow: targetsCourt ? '朝局速览' : '国势速览',
      name: props.data.name,
      ownerLabel: targetsCourt ? '都城' : '中枢',
      owner: [props.data.government, `都于${props.data.capital}`].filter(Boolean).join(' · '),
      current: targetsCourt
        ? props.data.court?.summary ?? `君主${props.data.ruler}，朝中派系格局尚待查考。`
        : props.data.status ?? `治下${props.data.regionCount}郡，君主${props.data.ruler}。`,
      destination: targetsCourt ? '君位、朝班与派系根基' : '国势、朝局、邦交与国史',
    };
  }
  if (props.kind === 'family') return {
    eyebrow: '门第速览',
    name: props.data.name,
    ownerLabel: '所在',
    owner: [props.data.polity, props.data.branch].filter(Boolean).join(' · ') || '散居天下',
    current: props.data.summary ?? `家主${props.data.head}，族中名录${props.data.memberCount}人。`,
    destination: '门第、谱系与家史',
  };
  if (props.kind === 'person') return {
    eyebrow: '人物速览',
    name: props.data.name,
    ownerLabel: '身份',
    owner: [props.data.polity, props.data.role, props.data.family].filter(Boolean).join(' · ') || '在野之人',
    current: props.data.summary ?? `${props.data.age}岁，眼下以${props.data.role}身份行事。`,
    destination: '其人、所图、关系与生平',
  };
  const meta = SYSTEM_META[props.data.kind];
  const fact = (label: string) => props.data.facts.find((item) => item.label === label)?.value;
  const meter = (label: string) => props.data.meters?.find((item) => item.label === label)?.value;
  const current = props.data.kind === 'army'
    ? `兵力${display(fact('兵力') ?? '不详')}，士气${Math.round(meter('士气') ?? 0)}，补给${Math.round(meter('补给') ?? 0)}。${props.data.summary}`
    : props.data.kind === 'fleet'
      ? `战船${display(fact('战船') ?? '不详')}，水手${display(fact('水手') ?? '不详')}，战备${Math.round(meter('战备') ?? 0)}。${props.data.summary}`
      : props.data.summary;
  return {
    eyebrow: meta.label.replace('档案', '速览'),
    name: props.data.name,
    ownerLabel: '归属',
    owner: props.data.subtitle || '天下运行中的一环',
    current,
    destination: props.data.kind === 'army'
      ? '兵权、军令、战备与沿革'
      : props.data.kind === 'fleet'
        ? '兵力、战备、关联地点与沿革'
      : '当季状态、关联对象与沿革',
  };
}

export function Inspector(props: InspectorProps) {
  const [internalMobileExpanded, setInternalMobileExpanded] = useState(false);
  const [mobileMindRequest, setMobileMindRequest] = useState(0);
  const mobileExpansionControlled = props.mobileExpanded !== undefined;
  const mobileExpanded = props.mobileExpanded ?? internalMobileExpanded;
  const inspectorId = useId();
  const inspectorRef = useRef<HTMLElement>(null);
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const swipeConsumedRef = useRef(false);
  const selectionKey = `${props.kind}:${props.data.id}`;
  const quickLook = mobileQuickLookFor(props);
  const embodimentClosureKey = props.kind === 'person' && props.embodiment?.closure
    ? `${props.data.id}:${props.embodiment.closure.reason}:${props.embodiment.closure.sourceEventId ?? 'no-event'}`
    : null;
  const returnsToRoster = props.entrySource === 'roster' && Boolean(props.onClose);
  const returnsToOrigin = (props.returnToOrigin || returnsToRoster) && Boolean(props.onClose);
  const mobileReturnLabel = props.returnLabel ?? '返回名单';
  const setMobileExpanded = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(mobileExpanded) : next;
    if (props.mobileExpanded === undefined) setInternalMobileExpanded(value);
    props.onMobileExpandedChange?.(value);
  }, [mobileExpanded, props.mobileExpanded, props.onMobileExpandedChange]);
  useEffect(() => {
    if (!mobileExpansionControlled) setInternalMobileExpanded(false);
    setMobileMindRequest(0);
  }, [mobileExpansionControlled, selectionKey]);
  useEffect(() => {
    if (embodimentClosureKey) setMobileExpanded(true);
  }, [embodimentClosureKey]);
  useEffect(() => {
    if (!returnsToOrigin) return undefined;
    const frame = requestAnimationFrame(() => inspectorRef.current?.querySelector<HTMLButtonElement>('[data-inspector-close]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [mobileExpanded, returnsToOrigin, selectionKey]);
  useEffect(() => {
    if (!returnsToOrigin) return undefined;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      props.onClose?.();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [props.onClose, returnsToOrigin]);

  const startQuickLookSwipe = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse') return;
    swipeConsumedRef.current = false;
    swipeStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some mobile browsers can cancel capture while handing a gesture off.
    }
  };

  const finishQuickLookSwipe = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) < 42 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    swipeConsumedRef.current = true;
    if (dy < 0) setMobileExpanded(true);
    else if (mobileExpanded && returnsToRoster) props.onClose?.();
    else if (mobileExpanded) setMobileExpanded(false);
    else props.onClose?.();
  };

  const cancelQuickLookSwipe = () => {
    swipeStartRef.current = null;
    swipeConsumedRef.current = false;
  };

  return (
    <aside
      ref={inspectorRef}
      id={inspectorId}
      className="observer-inspector"
      tabIndex={-1}
      aria-label="对象档案"
      data-kind={props.kind}
      data-mobile-expanded={mobileExpanded}
      data-mobile-mode={mobileExpanded ? 'full' : 'quick'}
      data-entry-source={props.entrySource}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !returnsToRoster || !mobileExpanded) return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose?.();
      }}
    >
      <section className="observer-inspector__mobile-toggle" data-testid="map-quick-look" aria-label={`${quickLook.name}地图速览`}>
        <button
          type="button"
          className="observer-inspector__mobile-handle"
          aria-expanded={mobileExpanded}
          aria-label={mobileExpanded && returnsToRoster ? `下划或点按${mobileReturnLabel}` : mobileExpanded ? '下划或点按返回地图速览' : '上划或点按打开完整档案'}
          onPointerDown={startQuickLookSwipe}
          onPointerUp={finishQuickLookSwipe}
          onPointerCancel={cancelQuickLookSwipe}
          onLostPointerCapture={() => {
            swipeStartRef.current = null;
          }}
          onClick={() => {
            if (swipeConsumedRef.current) {
              swipeConsumedRef.current = false;
              return;
            }
            if (mobileExpanded && returnsToRoster) {
              props.onClose?.();
              return;
            }
            setMobileExpanded((current) => !current);
          }}
        >
          <i aria-hidden="true" />
          <span>{mobileExpanded && returnsToRoster ? mobileReturnLabel : mobileExpanded ? '完整档案' : '地图速览'}</span>
          {mobileExpanded && returnsToRoster ? <ArrowLeft size={16} aria-hidden="true" /> : mobileExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
        </button>
        {!mobileExpanded ? (
          <div className="observer-inspector__mobile-quicklook">
            <header data-testid="map-quick-look-identity">
              <span>{quickLook.eyebrow}</span>
              <strong>{quickLook.name}</strong>
            </header>
            <dl>
              <div data-testid="map-quick-look-owner"><dt>{quickLook.ownerLabel}</dt><dd>{quickLook.owner}</dd></div>
              <div data-testid="map-quick-look-current"><dt>眼下</dt><dd>{quickLook.current}</dd></div>
            </dl>
            <footer>
              <span>可细看 · {quickLook.destination}</span>
              <div>
                <button
                  type="button"
                  data-testid="map-quick-look-details"
                  onClick={() => {
                    setMobileExpanded(true);
                    if (props.kind === 'person') setMobileMindRequest((current) => current + 1);
                  }}
                >{props.kind === 'person' ? '看所图' : props.kind === 'country' && (props.initialTab === 'court' || props.courtFocus) ? '看朝局' : '完整档案'}</button>
                {props.onClose ? <button type="button" onClick={props.onClose}>{returnsToRoster ? mobileReturnLabel : '收起'}</button> : null}
              </div>
            </footer>
          </div>
        ) : null}
      </section>
      {props.kind === 'region' ? <RegionInspector {...props} /> : null}
      {props.kind === 'country' ? <CountryInspector {...props} /> : null}
      {props.kind === 'family' ? <FamilyInspector {...props} /> : null}
      {props.kind === 'person' ? <PersonInspector {...props} mobileMindRequest={mobileMindRequest} onOpenMind={() => setMobileExpanded(true)} /> : null}
      {props.kind === 'system' ? <SystemInspector {...props} /> : null}
    </aside>
  );
}

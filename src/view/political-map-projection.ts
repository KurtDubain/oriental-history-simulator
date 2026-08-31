import type {
  CharacterState,
  FactionState,
  WorldState,
} from '../sim/types';
import {
  calculateFactionPowerLedger,
  type FactionPowerLedger,
  type PoliticalPowerResource,
} from '../sim/politics/power-ledger';
import {
  projectCourt,
  type CourtEvidenceScope,
  type CourtRelationView,
} from './court-projection';

export type FactionSpatialPowerRootKind =
  | 'regional_governance'
  | 'army_command'
  | 'fleet_command';

export type FactionSpatialPowerAssetKind = 'governorship' | 'army' | 'fleet';

export interface FactionSpatialPowerAssetView {
  kind: FactionSpatialPowerAssetKind;
  id: string;
  holderId: string;
  holder: string;
  label: string;
  ledgerResourceId: string | null;
}

/**
 * A map root is a point-backed political asset, never a claim of territorial
 * control. Central office, family prestige, renown, alliances and cohesion do
 * not enter this projection because the current schema gives them no truthful
 * non-capital location.
 */
export interface FactionSpatialPowerRootView {
  id: string;
  kind: FactionSpatialPowerRootKind;
  kindLabel: '地方任官' | '军团军令' | '舰队军令';
  polityId: string;
  polityName: string;
  factionId: string;
  factionName: string;
  anchor: {
    kind: 'region' | 'seaZone';
    id: string;
    name: string;
  };
  regionId: string;
  regionName: string;
  label: string;
  detail: string;
  powerContribution: number;
  assetCount: number;
  assets: readonly FactionSpatialPowerAssetView[];
}

export type CapitalPoliticalPulseTone = 'quiet' | 'watch' | 'alert';
export type RulerConstraintReason = 'weak_central_authority' | 'non_ruler_dominance';

export interface CapitalPoliticalConflictView {
  relationId: string;
  leftFactionId: string;
  leftFactionName: string;
  rightFactionId: string;
  rightFactionName: string;
  label: '公开相争';
  sinceLabel: string | null;
  sourceEventId: string | null;
}

export interface CapitalPoliticalPulseView {
  id: string;
  polityId: string;
  polityName: string;
  capitalRegionId: string | null;
  capitalName: string;
  rulerId: string;
  ruler: string;
  rulerFactionId: string | null;
  authority: number;
  rulerConstrained: boolean;
  constraintReasons: readonly RulerConstraintReason[];
  dominantFactionId: string | null;
  dominantFactionName: string | null;
  dominantFactionLeaderId: string | null;
  dominantFactionPower: number;
  conflict: CapitalPoliticalConflictView | null;
  tone: CapitalPoliticalPulseTone;
  headline: string;
  detail: string;
}

export interface PoliticalMapProjectionView {
  roots: readonly FactionSpatialPowerRootView[];
  capitalPulses: readonly CapitalPoliticalPulseView[];
}

export const POLITICAL_MAP_PROJECTION_LIMITS = Object.freeze({
  rootsPerFaction: 8,
  rootsPerWorld: 96,
  assetsPerRoot: 4,
});

interface SpatialAssetCandidate extends FactionSpatialPowerAssetView {
  rootKind: FactionSpatialPowerRootKind;
  anchorKind: FactionSpatialPowerRootView['anchor']['kind'];
  anchorId: string;
  anchorName: string;
  regionId: string;
  contribution: number;
}

const ROOT_KIND_ORDER: Readonly<Record<FactionSpatialPowerRootKind, number>> = {
  regional_governance: 0,
  army_command: 1,
  fleet_command: 2,
};

const ROOT_KIND_LABEL: Readonly<Record<FactionSpatialPowerRootKind, FactionSpatialPowerRootView['kindLabel']>> = {
  regional_governance: '地方任官',
  army_command: '军团军令',
  fleet_command: '舰队军令',
};

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function activeFactionMembers(world: WorldState, faction: FactionState): CharacterState[] {
  return world.characters
    .filter((character) => (
      character.alive
      && character.polityId === faction.polityId
      && character.factionId === faction.id
    ))
    .sort((left, right) => stableCompare(left.id, right.id));
}

function resourceForOffice(
  ledger: FactionPowerLedger,
  officeId: string,
): PoliticalPowerResource | null {
  return ledger.resources.find((resource) => resource.id === `office:${officeId}`) ?? null;
}

function resourceForCommand(
  ledger: FactionPowerLedger,
  entityType: 'army' | 'fleet',
  entityId: string,
): PoliticalPowerResource | null {
  return ledger.resources.find((resource) => resource.evidence.some((reference) => (
    reference.entityType === entityType
    && reference.entityId === entityId
    && reference.field === 'commanderId'
  ))) ?? null;
}

function factionSpatialAssets(
  world: WorldState,
  faction: FactionState,
  ledger: FactionPowerLedger,
): SpatialAssetCandidate[] {
  const members = activeFactionMembers(world, faction);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const activeOffices = world.offices
    .filter((office) => office.active && office.polityId === faction.polityId)
    .sort((left, right) => stableCompare(left.id, right.id));
  const assets: SpatialAssetCandidate[] = [];

  for (const governor of members.filter((member) => member.governedRegionId)) {
    const regionId = governor.governedRegionId as string;
    const region = world.regions.find((candidate) => (
      candidate.id === regionId && candidate.controllerId === faction.polityId
    ));
    if (!region) continue;
    const office = activeOffices.find((candidate) => (
      candidate.kind === '地方长官'
      && candidate.holderId === governor.id
      && candidate.regionId === region.id
    ));
    if (!office) continue;
    const resource = resourceForOffice(ledger, office.id);
    assets.push({
      rootKind: 'regional_governance',
      anchorKind: 'region',
      anchorId: region.id,
      anchorName: region.name,
      regionId: region.id,
      contribution: resource?.value ?? 0,
      kind: 'governorship',
      id: governor.id,
      holderId: governor.id,
      holder: governor.name,
      label: `${governor.name}治理${region.name}`,
      ledgerResourceId: resource?.id ?? null,
    });
  }

  for (const army of [...world.armies].sort((left, right) => stableCompare(left.id, right.id))) {
    const commander = memberById.get(army.commanderId);
    if (
      !commander
      || army.polityId !== faction.polityId
      || army.soldiers <= 0
      || commander.commandingArmyId !== army.id
      || !world.regions.some((region) => region.id === army.regionId)
    ) continue;
    const resource = resourceForCommand(ledger, 'army', army.id);
    assets.push({
      rootKind: 'army_command',
      anchorKind: 'region',
      anchorId: army.regionId,
      anchorName: world.regions.find((region) => region.id === army.regionId)?.name ?? army.regionId,
      regionId: army.regionId,
      contribution: resource?.value ?? 0,
      kind: 'army',
      id: army.id,
      holderId: commander.id,
      holder: commander.name,
      label: `${commander.name}统率${army.name}`,
      ledgerResourceId: resource?.id ?? null,
    });
  }

  for (const fleet of [...world.fleets].sort((left, right) => stableCompare(left.id, right.id))) {
    const commander = memberById.get(fleet.commanderId);
    if (
      !commander
      || fleet.polityId !== faction.polityId
      || fleet.warships + fleet.transports + fleet.patrolShips <= 0
      || commander.commandingFleetId !== fleet.id
      || !world.regions.some((region) => region.id === fleet.homePortRegionId)
    ) continue;
    const resource = resourceForCommand(ledger, 'fleet', fleet.id);
    const currentSea = fleet.seaZoneId
      ? world.seaZones.find((zone) => zone.id === fleet.seaZoneId)
      : null;
    const currentPort = world.regions.find((region) => region.id === (fleet.portRegionId ?? fleet.homePortRegionId));
    const anchor = currentSea
      ? { kind: 'seaZone' as const, id: currentSea.id, name: currentSea.name }
      : currentPort
        ? { kind: 'region' as const, id: currentPort.id, name: currentPort.name }
        : null;
    if (!anchor) continue;
    assets.push({
      rootKind: 'fleet_command',
      anchorKind: anchor.kind,
      anchorId: anchor.id,
      anchorName: anchor.name,
      regionId: fleet.homePortRegionId,
      contribution: resource?.value ?? 0,
      kind: 'fleet',
      id: fleet.id,
      holderId: commander.id,
      holder: commander.name,
      label: `${commander.name}统领${fleet.name}`,
      ledgerResourceId: resource?.id ?? null,
    });
  }

  return assets.sort((left, right) => (
    ROOT_KIND_ORDER[left.rootKind] - ROOT_KIND_ORDER[right.rootKind]
    || stableCompare(left.regionId, right.regionId)
    || stableCompare(left.kind, right.kind)
    || stableCompare(left.id, right.id)
  ));
}

function rootLabel(
  kind: FactionSpatialPowerRootKind,
  locationName: string,
  assetCount: number,
): string {
  if (kind === 'regional_governance') return `${locationName}州治${assetCount > 1 ? ` · ${assetCount}任` : ''}`;
  if (kind === 'army_command') return `${locationName}军令${assetCount > 1 ? ` · ${assetCount}军` : ''}`;
  return `${locationName}舰令`;
}

function rootsForFaction(
  world: WorldState,
  faction: FactionState,
  ledger: FactionPowerLedger,
): FactionSpatialPowerRootView[] {
  const polity = world.polities.find((candidate) => candidate.id === faction.polityId);
  if (!polity?.alive) return [];
  const grouped = new Map<string, SpatialAssetCandidate[]>();
  for (const asset of factionSpatialAssets(world, faction, ledger)) {
    const key = asset.rootKind === 'fleet_command'
      ? `${asset.rootKind}:${asset.id}`
      : `${asset.rootKind}:${asset.anchorKind}:${asset.anchorId}`;
    const group = grouped.get(key) ?? [];
    group.push(asset);
    grouped.set(key, group);
  }
  return [...grouped.entries()]
    .flatMap(([key, assets]) => {
      const first = assets[0];
      if (!first) return [];
      const region = world.regions.find((candidate) => candidate.id === first.regionId);
      if (!region) return [];
      const orderedAssets = [...assets].sort((left, right) => (
        right.contribution - left.contribution
        || stableCompare(left.kind, right.kind)
        || stableCompare(left.id, right.id)
      ));
      const retainedAssets = orderedAssets.slice(0, POLITICAL_MAP_PROJECTION_LIMITS.assetsPerRoot);
      const omittedCount = orderedAssets.length - retainedAssets.length;
      return [{
        id: `political-root:${faction.id}:${key}`,
        kind: first.rootKind,
        kindLabel: ROOT_KIND_LABEL[first.rootKind],
        polityId: polity.id,
        polityName: polity.name,
        factionId: faction.id,
        factionName: faction.name,
        anchor: { kind: first.anchorKind, id: first.anchorId, name: first.anchorName },
        regionId: region.id,
        regionName: region.name,
        label: rootLabel(first.rootKind, first.anchorName, orderedAssets.length),
        detail: `${retainedAssets.map((asset) => asset.label).join('、')}${omittedCount > 0 ? `等${orderedAssets.length}项实权` : ''}`,
        powerContribution: rounded(retainedAssets.reduce((sum, asset) => sum + asset.contribution, 0)),
        assetCount: orderedAssets.length,
        assets: retainedAssets.map(({
          rootKind: _rootKind,
          anchorKind: _anchorKind,
          anchorId: _anchorId,
          anchorName: _anchorName,
          regionId: _regionId,
          contribution: _contribution,
          ...asset
        }) => asset),
      } satisfies FactionSpatialPowerRootView];
    })
    .sort((left, right) => (
      right.powerContribution - left.powerContribution
      || ROOT_KIND_ORDER[left.kind] - ROOT_KIND_ORDER[right.kind]
      || stableCompare(left.anchor.id, right.anchor.id)
      || stableCompare(left.id, right.id)
    ))
    .slice(0, POLITICAL_MAP_PROJECTION_LIMITS.rootsPerFaction);
}

/**
 * Returns only concrete, current and point-backed roots. The optional faction
 * filter is useful after the observer selects one faction; the unfiltered
 * projection uses a fair round-robin cap so one large court cannot crowd every
 * other polity off the map.
 */
export function projectFactionSpatialPowerRoots(
  world: WorldState,
  factionId: string | null = null,
): FactionSpatialPowerRootView[] {
  const ranked = world.factions
    .filter((faction) => (
      faction.active
      && (!factionId || faction.id === factionId)
      && world.polities.some((polity) => polity.id === faction.polityId && polity.alive)
    ))
    .map((faction) => {
      const ledger = calculateFactionPowerLedger(world, faction);
      return { faction, ledger, roots: rootsForFaction(world, faction, ledger) };
    })
    .sort((left, right) => right.ledger.total - left.ledger.total || stableCompare(left.faction.id, right.faction.id));

  if (factionId) return ranked[0]?.roots ?? [];
  const roots: FactionSpatialPowerRootView[] = [];
  for (let index = 0; index < POLITICAL_MAP_PROJECTION_LIMITS.rootsPerFaction; index += 1) {
    for (const projection of ranked) {
      const root = projection.roots[index];
      if (root) roots.push(root);
      if (roots.length >= POLITICAL_MAP_PROJECTION_LIMITS.rootsPerWorld) return roots;
    }
  }
  return roots;
}

function preferredPublicConflict(
  relations: readonly CourtRelationView[],
  dominantFactionId: string | null,
): CourtRelationView | null {
  return relations
    .filter((relation) => relation.kind === 'opposed')
    .sort((left, right) => (
      Number(!(dominantFactionId && [left.leftFactionId, left.rightFactionId].includes(dominantFactionId)))
      - Number(!(dominantFactionId && [right.leftFactionId, right.rightFactionId].includes(dominantFactionId)))
      || stableCompare(left.id, right.id)
    ))[0] ?? null;
}

function pulseDetail(
  dominantName: string | null,
  rulerName: string,
  constrained: boolean,
  weakAuthority: boolean,
  nonRulerDominance: boolean,
  conflict: CapitalPoliticalConflictView | null,
): string {
  const clauses: string[] = [];
  clauses.push(dominantName ? `${dominantName}在朝中居首` : '朝中尚无成形派系');
  if (!constrained) clauses.push(`${rulerName}仍能维持君位主导`);
  else if (weakAuthority && nonRulerDominance) clauses.push('中央权威偏弱，且居首派系并非由君主主持');
  else if (weakAuthority) clauses.push('中央权威偏弱，君位受到制度掣肘');
  else clauses.push('居首派系并非由君主主持，重大决策需要其合作');
  if (conflict) clauses.push(`${conflict.leftFactionName}与${conflict.rightFactionName}仍在公开相争`);
  return `${clauses.join('；')}。`;
}

/** One restrained capital marker for every living polity. */
export function projectCapitalPoliticalPulses(
  world: WorldState,
  evidenceScope: CourtEvidenceScope = 'active',
): CapitalPoliticalPulseView[] {
  return world.polities
    .filter((polity) => polity.alive)
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((polity) => {
      const court = projectCourt(world, polity.id, evidenceScope);
      const ruler = world.characters.find((character) => character.id === polity.rulerId);
      const capital = world.regions.find((region) => region.id === polity.capitalRegionId);
      const activeFactionIds = new Set(court.factionPositions.map((faction) => faction.factionId));
      const rulerFactionId = ruler?.factionId && activeFactionIds.has(ruler.factionId) ? ruler.factionId : null;
      const dominant = court.factionPositions[0] ?? null;
      const weakAuthority = polity.authority <= 44;
      const nonRulerDominance = Boolean(
        dominant
        && dominant.leaderId !== polity.rulerId
        && dominant.power >= 66,
      );
      const constraintReasons: RulerConstraintReason[] = [
        ...(weakAuthority ? ['weak_central_authority' as const] : []),
        ...(nonRulerDominance ? ['non_ruler_dominance' as const] : []),
      ];
      const relation = preferredPublicConflict(court.relations, dominant?.factionId ?? null);
      const conflict: CapitalPoliticalConflictView | null = relation ? {
        relationId: relation.id,
        leftFactionId: relation.leftFactionId,
        leftFactionName: relation.leftName,
        rightFactionId: relation.rightFactionId,
        rightFactionName: relation.rightName,
        label: '公开相争',
        sinceLabel: relation.sinceLabel,
        sourceEventId: relation.sourceEventId,
      } : null;
      const rulerConstrained = constraintReasons.length > 0;
      const tone: CapitalPoliticalPulseTone = rulerConstrained && conflict
        ? 'alert'
        : rulerConstrained || conflict
          ? 'watch'
          : 'quiet';
      const rulerName = ruler?.name ?? '君主不详';
      const headline = conflict
        ? `${conflict.leftFactionName}与${conflict.rightFactionName}公开相争`
        : rulerConstrained
          ? `${rulerName}的君权受到牵制`
          : dominant
            ? `${dominant.name}居朝中首位`
            : `${polity.shortName}廷派系未成形`;
      return {
        id: `capital-politics:${polity.id}`,
        polityId: polity.id,
        polityName: polity.name,
        capitalRegionId: capital?.id ?? null,
        capitalName: capital?.name ?? '行在未定',
        rulerId: polity.rulerId,
        ruler: rulerName,
        rulerFactionId,
        authority: polity.authority,
        rulerConstrained,
        constraintReasons,
        dominantFactionId: dominant?.factionId ?? null,
        dominantFactionName: dominant?.name ?? null,
        dominantFactionLeaderId: dominant?.leaderId ?? null,
        dominantFactionPower: dominant?.power ?? 0,
        conflict,
        tone,
        headline,
        detail: pulseDetail(
          dominant?.name ?? null,
          rulerName,
          rulerConstrained,
          weakAuthority,
          nonRulerDominance,
          conflict,
        ),
      } satisfies CapitalPoliticalPulseView;
    });
}

export function projectPoliticalMap(
  world: WorldState,
  evidenceScope: CourtEvidenceScope = 'active',
): PoliticalMapProjectionView {
  // The full root set is a bounded audit/debug projection. Interactive maps
  // should reveal only roots whose faction belongs to the selected polity;
  // routine world view must not display every faction at once.
  return {
    roots: projectFactionSpatialPowerRoots(world),
    capitalPulses: projectCapitalPoliticalPulses(world, evidenceScope),
  };
}

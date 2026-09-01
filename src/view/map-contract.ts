export interface MapPoint {
  x: number;
  y: number;
}

export type MapSeason = '春' | '夏' | '秋' | '冬';

export interface MapVisualSettings {
  season: MapSeason;
  atmosphere: boolean;
  /** Observer-only emphasis; never enters simulation state or save data. */
  highlightStrength?: number;
}

export interface MapRegionView {
  id: string;
  name: string;
  polygon: readonly MapPoint[];
  center: MapPoint;
  terrain: string;
  polityId?: string;
  polityName?: string;
  polityColor?: string;
  population: number;
  foodRatio: number;
  unrest?: number;
  warDamage?: number;
  port?: boolean;
  portLevel?: number;
  capital?: boolean;
  cityLevel?: number;
  defense?: number;
  strategicValue?: number;
  diseasePressure?: number;
  knowledgeAdoption?: number;
  refugeePopulation?: number;
  tradeVolume?: number;
}

export interface MapRouteView {
  id?: string;
  from: string;
  to: string;
  type: "land" | "river" | "sea" | string;
  points?: readonly MapPoint[];
}

export interface MapArmyView {
  id: string;
  name: string;
  regionId?: string;
  position?: MapPoint;
  polityId?: string;
  polityColor?: string;
  strength: number;
  morale?: number;
  status?: string;
  nominalPolityName?: string;
  lawfulCommanderName?: string;
  actualAllegianceName?: string;
  allegianceStrength?: number;
  commandDiverged?: boolean;
  retinueSoldiers?: number;
  retinueSummary?: string;
  orderKind?: 'hold' | 'advance' | 'intercept' | 'reinforce' | 'retreat';
  orderLabel?: string;
  orderTargetRegionId?: string | null;
  orderIssuerName?: string;
  orderBlocked?: boolean;
}

export interface MapSeaZoneView {
  id: string;
  name: string;
  center: MapPoint;
  climate: string;
  controllerName?: string;
  controllerColor?: string;
  contested: boolean;
  traffic: number;
  stormRisk: number;
  piracy: number;
  powerShare: number;
}

export interface MapFleetView {
  id: string;
  name: string;
  seaZoneId?: string | null;
  regionId?: string | null;
  position: MapPoint;
  polityId?: string;
  polityColor?: string;
  strength: number;
  readiness: number;
  mission: string;
}

export type MapFlowKind = "trade" | "migration" | "disease" | "knowledge" | "naval";

export interface MapFlowView {
  id: string;
  kind: MapFlowKind;
  from: MapPoint;
  to: MapPoint;
  magnitude: number;
  label: string;
  selectedKind: "tradeCorridor" | "migration" | "outbreak" | "practice" | "seaZone";
  selectedId: string;
  alert?: boolean;
}

export interface MapMarkerView {
  id: string;
  kind: "outbreak" | "practice" | "capitalPulse" | "powerRoot";
  position: MapPoint;
  magnitude: number;
  label: string;
  alert?: boolean;
  targetKind?: MapMarkerTargetKind;
  targetId?: string;
  polityId?: string;
  factionId?: string;
  factionName?: string;
  categoryLabel?: string;
  detail?: string;
  tone?: "quiet" | "watch" | "alert";
  rootKind?: "regional_governance" | "army_command" | "fleet_command";
  color?: string;
}

export type MapOverlay =
  | "political"
  | "food"
  | "population"
  | "war"
  | "trade"
  | "migration"
  | "naval"
  | "disease"
  | "knowledge"
  | "none";

export type MapObjectKind = MapFlowView["selectedKind"] | "seaZone" | "fleet" | "army" | "country";

export type MapMarkerTargetKind = MapObjectKind | "region";

export type MapSelectedObject = { kind: string; id: string } | null;

export interface MapCamera {
  zoom: number;
  panX: number;
  panY: number;
}

export interface MapViewportTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  renderHeight: number;
  yScale: number;
}

export interface MapPresentationView {
  profile: MapPresentationDefinition;
  regions: MapRegionView[];
  routes: MapRouteView[];
  armies: MapArmyView[];
  seaZones: MapSeaZoneView[];
  fleets: MapFleetView[];
  flows: MapFlowView[];
  markers: MapMarkerView[];
}

export type MapLodLevel = "overview" | "regional" | "local";

/**
 * The single visibility contract consumed by map drawing, hit testing and
 * keyboard navigation. Geographic base data stays complete; interactive and
 * labelled objects are reduced by LOD before reaching those consumers.
 */
export interface MapLodScene extends MapPresentationView {
  level: MapLodLevel;
  regionLabelIds: ReadonlySet<string>;
  cityRegionIds: ReadonlySet<string>;
  portRegionIds: ReadonlySet<string>;
  interactiveSeaZoneIds: ReadonlySet<string>;
}
import type { MapPresentationDefinition } from '../maps/types';

export type Terrain = '平原' | '丘陵' | '山地' | '高原' | '海岸' | '岛屿';

export type Climate = '温带' | '寒温带' | '暖温带' | '湿热' | '干旱';

export type RouteKind = '道路' | '河道' | '山道' | '海峡';

export type SeaClimate = '北方海' | '季风海' | '内海' | '外洋';

export type MapContentVersion = 'v03-82' | 'legacy-v02-48' | 'contest-v01-68';

export type MapProfileId = 'private-v03' | 'contest-v01';

export interface RegionDefinition {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly terrain: Terrain;
  readonly climate: Climate;
  readonly river: boolean;
  readonly port: boolean;
  readonly cityLevel: number;
  readonly defense: number;
  readonly strategicValue: number;
  readonly fertility: number;
  readonly populationBase: number;
  readonly initialControllerId: string;
}

export interface PolityDefinition {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly color: string;
  readonly capitalRegionId: string;
  readonly governmentForm: '王朝' | '军府' | '盟约';
  readonly maritimeOrientation: number;
}

export interface RouteDefinition {
  readonly id?: string;
  readonly fromRegionId: string;
  readonly toRegionId: string;
  readonly kind: RouteKind;
  readonly supplyCapacity: number;
}

export interface SeaZoneDefinition {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly climate: SeaClimate;
  readonly stormRisk: number;
  readonly piracy: number;
}

export interface SeaLaneDefinition {
  readonly id: string;
  readonly fromSeaZoneId: string;
  readonly toSeaZoneId: string;
  readonly distance: number;
  readonly capacity: number;
  readonly baseRisk: number;
  readonly strait: boolean;
}

export interface PortLinkDefinition {
  readonly id: string;
  readonly regionId: string;
  readonly seaZoneId: string;
  readonly capacity: number;
  readonly distance: number;
}

export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

export interface MapLandShapeDefinition {
  readonly id: string;
  readonly label: string;
  readonly role: 'mainland' | 'island';
  readonly expectedRegionCount: number;
  readonly polygon: readonly MapPoint[];
}

export interface MapTerritoryShapeDefinition {
  readonly id: string;
  readonly polygon: readonly MapPoint[];
}

export interface MapDecorativeIsletDefinition {
  readonly id: string;
  readonly label?: string;
  readonly polygon: readonly MapPoint[];
}

export interface MapRegionDisplaySiteDefinition extends MapPoint {
  readonly id: string;
  readonly shapeId: string;
}

export interface MapMacroLabelDefinition {
  readonly id: string;
  readonly label: string;
  readonly center: MapPoint;
  readonly kind: 'province' | 'peninsula' | 'archipelago' | 'island';
  readonly priority: number;
}

export interface MapGeographyAreaDefinition {
  readonly id: string;
  readonly label: string;
  readonly tint: string;
  readonly regionIds: readonly string[];
}

export interface MapRiverGuideDefinition {
  readonly id: string;
  readonly label: string;
  readonly waypoints: readonly MapPoint[];
}

export interface MapPresentationDefinition {
  readonly width: number;
  readonly height: number;
  readonly landShapes: readonly MapLandShapeDefinition[];
  readonly territoryShapes: readonly MapTerritoryShapeDefinition[];
  readonly decorativeIslets: readonly MapDecorativeIsletDefinition[];
  readonly regionDisplaySites: Readonly<Record<string, MapRegionDisplaySiteDefinition>>;
  readonly seaZoneDisplayCenters: Readonly<Record<string, MapPoint>>;
  readonly macroLabels: readonly MapMacroLabelDefinition[];
  readonly geographyAreas: readonly MapGeographyAreaDefinition[];
  readonly riverGuides: readonly MapRiverGuideDefinition[];
  readonly hiddenRoutePairs: readonly (readonly [string, string])[];
}

export interface MapSimulationDefinition {
  readonly regions: readonly RegionDefinition[];
  readonly routes: readonly RouteDefinition[];
  readonly polities: readonly PolityDefinition[];
  readonly seaZones: readonly SeaZoneDefinition[];
  readonly seaLanes: readonly SeaLaneDefinition[];
  readonly portLinks: readonly PortLinkDefinition[];
  readonly regionGroups: Readonly<Record<string, readonly string[]>>;
}

export type MapScaleTier = 'compact' | 'standard' | 'large';

export interface MapScalePolicy {
  readonly tier: MapScaleTier;
  readonly denseRegionThreshold: number;
  readonly strategicLabelThreshold: number;
}

export interface MapProfileCompatibility {
  readonly contentVersions: readonly MapContentVersion[];
  readonly legacyPartialRegionVersions: readonly MapContentVersion[];
  readonly regionLimitByContentVersion: Readonly<Partial<Record<MapContentVersion, number>>>;
}

export interface MapProfile {
  readonly id: MapProfileId;
  readonly revision: number;
  readonly contentVersion: MapContentVersion;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly simulation: MapSimulationDefinition;
  readonly presentation: MapPresentationDefinition;
  readonly scale: MapScalePolicy;
  readonly compatibility: MapProfileCompatibility;
}

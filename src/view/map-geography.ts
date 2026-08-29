import { DEFAULT_MAP_PROFILE_ID, getMapProfile } from '../maps';
import type {
  MapDecorativeIsletDefinition,
  MapLandShapeDefinition,
  MapMacroLabelDefinition,
  MapRegionDisplaySiteDefinition,
} from '../maps/types';
import type { TerritoryPoint } from './map-territories';

/**
 * Compatibility surface for the original atlas tests. Runtime rendering reads
 * the selected profile directly; this module follows the active build catalog.
 */
const PRESENTATION = getMapProfile(DEFAULT_MAP_PROFILE_ID).presentation;

export type MapLandRole = MapLandShapeDefinition['role'];
export type MapLandShape = MapLandShapeDefinition;
export type MapLandShapeId = string;
export type MapDecorativeIslet = MapDecorativeIsletDefinition;
export type MapRegionDisplaySite = MapRegionDisplaySiteDefinition;
export type MapMacroLabelKind = MapMacroLabelDefinition['kind'];
export type MapMacroLabel = MapMacroLabelDefinition;

export const MAP_PRESENTATION_WIDTH = PRESENTATION.width;
export const MAP_PRESENTATION_HEIGHT = PRESENTATION.height;
export const MAP_LAND_SHAPES = PRESENTATION.landShapes;
export const MAP_TERRITORY_SHAPES = PRESENTATION.territoryShapes;
export const MAP_DECORATIVE_ISLETS = PRESENTATION.decorativeIslets;
export const REGION_DISPLAY_SITES = PRESENTATION.regionDisplaySites;
export const SEA_ZONE_DISPLAY_CENTERS = PRESENTATION.seaZoneDisplayCenters;
export const MAP_MACRO_LABELS = PRESENTATION.macroLabels;
export const MAP_GEOGRAPHY_AREAS = PRESENTATION.geographyAreas;
export const MAP_RIVER_GUIDES = PRESENTATION.riverGuides;
export const MAP_HIDDEN_ROUTE_PAIRS = PRESENTATION.hiddenRoutePairs;

export function getMapLandShape(shapeId: string): MapLandShape | undefined {
  return MAP_LAND_SHAPES.find((shape) => shape.id === shapeId);
}

export function getRegionDisplaySite(regionId: string): MapRegionDisplaySite | undefined {
  return REGION_DISPLAY_SITES[regionId];
}

export function getSeaZoneDisplayCenter(seaZoneId: string): TerritoryPoint | undefined {
  return SEA_ZONE_DISPLAY_CENTERS[seaZoneId];
}

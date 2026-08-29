import { deriveMapScalePolicy } from '../scale-policy';
import type { MapProfile } from '../types';
import {
  POLITY_DEFINITIONS,
  PORT_LINK_DEFINITIONS,
  REGION_DEFINITIONS,
  REGION_GROUPS,
  ROUTE_DEFINITIONS,
  SEA_LANE_DEFINITIONS,
  SEA_ZONE_DEFINITIONS,
} from './simulation';
import {
  MAP_DECORATIVE_ISLETS,
  MAP_GEOGRAPHY_AREAS,
  MAP_HIDDEN_ROUTE_PAIRS,
  MAP_LAND_SHAPES,
  MAP_MACRO_LABELS,
  MAP_PRESENTATION_HEIGHT,
  MAP_PRESENTATION_WIDTH,
  MAP_RIVER_GUIDES,
  MAP_TERRITORY_SHAPES,
  REGION_DISPLAY_SITES,
  SEA_ZONE_DISPLAY_CENTERS,
} from './presentation';

/** The user's long-lived atlas, preserved byte-for-byte as the first content package. */
export const PRIVATE_V03_MAP_PROFILE: MapProfile = Object.freeze({
  id: 'private-v03',
  revision: 1,
  contentVersion: 'v03-82',
  name: '心中山河',
  subtitle: '北陆、岭南与东海群岛',
  description: '承载现有八十二州、十片海域与八方政权的私人世界。',
  simulation: Object.freeze({
    regions: REGION_DEFINITIONS,
    routes: ROUTE_DEFINITIONS,
    polities: POLITY_DEFINITIONS,
    seaZones: SEA_ZONE_DEFINITIONS,
    seaLanes: SEA_LANE_DEFINITIONS,
    portLinks: PORT_LINK_DEFINITIONS,
    regionGroups: REGION_GROUPS,
  }),
  presentation: Object.freeze({
    width: MAP_PRESENTATION_WIDTH,
    height: MAP_PRESENTATION_HEIGHT,
    landShapes: MAP_LAND_SHAPES,
    territoryShapes: MAP_TERRITORY_SHAPES,
    decorativeIslets: MAP_DECORATIVE_ISLETS,
    regionDisplaySites: REGION_DISPLAY_SITES,
    seaZoneDisplayCenters: SEA_ZONE_DISPLAY_CENTERS,
    macroLabels: MAP_MACRO_LABELS,
    geographyAreas: MAP_GEOGRAPHY_AREAS,
    riverGuides: MAP_RIVER_GUIDES,
    hiddenRoutePairs: MAP_HIDDEN_ROUTE_PAIRS,
  }),
  scale: deriveMapScalePolicy(REGION_DEFINITIONS.length, POLITY_DEFINITIONS.length),
  compatibility: Object.freeze({
    contentVersions: Object.freeze(['v03-82', 'legacy-v02-48'] as const),
    legacyPartialRegionVersions: Object.freeze(['legacy-v02-48'] as const),
    regionLimitByContentVersion: Object.freeze({ 'legacy-v02-48': 48 }),
  }),
});

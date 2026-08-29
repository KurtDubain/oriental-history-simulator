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

/** Public, entirely fictional contest atlas. It shares no real-world labels. */
export const CONTEST_V01_MAP_PROFILE: MapProfile = Object.freeze({
  id: 'contest-v01',
  revision: 1,
  contentVersion: 'contest-v01-68',
  name: '云海八荒',
  subtitle: '天衡大陆与辰海列岛',
  description: '一张完全架空的六十八州参赛舆图：大河贯穿天衡主陆，南部雨陆隔海相望，东部辰海岛链扼守内海与外洋。',
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
    contentVersions: Object.freeze(['contest-v01-68'] as const),
    legacyPartialRegionVersions: Object.freeze([]),
    regionLimitByContentVersion: Object.freeze({}),
  }),
});

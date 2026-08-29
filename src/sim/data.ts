import { DEFAULT_MAP_PROFILE_ID, getMapProfile } from '../maps';

export type {
  PolityDefinition,
  PortLinkDefinition,
  RegionDefinition,
  RouteDefinition,
  SeaLaneDefinition,
  SeaZoneDefinition,
} from '../maps/types';

/**
 * Compatibility exports for older tests and adapters.
 * Scoped builds resolve them from their own catalog and therefore cannot pull
 * the private map package into an otherwise public dependency graph.
 */
const DEFAULT_SIMULATION = getMapProfile(DEFAULT_MAP_PROFILE_ID).simulation;

export const POLITY_DEFINITIONS = DEFAULT_SIMULATION.polities;
export const PORT_LINK_DEFINITIONS = DEFAULT_SIMULATION.portLinks;
export const REGION_DEFINITIONS = DEFAULT_SIMULATION.regions;
export const REGION_GROUPS = DEFAULT_SIMULATION.regionGroups;
export const ROUTE_DEFINITIONS = DEFAULT_SIMULATION.routes;
export const SEA_LANE_DEFINITIONS = DEFAULT_SIMULATION.seaLanes;
export const SEA_ZONE_DEFINITIONS = DEFAULT_SIMULATION.seaZones;

export { FAMILY_NAMES, GIVEN_NAMES } from './names';

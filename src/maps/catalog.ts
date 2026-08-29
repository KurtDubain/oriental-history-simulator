import { CONTEST_V01_MAP_PROFILE } from './contest-v01';
import { PRIVATE_V03_MAP_PROFILE } from './private-v03';
import type { MapProfile } from './types';

/** Full personal build catalog. Vite may replace this module for scoped builds. */
export const MAP_PROFILE_CATALOG: readonly MapProfile[] = Object.freeze([
  PRIVATE_V03_MAP_PROFILE,
  CONTEST_V01_MAP_PROFILE,
]);

import { CONTEST_V01_MAP_PROFILE } from './contest-v01';
import type { MapProfile } from './types';

/** Public contest allowlist: private map modules are intentionally unreachable. */
export const MAP_PROFILE_CATALOG: readonly MapProfile[] = Object.freeze([
  CONTEST_V01_MAP_PROFILE,
]);

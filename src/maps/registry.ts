import { PRIVATE_V03_MAP_PROFILE } from './private-v03';
import type { MapContentVersion, MapProfile, MapProfileId } from './types';
import { assertValidMapProfile } from './validation';

const PROFILES = Object.freeze([PRIVATE_V03_MAP_PROFILE] as const satisfies readonly MapProfile[]);

for (const profile of PROFILES) assertValidMapProfile(profile);

const PROFILE_BY_ID = new Map<MapProfileId, MapProfile>(PROFILES.map((profile) => [profile.id, profile]));
const PROFILE_BY_CONTENT_VERSION = new Map<MapContentVersion, MapProfile>();
for (const profile of PROFILES) {
  for (const contentVersion of profile.compatibility.contentVersions) {
    if (PROFILE_BY_CONTENT_VERSION.has(contentVersion)) {
      throw new Error(`地图内容版本 ${contentVersion} 被多个 profile 声明`);
    }
    PROFILE_BY_CONTENT_VERSION.set(contentVersion, profile);
  }
}

export const DEFAULT_MAP_PROFILE_ID: MapProfileId = 'private-v03';

export function listMapProfiles(): readonly MapProfile[] {
  return PROFILES;
}

export function getMapProfile(profileId: MapProfileId = DEFAULT_MAP_PROFILE_ID): MapProfile {
  const profile = PROFILE_BY_ID.get(profileId);
  if (!profile) throw new Error(`未知地图 profile：${profileId}`);
  return profile;
}

export function findMapProfileForContentVersion(contentVersion: string): MapProfile | undefined {
  return PROFILE_BY_CONTENT_VERSION.get(contentVersion as MapContentVersion);
}

export function getMapProfileForContentVersion(contentVersion: string): MapProfile {
  const profile = findMapProfileForContentVersion(contentVersion);
  if (!profile) throw new Error(`当前版本无法识别地图内容 ${contentVersion}`);
  return profile;
}

export function mapProfileIdForContentVersion(contentVersion: string): MapProfileId {
  return getMapProfileForContentVersion(contentVersion).id;
}


import { MAP_PROFILE_CATALOG } from '@map-profile-catalog';
import type { MapContentVersion, MapProfile, MapProfileId } from './types';
import { assertValidMapProfile } from './validation';

const PROFILES = MAP_PROFILE_CATALOG;

if (PROFILES.length === 0) throw new Error('地图内容清单不能为空');

for (const profile of PROFILES) assertValidMapProfile(profile);

const PROFILE_BY_ID = new Map<MapProfileId, MapProfile>();
const PROFILE_BY_REVISION_KEY = new Map<string, MapProfile>();
const PROFILE_BY_CONTENT_VERSION = new Map<MapContentVersion, MapProfile>();
for (const profile of PROFILES) {
  const revisionKey = `${profile.id}@${profile.revision}`;
  if (PROFILE_BY_REVISION_KEY.has(revisionKey)) {
    throw new Error(`地图 profile 修订 ${revisionKey} 被重复声明`);
  }
  PROFILE_BY_REVISION_KEY.set(revisionKey, profile);
  const latest = PROFILE_BY_ID.get(profile.id);
  if (!latest || profile.revision > latest.revision) PROFILE_BY_ID.set(profile.id, profile);

  for (const contentVersion of profile.compatibility.contentVersions) {
    if (PROFILE_BY_CONTENT_VERSION.has(contentVersion)) {
      throw new Error(`地图内容版本 ${contentVersion} 被多个 profile 声明`);
    }
    PROFILE_BY_CONTENT_VERSION.set(contentVersion, profile);
  }
}

export const DEFAULT_MAP_PROFILE_ID: MapProfileId = PROFILES[0]!.id;

export function listMapProfiles(): readonly MapProfile[] {
  return PROFILES;
}

export function getMapProfile(profileId: MapProfileId = DEFAULT_MAP_PROFILE_ID): MapProfile {
  const profile = PROFILE_BY_ID.get(profileId);
  if (!profile) throw new Error(`未知地图 profile：${profileId}`);
  return profile;
}

/** Exact immutable content revision lookup used by creation and save binding. */
export function getMapProfileRevision(profileId: MapProfileId, revision: number): MapProfile {
  const profile = PROFILE_BY_REVISION_KEY.get(`${profileId}@${revision}`);
  if (!profile) throw new Error(`未知地图 profile 修订：${profileId}@${revision}`);
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

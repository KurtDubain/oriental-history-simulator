import { describe, expect, it } from 'vitest';
import { advanceWorld, createWorld, serializeWorld } from '../sim';
import {
  DEFAULT_MAP_PROFILE_ID,
  findMapProfileForContentVersion,
  getMapProfile,
  getMapProfileRevision,
  listMapProfiles,
  validateMapProfile,
} from '.';
import type { MapProfile } from './types';

const GENERAL_GROUP_BASELINES = {
  '架构边界-入世': [
    ['13e3f0b355fde4d6', '27dc430a9d0a0ee5', '4ac6ddd5020590a2'],
    ['159d28bece0afc7e', '92facf0a75d49f43', '181dd0489d3620fb'],
    ['9ba6a53592743588', '92facf0a75d49f43', 'cd983b8fdba4d04d'],
    ['afd5829d33098485', '39c52f36b8a088c1', '5ff1435dc103e35e'],
    ['b2c7395a4d5a038d', 'd6f1d1f46735f2fc', 'efacc75a1b4ade92'],
    ['fe7a4bdc0b30b662', '492a8fe71d62d6e0', 'ee5d31c0d1419f64'],
    ['3b81f8631a2d2df3', '64c21caa84dac9b0', '8abe7551e0752c16'],
    ['d9215c7f14bdcbb3', '0153ea6b983d42a0', 'debeb4891907a7fb'],
    ['a442da3c47163312', '56f8484204840f82', 'c61ad40f4028ebe4'],
    ['a5493d35d14822e3', '49cae57d20899fdd', '2252896d6a9b1f09'],
    ['6829bbbc187c09f4', '38bb7344934ab9ee', '300e292c6e2635dc'],
    ['a4a46e5711734f31', '861264e30e887228', 'de95ce4020335d09'],
    ['658693ac50c385a9', '2256f08bdb6f4161', 'b226137238dd7910'],
  ],
  '州县民生': [
    ['80732eadd2bd979d', 'a4ca53a565dec64a', '311387f8067264d9'],
    ['f378ff4eb4312c01', '74eeec831c9f36ac', '97526d9c3a3eb0bd'],
    ['f52abfcfdefbc24a', '74eeec831c9f36ac', '34fcd0c03c76149d'],
    ['a3586815ce30a535', '274a92974b936658', '831ae6491275878b'],
    ['af162e1df8d5342d', '8d8710cd09eea143', '3adcb5874d89d634'],
    ['874e4bd77dc633f0', '2269e4ea4478eee6', '6770297f5ea13499'],
    ['296453413be3f547', 'd923424d8bb10d2f', 'd183f2f2b4f7efe0'],
    ['8021746de4a38fd4', 'e2daf40de3e725af', '4a1746d45edda701'],
    ['c89b669ddd562f91', '8941389fafc02360', 'c2c5b77c2ebc8f51'],
    ['dc54c613d388cb19', 'b0837ed138b352fd', '356a72397fb15cf2'],
    ['d32df707d8c0bad3', 'aa41956cd7bcde8e', 'b488b2faef7296bc'],
    ['d7bd8c853857be82', '7d1d423fe4733396', 'a09cc6e2a1b0af44'],
    ['3639f177063e9e86', 'a8438c4e92521967', '401eb85ca7c6207e'],
  ],
} as const;

describe('MAP01/MAP02 map profile boundary', () => {
  it('registers the complete private atlas and maps both current and legacy content to it', () => {
    expect(DEFAULT_MAP_PROFILE_ID).toBe('private-v03');
    expect(listMapProfiles()).toHaveLength(2);
    const profile = getMapProfile();
    expect(profile).toMatchObject({
      id: 'private-v03',
      revision: 1,
      contentVersion: 'v03-82',
      name: '心中山河',
    });
    expect(profile.simulation.regions).toHaveLength(82);
    expect(profile.simulation.seaZones).toHaveLength(10);
    expect(profile.simulation.polities).toHaveLength(8);
    expect(Object.keys(profile.presentation.regionDisplaySites)).toHaveLength(82);
    expect(findMapProfileForContentVersion('v03-82')).toBe(profile);
    expect(findMapProfileForContentVersion('legacy-v02-48')).toBe(profile);
    expect(getMapProfileRevision('private-v03', 1)).toBe(profile);
    expect(getMapProfileRevision('contest-v01', 1)).toBe(getMapProfile('contest-v01'));
    expect(() => getMapProfileRevision('private-v03', 2)).toThrow('private-v03@2');
    expect(findMapProfileForContentVersion('unknown')).toBeUndefined();
    expect(Object.isFrozen(listMapProfiles())).toBe(true);
  });

  it('passes the build-time identity, topology, sea-port and presentation checks', () => {
    expect(validateMapProfile(getMapProfile())).toEqual([]);
  });

  it('rejects a content package with a dangling route before it can enter creation', () => {
    const source = getMapProfile();
    const broken: MapProfile = {
      ...source,
      simulation: {
        ...source.simulation,
        routes: [...source.simulation.routes, {
          id: 'broken_route',
          fromRegionId: 'r_yanjing',
          toRegionId: 'missing_region',
          kind: '道路',
          supplyCapacity: 1,
        }],
      },
    };
    expect(validateMapProfile(broken)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'route.endpoint', path: 'routes.broken_route' }),
    ]));
  });

  it('makes explicit profile creation byte-identical to the historical default', () => {
    const implicit = createWorld('地图显式选择基线');
    const explicit = createWorld('地图显式选择基线', 'private-v03');
    expect(serializeWorld(explicit)).toBe(serializeWorld(implicit));
  });

  it.each(Object.entries(GENERAL_GROUP_BASELINES))(
    'keeps the complete general-group opening and twelve-quarter digest chain for %s',
    (seed, expected) => {
      let world = createWorld(seed);
      const actual: Array<readonly [string, string, string]> = [];
      for (let turn = 0; turn <= 12; turn += 1) {
        actual.push([world.hash, world.factDigest, world.historyDigest]);
        expect(world.mapContentVersion).toBe('v03-82');
        expect(world.regions).toHaveLength(82);
        expect(world.seaZones).toHaveLength(10);
        if (turn < 12) world = advanceWorld(world);
      }
      expect(actual).toEqual(expected);
    },
  );
});

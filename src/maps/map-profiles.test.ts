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
    ['e0104f5df15f458d', '9afb268ed339d543', '4ac6ddd5020590a2'],
    ['b788f1823d6d770e', '8375d98e573a330d', '831ae7c65bf3dd01'],
    ['182fb882cb28b723', '8375d98e573a330d', '45b62194295f6529'],
    ['e376147db09dc658', '91d8e7c9e12e62ea', '1ec11c632ca33057'],
    ['1999d5a22eb0d476', '0d32064b84115e58', 'c7d903a2cb505ca0'],
    ['8d3e9612e717f72c', 'b3bb83949fc87c69', 'ec5a1aeb94f0811f'],
    ['4f75bac5f2999ec4', '078a5739b0b788d3', '3dd5c29e6319df9d'],
    ['9c85581b8a2dc93e', '91a2dc2e39d5eb47', '5fa285eef6be461c'],
    ['d43c830948574e8a', '31627deb0eb5e9d4', '3b0fd66bab89e034'],
    ['1c105205571ba54a', '569e9e3c0e462158', '325fbc716dcde3e0'],
    ['9b4bbcfbc02ec9ee', 'b3a94caa72339a74', '4f664f4d35b84dc0'],
    ['fb853ecad1e9a7db', 'dd93c438290145dd', '2d912588458c7e42'],
    ['ce295197b656caa5', '235f570d19815b11', '3166307acf83f72c'],
  ],
  '州县民生': [
    ['d2359d83fd317a45', 'c1091bfd11ba101f', '311387f8067264d9'],
    ['21b4941f15ffdbdd', 'c7aa7c13c1d129e5', 'e5ede6a88818a7bc'],
    ['e0e6e928f4e48c5a', 'a21e2b5cc34b1e44', '65b4b6d354e85df0'],
    ['0995734e8c0cc407', '97afe7fd25afdaa2', 'a3cfe25851de1aaa'],
    ['6f5e1532da4f0e32', '782bab0cfa8c509e', 'b001d1e8f8f3987e'],
    ['ef8e1f2427911bb1', 'a5778bb05a903e15', '3edc311a664b5c0b'],
    ['3446b5606a1aaa02', 'f2deba11cd4a9441', '7cdb9acc077ed236'],
    ['5afd473b1921b920', 'd78ce36abb86788d', 'c6d819d969c4f7cb'],
    ['e6c9ea8a70e8b79e', '17966e4edd0be38f', '211d42694d178591'],
    ['a248181b8cf6e6b1', '4a945e3f8d594274', 'e08c42f11b10a55b'],
    ['05be2c90fb065e4f', '03f9de1b8c21d5be', '1eb9a3c81027d780'],
    ['f69604fa1c475a8a', '4fc2392952d892a1', 'd437d01d70535b9a'],
    ['37543fca88904cab', 'a4ccc0ef4f856424', '4482ebbbcea94cbc'],
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

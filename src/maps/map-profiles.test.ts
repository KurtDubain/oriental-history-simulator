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

// Updated after the authorized balance rules; still a frozen replay chain.
const GENERAL_GROUP_BASELINES = {
  "架构边界-入世": [
    [
      "e0104f5df15f458d",
      "9afb268ed339d543",
      "4ac6ddd5020590a2"
    ],
    [
      "b788f1823d6d770e",
      "8375d98e573a330d",
      "831ae7c65bf3dd01"
    ],
    [
      "182fb882cb28b723",
      "8375d98e573a330d",
      "45b62194295f6529"
    ],
    [
      "39670217fd3d3d05",
      "04eda99863c40b57",
      "ae795c6b95122162"
    ],
    [
      "463981812a1602ec",
      "25c0f53eff1c1e90",
      "c19844b6679f2002"
    ],
    [
      "4583f633be4f6076",
      "69542b223f2a3b2e",
      "11a2e6ef6b2f2236"
    ],
    [
      "b864bc0240511b75",
      "2b6aa0aca7cf7e24",
      "7d17185323c8e11e"
    ],
    [
      "d3ecbbb4e7644750",
      "6a032423318a687a",
      "6b93aafb3922ec42"
    ],
    [
      "9d81df7b2419a6bd",
      "41008ec1ae643ee8",
      "5918aff6c077ff64"
    ],
    [
      "67157920a6a6b6c6",
      "ec67247a517df015",
      "d5f3521db24d3ead"
    ],
    [
      "7ada277265b3a761",
      "c86c10de59e0adc7",
      "7dce735303217588"
    ],
    [
      "cd072859f9136449",
      "f7d72d890951e68d",
      "8775b3568efdc395"
    ],
    [
      "24acf0ce379fc12f",
      "7ce096ef7c47f8f5",
      "114a31aca436f5e5"
    ]
  ],
  "州县民生": [
    [
      "d2359d83fd317a45",
      "c1091bfd11ba101f",
      "311387f8067264d9"
    ],
    [
      "21b4941f15ffdbdd",
      "c7aa7c13c1d129e5",
      "e5ede6a88818a7bc"
    ],
    [
      "e0e6e928f4e48c5a",
      "a21e2b5cc34b1e44",
      "65b4b6d354e85df0"
    ],
    [
      "3e00c229a75dac3a",
      "cc91f4bc307fe4eb",
      "1ebc30a878892c39"
    ],
    [
      "3decf1088e997937",
      "c06bf057d4db0209",
      "d2dca9f0391db8e0"
    ],
    [
      "945f36da70f86d2c",
      "8a1977782727a17c",
      "5d0ad97402f12bd1"
    ],
    [
      "85d8484ad03a65e3",
      "70d2bcd470c826de",
      "963dac5df9aee394"
    ],
    [
      "b52718f04cd3c8dd",
      "7ed477309b29deae",
      "a02895d60521cfe9"
    ],
    [
      "0832e6c8febd630e",
      "76c0d40a73da3e3a",
      "4dc8c0dfccb35343"
    ],
    [
      "0a7c8303dc89565b",
      "76c0d40a73da3e3a",
      "6a6c5602d552d40b"
    ],
    [
      "a423e85e5fd65e53",
      "05082b592aa4c408",
      "780b619182ec93e0"
    ],
    [
      "026ad762a2aafe00",
      "47092930f449e8f6",
      "b589428196d6ae2d"
    ],
    [
      "019a3fdac8a202bd",
      "713188036140a54c",
      "00a8d37c44b024e9"
    ]
  ]
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

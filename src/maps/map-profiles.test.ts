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

// Two independent replays, v1.29.21: the first change is T6 a_004 completing
// its authorized reinforcement step (reinforcement-continuity/goldens traces).
// v1.29.34: only History digests change at T4: standing/militia casualty wording.
// Independent HEAD replay confirmed unchanged world hashes and complete Facts.
const GENERAL_GROUP_BASELINES = {
  "架构边界-入世": [
    [
      "e0104f5df15f458d",
      "9afb268ed339d543",
      "4ac6ddd5020590a2"
    ],
    [
      "ad845e0f7907e227",
      "8375d98e573a330d",
      "c9a338b419142edd"
    ],
    [
      "8a3a39953cb2a87d",
      "8375d98e573a330d",
      "fc86e9fa71f202c8"
    ],
    [
      "b6488cae26730d7d",
      "67e8734faa709fa5",
      "2e2bd60da7284cee"
    ],
    [
      "4312fa420c35f086",
      "5231c4de3543d0d9",
      "7a0dbfbd28feb528"
    ],
    [
      "29fe44bbb618fb3a",
      "d3172db7fe33a3f3",
      "370ac0a9c76f1488"
    ],
    [
      "2b71a2d9121852ca",
      "7de4da28413ab97e",
      "609cf2daf7067bba"
    ],
    [
      "2877dac6f489523f",
      "3fc95fd357ee6402",
      "54367339ed1edb40"
    ],
    [
      "d851a1da59480415",
      "08e87e2c9774654d",
      "fbc48728d50a6efb"
    ],
    [
      "a3493bf2b5348860",
      "4b0084de0405fee0",
      "53f70309faf8a3c0"
    ],
    [
      "c6fdd585eb9b97d4",
      "d432296d735d244f",
      "67b10470962e4e26"
    ],
    [
      "21772cc1cabf784e",
      "543fee5904e30a6e",
      "a7e6eb7238fd408c"
    ],
    [
      "f2fd05b28f1b2749",
      "97997efa222d46cc",
      "a4ff32eef129b125"
    ]
  ],
  "州县民生": [
    [
      "d2359d83fd317a45",
      "c1091bfd11ba101f",
      "311387f8067264d9"
    ],
    [
      "a2e025e24ccd1ba0",
      "c7aa7c13c1d129e5",
      "0fbf29670b95e635"
    ],
    [
      "12f9ed707969fc23",
      "46ff5a4071f4553c",
      "25fe3f75d465931d"
    ],
    [
      "b65e514508363b60",
      "c60ebf95d538b5c6",
      "f8fc93d93f0d8a92"
    ],
    [
      "38ddda06bd5c4567",
      "d81761734532aaf6",
      "f7b227bc18cbb274"
    ],
    [
      "f6fde6f445c70f89",
      "f3a7871a7ac76e5b",
      "7db49000de54da0f"
    ],
    [
      "6be34527965aa466",
      "76dc2ef465b3bff2",
      "8246c1b1ea8c7919"
    ],
    [
      "b5f4de6ada056191",
      "c98c57dde996c24b",
      "21c001225d6738f8"
    ],
    [
      "71797ef3c4e44a13",
      "9c4bf8922d5ebe19",
      "59c8a87060103911"
    ],
    [
      "0049fa8d3a7103ef",
      "608308312e868d87",
      "479e1246ccd1abe9"
    ],
    [
      "79e65bf0076024c7",
      "8e2821e44f7cfa03",
      "2568effa01abdc84"
    ],
    [
      "4ba1548a7446ae56",
      "ecc8161dc6cc23f7",
      "ac6d1b792908d5ff"
    ],
    [
      "109e84ddae31748d",
      "5390d825fce10af8",
      "98d4b302960c7c69"
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

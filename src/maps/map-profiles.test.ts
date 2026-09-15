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
// v1.29.37: fleet deputies remain occupied; first divergence T4/T6.
// Original/current office and fact traces: output/kinship-fleet-closure-20260915/golden-trace.json.
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
      "38b51330be8d504f",
      "5ea3daf3eaa4c9b1",
      "609cf2daf7067bba"
    ],
    [
      "3a88436dad619d1b",
      "98211452075df0db",
      "54367339ed1edb40"
    ],
    [
      "338de0ce2fbecb2f",
      "017d35e7f13d1fa6",
      "f240c1d81cd44ba5"
    ],
    [
      "35441d8680ad7fcf",
      "a7ff07a9cfec08a4",
      "09029d3381eddcfd"
    ],
    [
      "ff5fbe8e30e808d1",
      "5114a387cf608e91",
      "85d9ee034aec0ef7"
    ],
    [
      "e28ff41573020380",
      "a3ec1bbf49f9512e",
      "19b61a04d73124eb"
    ],
    [
      "9ffdb6b37ac65866",
      "05d94719c8fdd2d5",
      "13b031dca1597840"
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
      "dff18fdadb071849",
      "f230e637fc540af2",
      "67395235d302b9d2"
    ],
    [
      "521062fe544b74d8",
      "4378fa2544341539",
      "e843e3898cd6b4ab"
    ],
    [
      "da590b3f99093fdb",
      "7ed4d8d754f85572",
      "7cf222dd94193d69"
    ],
    [
      "e31277079f023650",
      "6657ba86f19882f0",
      "a272ca861f2e56bf"
    ],
    [
      "aa792bbd082f319f",
      "d525e17454412855",
      "5bea08b65c8667f4"
    ],
    [
      "eade7a7b82d42b8f",
      "9535565f1cb069a8",
      "1f583101ae9269b7"
    ],
    [
      "0920e10cca556398",
      "9668ae96610176d2",
      "5fda8e28b611931a"
    ],
    [
      "93c4e8f0a18e37ca",
      "a8f9663794e2c2bd",
      "0d9a2a99cbb6b12b"
    ],
    [
      "58bb32df61a82fb4",
      "1ca9794c97f03f3c",
      "421843e7ac51df0f"
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

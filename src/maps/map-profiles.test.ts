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
      "02c5a314d5ef6d43",
      "8375d98e573a330d",
      "c9a338b419142edd"
    ],
    [
      "286f808c1dec6d36",
      "8375d98e573a330d",
      "fc86e9fa71f202c8"
    ],
    [
      "5d5ff1072c0f95f4",
      "67e8734faa709fa5",
      "2e2bd60da7284cee"
    ],
    [
      "680eb0aa3990d10c",
      "77bd24d42bdbaad8",
      "837b11c9e01b9c6a"
    ],
    [
      "b7e5fc8737aa5cbc",
      "7c40699ea42f578f",
      "5a4c182f899c6fa3"
    ],
    [
      "5d56b8d0d900f589",
      "21f78b4dc12031e7",
      "5f66e6599dd4bf44"
    ],
    [
      "db88bc3fd152df1f",
      "4d64863e50c0eefc",
      "0f85aff4c83b67db"
    ],
    [
      "71660c143bb89364",
      "275c03d1a9bfe002",
      "6958508310981ec6"
    ],
    [
      "3417557943848f10",
      "efcc23124338c176",
      "9e16984a2192a048"
    ],
    [
      "c2acfc43b56d6230",
      "1a2e2ac5552b7a17",
      "3d6cbc7a5289b16f"
    ],
    [
      "547faff8e2275fdc",
      "bb389617991800bb",
      "1b94efce7394445d"
    ],
    [
      "504190d6d885536b",
      "aeb0b6aeb00c1fa5",
      "364806c505b3d95e"
    ]
  ],
  "州县民生": [
    [
      "d2359d83fd317a45",
      "c1091bfd11ba101f",
      "311387f8067264d9"
    ],
    [
      "60487b00b2e81a09",
      "c7aa7c13c1d129e5",
      "0fbf29670b95e635"
    ],
    [
      "1c0e1d0266215abd",
      "46ff5a4071f4553c",
      "25fe3f75d465931d"
    ],
    [
      "99ae084af44c9bd4",
      "4e5a7db457ee9d97",
      "f8fc93d93f0d8a92"
    ],
    [
      "3628d25c128335df",
      "3b2048e8d7e7b1b0",
      "de4459d51d880cb0"
    ],
    [
      "63ddae96300e3e8f",
      "35b0b68480e1c3c3",
      "5aa4d3b8a7a7e859"
    ],
    [
      "de599663870b2250",
      "9e2afbae867461ec",
      "d0fbe8a70d65af94"
    ],
    [
      "6b11c627c011acfd",
      "b6fa2291a77810d8",
      "4f4882fb797c6a98"
    ],
    [
      "35d6f220704ce3af",
      "d7cd339376095142",
      "18c188105efacbec"
    ],
    [
      "824818c642c739c0",
      "f2f7620f1fc726b9",
      "ae049ced6d82f6a7"
    ],
    [
      "39aa35a98518da49",
      "d91eef220525084f",
      "e7786b752b3497be"
    ],
    [
      "1c2dad69f489811d",
      "f010a657912b53c8",
      "e158baa1049ef574"
    ],
    [
      "dbeedf63079387ce",
      "3f560a0c8c792c92",
      "7667fb4f50d38835"
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

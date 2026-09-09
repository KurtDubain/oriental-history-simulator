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

// Verified against two independent replays: migration no longer counts as succession;
// the prior checkout has identical military states (continuity audit goldens.json).
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
      "9b717e469f373039"
    ],
    [
      "29fe44bbb618fb3a",
      "d3172db7fe33a3f3",
      "e4b2fd6e651de372"
    ],
    [
      "3289d7ecfc59b1e2",
      "ce1c9ccd1b333715",
      "7d8ac69d98b10c85"
    ],
    [
      "786e38714496b47a",
      "6b216d9989dcf984",
      "db97c45881847626"
    ],
    [
      "5c6692ea58c696e9",
      "0991841cf4308c9a",
      "dcce1145fff99a6f"
    ],
    [
      "9c31a84985afd2b9",
      "fc5a9c76fd289331",
      "8c414b3f0d7f4691"
    ],
    [
      "eef74c42733a5384",
      "5e04fcfe51ac555b",
      "f4b91cecbd4920f4"
    ],
    [
      "3e463f5008fb1c80",
      "37e42f2c9bf46769",
      "10e1e0a8ec7e043b"
    ],
    [
      "b1a8469c4f137d00",
      "b737806c89e825fd",
      "2aa41f1ef1066259"
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
      "2938957ec19b7c63",
      "4e5a7db457ee9d97",
      "f8fc93d93f0d8a92"
    ],
    [
      "c0d85349373fcd07",
      "adfec869390ed307",
      "5bab2faa0a5ad054"
    ],
    [
      "9bdec93d46b19d26",
      "ec5a2fdef9f0c3ff",
      "2682b9657d4294e1"
    ],
    [
      "28737d4f5a229939",
      "ac03df0fc8c83cdd",
      "19fc6fc06ab1650f"
    ],
    [
      "075e72a1966902c9",
      "965d6c126890031d",
      "c0fab3ab98a85523"
    ],
    [
      "3a1fd535b496d7e1",
      "ccaa45bc56c9aa8a",
      "553d28544e2a456d"
    ],
    [
      "5051df2d2a2c3393",
      "77b2cbfdad644cfd",
      "16ee68792121ffb3"
    ],
    [
      "4bb0fc2f4b305ae3",
      "97d1e25cdad7c582",
      "88aa1ee2addf8bd1"
    ],
    [
      "dc52689db0981470",
      "12bc9393eccfc467",
      "0be388cbf39f1fa6"
    ],
    [
      "8bb27b3ee5576593",
      "619e4bb23dac2082",
      "cb102ab4bb916c41"
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

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
      "a3a14a50de9064e3",
      "5231c4de3543d0d9",
      "9b717e469f373039"
    ],
    [
      "62333e73efc375e8",
      "d3172db7fe33a3f3",
      "e4b2fd6e651de372"
    ],
    [
      "811a06f645269275",
      "ce1c9ccd1b333715",
      "7d8ac69d98b10c85"
    ],
    [
      "4285252ad6c02177",
      "6b216d9989dcf984",
      "db97c45881847626"
    ],
    [
      "20d6245c63768209",
      "0991841cf4308c9a",
      "dcce1145fff99a6f"
    ],
    [
      "88f5d47adaf30298",
      "fc5a9c76fd289331",
      "8c414b3f0d7f4691"
    ],
    [
      "91ea12765545162c",
      "983cad9e68835525",
      "81bc81b29d3f6210"
    ],
    [
      "88eb4b4f1a8fbdd1",
      "8bd308f8351f78ea",
      "252ad42de501a8b0"
    ],
    [
      "6aeaff264f7f4b97",
      "24e6bc2dd14e6e8f",
      "f123943739d5d584"
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
      "7dd08766ae61ea4e",
      "adfec869390ed307",
      "5bab2faa0a5ad054"
    ],
    [
      "16ecec6d7d8e8a95",
      "85dfd5f27f45ff48",
      "8ea2388e551da854"
    ],
    [
      "62b35bdc9332ef48",
      "d2808bdc08203f58",
      "88166e5032dac196"
    ],
    [
      "d166bd75eb6f09a1",
      "dd559de9edc45e70",
      "59ad0eb04d6a231d"
    ],
    [
      "b08850091a6523ef",
      "601a36222d87fc57",
      "0ba5b01b6bff270c"
    ],
    [
      "1ba7ce68ea40d32a",
      "72b3d93df1dbec88",
      "642fc175ece535c7"
    ],
    [
      "067901917a8f4e0f",
      "54f1efc40b8db39f",
      "fe155ae92e644cff"
    ],
    [
      "34f986811b6efaf9",
      "8efcf24a3115aa47",
      "338191b3ec465f5a"
    ],
    [
      "c28e2da8646a9ab1",
      "0534542023ea14f5",
      "b29feb053fabf2f6"
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

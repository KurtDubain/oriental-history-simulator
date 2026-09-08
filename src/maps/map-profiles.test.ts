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
      "8c84a0cb0a8175cb",
      "8c1fa13a4968ba73",
      "2e2bd60da7284cee"
    ],
    [
      "1110efb80b046788",
      "f141c5527fa30da9",
      "229cf714b3d9cba6"
    ],
    [
      "c137c30eabbe509f",
      "b535871fcc0128aa",
      "0de34d72a48633a1"
    ],
    [
      "9f730be47d9a19bf",
      "0e263c7be40adfce",
      "4312466c0a707902"
    ],
    [
      "ab333f4cc604f47d",
      "8a1c2db8f6c0e455",
      "6e65f1df67082d22"
    ],
    [
      "0d771763a972bc45",
      "dedc0b25b644a1e7",
      "3f8840ae2be7dd29"
    ],
    [
      "6e3fbc0f628debea",
      "367e2e9e6c4f0078",
      "3608b87fd3046516"
    ],
    [
      "b654730c170e7d24",
      "426f2273dd687365",
      "07dbd540b09e8d82"
    ],
    [
      "d89a4645912f4efb",
      "3038711b3988b78e",
      "23347deafb67b382"
    ],
    [
      "2a14918a99d64ec3",
      "c47a0ce8bfc69df1",
      "c8643dc13525f754"
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
      "8cc4806a4d957cb8",
      "841445ba2f9a5a45",
      "f8fc93d93f0d8a92"
    ],
    [
      "7480e6339c4c7dee",
      "7fdc79732e18f323",
      "9d4a47c1f4145b5d"
    ],
    [
      "7fa6c3d780149cf7",
      "5843a069bf747dca",
      "301455f6e9e97c83"
    ],
    [
      "0ce2b6d56ece2f2a",
      "d0411e0837319a45",
      "06a5793bba3823a4"
    ],
    [
      "10b0c638c07510a0",
      "8c4c71530503d3db",
      "1d85030833c22dae"
    ],
    [
      "6cba45eee68a12b7",
      "00c3f27ad39d2d82",
      "1ec0319ebe272ccb"
    ],
    [
      "86db766e3d10f261",
      "0ea8f4131e9912e6",
      "9849490ec3879865"
    ],
    [
      "c62ffb712494dec0",
      "4d1df3a196d4ef4e",
      "8435737ae0b8b1bd"
    ],
    [
      "669e0554abe4cc2e",
      "ab0071ba2cce1712",
      "991aa1383ba8f63e"
    ],
    [
      "af5f71d2df5eedaf",
      "bee1548d5cfaa72b",
      "6100f5b18760fd8d"
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

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
// v1.29.38: T1 local appointments no longer draw serving army members. Two exact
// replays and first office divergence: output/talent-entry-20260916/goldens.json.
// v1.29.39: shared succession prediction first changes Situation state, while
// completion events now include all three ship classes. Two full-body replays
// and the first actual Fact/Event differences: three-closure-20260916/goldens.json.
// v1.29.40: T8/T7 background entrants found independent families rather than
// joining unrelated namesakes. Two full-body runs: mechanism-tail-20260917/goldens.json.
const GENERAL_GROUP_BASELINES = {
  "架构边界-入世": [
    [
      "e0104f5df15f458d",
      "9afb268ed339d543",
      "4ac6ddd5020590a2"
    ],
    [
      "ae457d87422a4f68",
      "f213ebba35eff776",
      "c9a338b419142edd"
    ],
    [
      "02d6238e2afb36f4",
      "f213ebba35eff776",
      "fc86e9fa71f202c8"
    ],
    [
      "eeff00b68cf4984f",
      "45fca603e54d3d7f",
      "655dc480fcf5aed4"
    ],
    [
      "6152a973ccc8321e",
      "7f4a4a0a97743aa3",
      "38d8a2cdc70896a4"
    ],
    [
      "d0e6239cc713c0ce",
      "4873cf656259869b",
      "b29360b669cfc5fd"
    ],
    [
      "490eb3f3a5f81e6d",
      "604ba9c7830befc5",
      "f958154d1f88f42c"
    ],
    [
      "a23fb9ca061bab07",
      "658b12b6e5ac379e",
      "915e234f73a849b3"
    ],
    [
      "b2d04e020d05038b",
      "bb3cd3ccc615b89c",
      "ffbd155add682406"
    ],
    [
      "5639ea2d33e7649c",
      "2c1f31556b7eee12",
      "312ba7f87b4eb6e3"
    ],
    [
      "97fc31b6aca024ae",
      "a99305bec657ea14",
      "817cf8a13e9db483"
    ],
    [
      "4800626f52be9f55",
      "80a156db26c75aba",
      "a6a647a8607c021e"
    ],
    [
      "ef317fd893ab065d",
      "d94f6726fd0789f3",
      "a39ee97bfb078c81"
    ]
  ],
  "州县民生": [
    [
      "d2359d83fd317a45",
      "c1091bfd11ba101f",
      "311387f8067264d9"
    ],
    [
      "a3776310fd4868b0",
      "736a8cba5fa424c3",
      "0fbf29670b95e635"
    ],
    [
      "0e8cd37bb0ccac28",
      "a44403222f292c0e",
      "f222800af6bd5451"
    ],
    [
      "bd22e6d6d58e7add",
      "e5de08c43b0e3980",
      "fda116e1ab107602"
    ],
    [
      "be69397b1076de99",
      "42859aa93948fa6d",
      "7a5f23a5cc2f9998"
    ],
    [
      "09ec7aba1ce8a1cd",
      "8c031a8b5212ea13",
      "fa6a7b5316f7da93"
    ],
    [
      "a6f1a090926238e1",
      "9046061c81db4347",
      "8b380a4b82845d8a"
    ],
    [
      "1cc28bce45411af1",
      "01fd1eb940a4c94b",
      "64ccec568320a6ef"
    ],
    [
      "9f966261a4ff858b",
      "372422173106745f",
      "c61e2231522a5296"
    ],
    [
      "40b18ab34ee2ae7e",
      "092c1c621ece1416",
      "e6aec66816be7a3c"
    ],
    [
      "df44e41bebeff99e",
      "bb32a9852c71c12b",
      "d1e0a8ad101066e1"
    ],
    [
      "f81cd544b1d00b2b",
      "e4b5567224bf8b26",
      "c9ec47ef981fafa5"
    ],
    [
      "c780b62fced9bde1",
      "17df549ea49487df",
      "0f9ee0a544263fb2"
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

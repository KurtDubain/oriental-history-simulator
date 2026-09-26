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
// v1.29.44: T3 battle losses; two exact replays in war-cost-20260926/contracts.json.
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
      "cdacd5baa5374107",
      "180401823a850679",
      "84280bf5a48b4c01"
    ],
    [
      "591a543ca761c492",
      "f899429a865146db",
      "2e1ff01596c113fb"
    ],
    [
      "830d1bf2f50e820a",
      "9e7eb2e9efbe0d30",
      "6529f54d6db7d864"
    ],
    [
      "d6cefceb2ea3522c",
      "0e6db123933b5253",
      "5961439cd5e56bfb"
    ],
    [
      "4ba05f87b341308e",
      "da1fcd74f7791c01",
      "3bf3e8bcdaddfe25"
    ],
    [
      "337b8a8316210b86",
      "6e62786c98c59c5e",
      "e29733ef47f16ca0"
    ],
    [
      "4076fc6097cc2b14",
      "5e5b1586c2ac3bff",
      "126233728b8a1167"
    ],
    [
      "7c8b5adbb05284b3",
      "c1712569cce28090",
      "1c2606f8c57a984d"
    ],
    [
      "8e6ec02055b1daf5",
      "a565e57c620cd566",
      "ac2cb0ad9a069687"
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
      "b0e4e6430cd2621c",
      "0b45b1e3544bb316",
      "aae69d6e1567c19e"
    ],
    [
      "53a28df67aa1b105",
      "3d4b8fc17f8b5d15",
      "ce4004ed03caa19f"
    ],
    [
      "1a5e8e853ea71a42",
      "79beb317343c841d",
      "3aa615ae05b971ee"
    ],
    [
      "2ba0b7097222a1ed",
      "99fe3b7dc1dd9d3a",
      "70084a3fbcc0e5f6"
    ],
    [
      "2d42b039524e82c8",
      "ba3486ef4a79f2aa",
      "d5ee4a4a70259130"
    ],
    [
      "9ff834ae2a143a6e",
      "c3dbcec69ab1a1b7",
      "b5b9eb21a973e07d"
    ],
    [
      "2e7aeacb8d5d0912",
      "08d68ee10809c4ec",
      "53bcad419c9ac2f5"
    ],
    [
      "f0c04a20eb736021",
      "e0f9a1ad7628ebb0",
      "daa3ed0601c948dc"
    ],
    [
      "67050ba8ae4ab0e0",
      "de046cb8a180818e",
      "8178f1ae093be7e5"
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

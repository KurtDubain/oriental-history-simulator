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
    ['2c057879973ee53f', 'd4c3da86943f2f8b', '920e0d2663f1c887'],
    ['32160a502882dc37', '67fda7fbd8121e3f', 'ce497532c0aa2d9a'],
    ['7e999385318f635f', 'ca2db9f08bf14998', '70195a032f44c146'],
    ['3b6cc4e4e56001ff', '4bf72a3d8d2829db', 'acf4312feb972ab5'],
    ['d1354fbdc0df8c74', '21830dab1b04d3ce', 'a9269d945fa83a1f'],
    ['704aa8bdc6dffe88', 'eddf3dcc758d7f2e', '772d1d3f3b52cd23'],
    ['a1ef9e407a6aeebf', '3699c6f89f6eb93a', '3eafcaab451e9450'],
    ['809010ebaa83495c', 'a8b8ed079e49b3fe', 'dc4de8300e6d16c8'],
    ['cdfbebde1a700074', '9b5f5d7b150acdbc', '8b4dc6f210838208'],
  ],
  '州县民生': [
    ['d2359d83fd317a45', 'c1091bfd11ba101f', '311387f8067264d9'],
    ['21b4941f15ffdbdd', 'c7aa7c13c1d129e5', 'e5ede6a88818a7bc'],
    ['e0e6e928f4e48c5a', 'a21e2b5cc34b1e44', '65b4b6d354e85df0'],
    ['0995734e8c0cc407', '97afe7fd25afdaa2', 'a3cfe25851de1aaa'],
    ['0d3738f41f2e47fb', '8458bbabf09c3246', '66f756ac90cd24e5'],
    ['6e2ccca44d70588e', 'd6a24097dc8d3a64', '6a9fb385d2b75573'],
    ['791630ad33592014', '7e14138a771622c8', 'caec9c41f492f6c5'],
    ['8290e37c53521bc1', '2cc0b4d2ff6e7791', 'de2ffa0109a2f92e'],
    ['5e5545520d0ebd7e', '90704327477e17d4', '97321888b09979ea'],
    ['5824621d618918ff', 'cb063625d2c42d2e', '10efc4ee1a2b5edb'],
    ['e6f156e462b9392f', 'cfe3befc2209bef0', 'f21aeb3f15bfa897'],
    ['dc8c5d8fa7891215', '330d27817ba0da29', '77363396d5779c35'],
    ['72091152d478eadb', '0a5ef396d6855008', 'cd5f7567c4043c62'],
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

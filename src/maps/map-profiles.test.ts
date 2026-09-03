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
    ['21bc2f39100ef074', '216bc888b4b9b3fb', '0807932e74f51a7d'],
    ['b5e8d64bc9bf2ea7', 'f4297b2016506345', '72bc6b8e72401366'],
    ['04ed4443082de12c', '510f8146e008d973', '3af910f4012ce715'],
    ['a04083bd33f9d73d', '08ceee0e93f0b308', '1088ead36458291c'],
    ['8718509b19f29ca4', 'f9da2be8b65108be', '0d84eeb7817f6841'],
    ['c88b316ef7d886cf', '6f3aed8f3571c6a9', 'f6c218ee974d2ca0'],
    ['b7945a2adad12a27', 'dc4cb1f3b539f7e9', '69e2db28650a2d42'],
    ['657ae41eaf7cc87c', '81eff4cead6bddce', 'feaae5fc6a44f0ce'],
    ['baa77cdb9d810b0e', '994fedebc7db0ad7', 'af1c38abf62c5292'],
  ],
  '州县民生': [
    ['d2359d83fd317a45', 'c1091bfd11ba101f', '311387f8067264d9'],
    ['21b4941f15ffdbdd', 'c7aa7c13c1d129e5', 'e5ede6a88818a7bc'],
    ['e0e6e928f4e48c5a', 'a21e2b5cc34b1e44', '65b4b6d354e85df0'],
    ['0995734e8c0cc407', '97afe7fd25afdaa2', 'a3cfe25851de1aaa'],
    ['39ef06633c7a30cb', '9cf52cc9f739d7e8', '66f756ac90cd24e5'],
    ['48f06ccaac369c5a', '468d0a6340632ede', '6a9fb385d2b75573'],
    ['d6455fcd06c1c7cf', '29ac0954f20c7e1a', 'dbffe2900ed1fde7'],
    ['6d571274d1faba0c', '50400e3da7b4d3c7', 'dee6748c174fb668'],
    ['fdf4fa8b0083af56', '5f381a7281d3c2c5', '80b35e625be2cd9b'],
    ['8b174da065af7258', 'eac12e9cf85dcbca', 'c97d20103ded33f3'],
    ['9f576b728c84464c', '81bc67366b3e531a', '59a44d4be707eb55'],
    ['6ccdeeb0dd23a501', '077b22f8d140dc50', '0baaa43455f4676b'],
    ['f21f406c663f8704', '9c132651de04d210', '2cffee24da2d47a7'],
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

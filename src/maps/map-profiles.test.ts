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
    ['7b49b1dd17fe4dd6', '3e8edaddf887d0f1', '16614b169cdd3386'],
    ['f6b4662e332fd662', 'c3a81f6924b97f77', '2942f9e14531301c'],
    ['c8892a11aff3c314', '3e8f8a1962c2d4e9', '730a7c74a7c092ad'],
    ['0ba5773d5d8625a3', 'e26e3ef19ca57e21', '4cc6b9b3f48b02cf'],
    ['417630d9dc87658c', 'a132f1a94ca46cf3', '61d21b58c372af1e'],
    ['6a0b87bed7cb2150', '648a2be6bb2ef6aa', '92d85078a50e74eb'],
    ['aad07996706d6f12', '7a2b09ed5f775164', '975c9d01397ac186'],
    ['b146ec2f6747ea50', 'e4e82d782aae53c1', '85b684d090dca214'],
    ['f84bae74b68bb6dc', '8205671693d1c6b3', 'a2af0e95a25c9178'],
  ],
  '州县民生': [
    ['d2359d83fd317a45', 'c1091bfd11ba101f', '311387f8067264d9'],
    ['21b4941f15ffdbdd', 'c7aa7c13c1d129e5', 'e5ede6a88818a7bc'],
    ['e0e6e928f4e48c5a', 'a21e2b5cc34b1e44', '65b4b6d354e85df0'],
    ['0995734e8c0cc407', '97afe7fd25afdaa2', 'a3cfe25851de1aaa'],
    ['2e7d184bba5e0434', '2efd9e8ee8c8f0b0', '39453ae07a7fe26f'],
    ['76153540c90ece93', '2e4b3dc86b60057d', 'c41c855a5dc8e10e'],
    ['d904fba5f2747737', '1c3583fe497457e8', 'bf5dfe79ec5ccda7'],
    ['6897a7282969704e', 'a7dbb233cd3b8a56', 'aa88f5a5d95aac50'],
    ['6b011e032c66d452', '06ad330a785e7022', '0663d5e97a1b5c8c'],
    ['230e6d8941a5391e', 'e2e91d0f815b34ec', 'ce0c66e44cd7e053'],
    ['19724097f2e00942', '3d83afc97a3e0675', 'd29c54c3cc34447d'],
    ['756c2647d8907d35', '3583177626485f78', 'c29c736c0e24272d'],
    ['caf490841aa67eeb', '7077f7f2ba309017', 'e15ff5b185e9ea5a'],
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

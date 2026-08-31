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

const V1160_BASELINES = {
  '架构边界-入世': [
    ['de1c47304bfe2e37', '2cdf17658cc3a414', 'c1b3eefde96d4684'],
    ['85892bd7847bc7bf', 'e5419911a0ee752e', '26aa4e76684c053d'],
    ['5398cc2efc71c74d', 'e5419911a0ee752e', 'aa1a2fb8d23e3b3e'],
    ['a81e9a4711e010b8', 'a6becc353685fc76', '1f75ed0e730953a6'],
    ['355e5cd279f885e5', '47a1294541fc467b', '6b32704e5e457653'],
    ['7e634c28dca4a40a', 'eff20a86cbc37744', 'f8c3ef803394cc5c'],
    ['2de5e191cf44ebd5', 'c84b4c9ff38ba60e', 'f3a2c98eca7054ba'],
    ['3e69c32980785c2d', 'dc27fcb242b28760', 'f2c1e7a361018742'],
    ['23ad167842bf86d6', 'c56b7571849d993e', 'be0b3f795e1bc234'],
    ['abb665d1ac9d3967', '97ffca1d18de6829', '9ca3346fb2dfd340'],
    ['4227e79c99bea2f8', '50bcf8900272329d', 'bad761f98d781ebd'],
    ['1738a8dc35f1b0ed', '002bee7b54b67ce4', '5139b57072f28731'],
    ['bc6aa5bc3ac7ea7d', 'c426909dc585da4c', '556771ddb005e958'],
  ],
  '州县民生': [
    ['533f3f3e524f2eca', '500ad0ab9680ef86', '6905601648536b20'],
    ['1244e6f032cf145c', 'c3299f2e30e6c5f6', 'b254d036cd169b61'],
    ['adf4565d31d34a25', 'c3299f2e30e6c5f6', 'c71f90f45121c6b1'],
    ['47741a5169f8de29', '75ebf627892859ed', 'e53c5b18a15d9eb1'],
    ['9acf177e27163b54', 'dc94abc3a26908c6', '433035546ba76b14'],
    ['6c82785030cf0eeb', 'efc36a3fee7227ac', '52bf56dbb7976241'],
    ['79e5b23163c8b759', 'a632ab918aa3d848', '5039d08415cf4521'],
    ['e2a684f462709c15', 'afde3e80d4d9809f', '24d4e5b02f9dacfb'],
    ['cfded17e44f05151', 'e72c8889c7edd6f0', '841094b85b360b87'],
    ['3011ae0302f8ec0c', '47c0490f3ce3ae54', '49e68094857d4067'],
    ['1656fb5156cf01b2', 'ea899a09ad15a367', 'd9680be6fa8433ae'],
    ['8aab922e7ac7242c', '00f562455f00138e', '9d769fc23af2c447'],
    ['5a38802b90ef398a', '85d2dc9085c677d1', '23c550459e579754'],
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

  it.each(Object.entries(V1160_BASELINES))(
    'keeps the complete v1.16.0 opening and twelve-quarter digest chain for %s',
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

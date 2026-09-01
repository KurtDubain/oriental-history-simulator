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

const V1210_BASELINES = {
  '架构边界-入世': [
    ['b0b0b744104cf3a4', '2cdf17658cc3a414', 'c1b3eefde96d4684'],
    ['422b04f4c5c78397', 'e5419911a0ee752e', '26aa4e76684c053d'],
    ['d8eff9be26121085', '312b069d54287ab7', '7c0897f32e0a78c6'],
    ['0a6cf7eb1fe279c9', '0e74f20b0b5598c4', 'd12c7d3036297d02'],
    ['01a243252bb74b1a', '6758107147f42318', 'b682cb61a3bdfffb'],
    ['ebd2d17b08b674f6', '718f7ef9615b3636', '31db4a3d26fc70a9'],
    ['f8952ee22e4fb268', '3ec7d35916833f0c', '0e26e192435624c7'],
    ['78a4c7933022de96', 'e415f7bbb3eeadb4', '137f609875798b9e'],
    ['ec83e1497df72147', '9511c86e6eadc2ad', '85afa743ac40f047'],
    ['aacffe04a48299f7', '828c2420ec38eab7', '8824c0e57a260a40'],
    ['0f131b97bf498af0', '9454fa4d9fdf7d96', 'b2d5a93a4297bd0d'],
    ['f5d328ece18bb5a1', '76db781a59fdaf75', '15ca43f348400785'],
    ['187d11252d1e1dd4', '4fb0ed6c133f722f', 'ac751a8894ec7e1d'],
  ],
  '州县民生': [
    ['4dadc4ac742ea5d0', '500ad0ab9680ef86', '6905601648536b20'],
    ['edcc44cb2e31fd00', 'c3299f2e30e6c5f6', 'b254d036cd169b61'],
    ['556772f3474334f0', 'daacfd3cbdf0a007', '7df06995db6b9ed5'],
    ['769316745067d323', 'f0f0a30da4857549', '517b55f127fa0033'],
    ['aede90d9b224485d', '4c8f4f1b70acfec2', 'ca2c48ad802907fa'],
    ['58ac5f6dc0672cbc', '96049a6f871d8d6b', 'f88d1c4754c632f9'],
    ['c5a36ebffef91d18', 'b827949a282dafcc', 'e36a5f3d9782e069'],
    ['539408f421354d64', '7d47f3e910ff520a', '0e95b02eefff23d1'],
    ['9d420677232677be', 'ef91c108e314b4ea', '35b95e53d4e8044e'],
    ['e341fbecca5ef789', '7f12336dd792c418', '0c521d6e173e5788'],
    ['7577a89bcb7be10a', 'a11f8b46c071e3df', '623d66098cd5b538'],
    ['d3cfcf19a03507fa', '2feae9d9036e2c98', '9840169fc6f2b26d'],
    ['7945684e2067f7f4', '4c63bd8fedab6921', 'a53d44bc8367a1af'],
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

  it.each(Object.entries(V1210_BASELINES))(
    'keeps the complete v1.21.0 opening and twelve-quarter digest chain for %s',
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

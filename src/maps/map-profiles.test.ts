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

const V1180_BASELINES = {
  '架构边界-入世': [
    ['28a9409c901fb1ad', '2cdf17658cc3a414', 'c1b3eefde96d4684'],
    ['847fc1e7198a0743', 'e5419911a0ee752e', '26aa4e76684c053d'],
    ['442ffae15ebca730', '312b069d54287ab7', '7c0897f32e0a78c6'],
    ['e32a207ee7730d82', '455a11a141000291', '311d545a423719a3'],
    ['fd98aef164c3af05', '8a8b4d1152fb1782', '246b056ea3920dc3'],
    ['97a04af627d2943d', '38fc5f8dac77a817', '2903b1c836466871'],
    ['b58ac25a11b14a8c', 'b7e448acf31fa71b', '4fcb21b1f6b75849'],
    ['b08d2ce860570023', '32ab66c347e9e79b', 'dffc9a49b1f32f3a'],
    ['dca7059adbf8cd0d', '9830e70f27a27947', '4dba8d5226d11b83'],
    ['d765cfaa2d95f1d3', 'cb0a979b42b925f8', '0d532173943ce784'],
    ['f6cbd446d9d2064d', '359a0f7b1d1df59d', '8659f4b94a1b122f'],
    ['bfa4707285537b11', 'db3727fc7e2bf095', '1869f8790714b49c'],
    ['0b73aac9263cf272', '175287c577854ee9', 'a91bc2ef562632fb'],
  ],
  '州县民生': [
    ['d20baa490e51204f', '500ad0ab9680ef86', '6905601648536b20'],
    ['3687d955f279072b', 'c3299f2e30e6c5f6', 'b254d036cd169b61'],
    ['cc32ac4826b4ac75', 'daacfd3cbdf0a007', '7df06995db6b9ed5'],
    ['27d40c230527d983', 'c4aebd8ca3bc22f1', '907fb59a4221bb65'],
    ['e6005fcbbd774275', '41b844091569ee58', 'b9efdf89ea1d557b'],
    ['d186cb8911baece0', 'db3c9fbc7192beac', 'de7c0daebbbd10a1'],
    ['705f143a92ed23ec', '46a7dd76fd0a97eb', '1355739e43aaaa97'],
    ['f4727f5bc3dc954d', '3bbeb51519933665', '40f3a1d54b90ffb3'],
    ['8b57e9ceda99a941', 'a0290a9f2d60a355', '662e7f5f1fbd7369'],
    ['6ee8da23a063af18', '3eadf112b15d55ce', '662ca18b17bfd844'],
    ['46864c6d8729ee0b', '2e418dd64a9d0872', 'bf61f11d19415743'],
    ['d3928cd12c6469a4', '9386aa37647f967b', '2cd6d55c11e1b833'],
    ['8e1b27a7d40970ac', '7c4000278ecc26ad', 'b35434f95b8be0ee'],
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

  it.each(Object.entries(V1180_BASELINES))(
    'keeps the complete v1.18.0 opening and twelve-quarter digest chain for %s',
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

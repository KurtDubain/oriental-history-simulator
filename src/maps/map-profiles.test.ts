import { describe, expect, it } from 'vitest';
import { advanceWorld, createWorld, serializeWorld } from '../sim';
import {
  DEFAULT_MAP_PROFILE_ID,
  findMapProfileForContentVersion,
  getMapProfile,
  listMapProfiles,
  validateMapProfile,
} from '.';
import type { MapProfile } from './types';

const V163_BASELINES = {
  '架构边界-入世': [
    ['e9d43ae5ab279d91', '2af16fb598b05151', 'ddc0763fd325c652'],
    ['a9aeaf83436b79f3', '5ba3f84c9eb61cd5', '4096a5e8e1ee68bc'],
    ['6c47548ed8bfe63c', '5ba3f84c9eb61cd5', '3157caaab9b671f8'],
    ['07b29e4584a0dfff', '84e4b48de9ca0c45', '1174038142a870b2'],
    ['06ad8239053d68ae', '7009d16014eb9f2d', '7c1ded09a3ee6447'],
    ['4913b15cbfa21ec6', 'c2967b6a17d93e77', 'b9f429ada92d35b2'],
    ['6e77b85a64090e6e', '039ba394bfcfdc43', '2b58e8a2d4fc2f67'],
    ['98f2d483cbeceab0', '0b1270bf6fc243ed', 'b2179a0508572b28'],
    ['3788b10a6bd50894', '7114119a9fe097ed', 'f7c15617ad39b825'],
    ['45f83d976de09136', 'b116f3d60b1b4fe7', '7e0b58149a102a09'],
    ['d23ea661a258067b', 'b89892664bd84e91', '24a75857814ce314'],
    ['e9e80689f68c7499', 'e0d9fb192dec541a', '31570404607cf427'],
    ['b3d251393345c074', '799fdd74d0cfec45', 'd19a6fb1ef52a427'],
  ],
  '州县民生': [
    ['df55e558e982a8f4', '2af16fb598b05151', 'ae9840c9ee0caf06'],
    ['716e64998f3d8f1c', '2dce8f7e045f34bf', '7dbe19fe8057bff2'],
    ['c065841a20c3177f', '2dce8f7e045f34bf', 'fb770b12c477b21b'],
    ['9ddb3ba0230e9e05', '39cdbcf2c829eae7', '0c65e6c54b27dc31'],
    ['54190e317c3c5d0b', '51e64e017973afbc', '68feef2f7b16a718'],
    ['97fc623a407399f4', 'd87f7603fac5a5e2', 'e8ccde0d2b253313'],
    ['6fded4bea75a6bdc', 'f4527d974e5d374d', '531e66379a2c0717'],
    ['4fa9dbb99d4eefd0', '80a72af465fcba3f', '75b822938babc2d6'],
    ['c0ae659ba938b325', '27e471b00043554e', '9a6ad19333c6447e'],
    ['f071ba3b99b649ee', '8b8bc5933bbc4acd', '352fc43c053ebfb0'],
    ['e67837df57820a9f', '29ec3e50ff4f1efe', '2861baa4754bf8d7'],
    ['fa2fdf6b17bbd9bf', '3d516b4c51fd5cd6', 'aaeb0fd90baa5472'],
    ['fb1a6e0123973338', 'c33c886e6a5e75e8', '8ec6da349d2e0099'],
  ],
} as const;

describe('MAP01/MAP02 map profile boundary', () => {
  it('registers the complete private atlas and maps both current and legacy content to it', () => {
    expect(DEFAULT_MAP_PROFILE_ID).toBe('private-v03');
    expect(listMapProfiles()).toHaveLength(1);
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

  it.each(Object.entries(V163_BASELINES))(
    'keeps the complete v1.6.3 opening and twelve-quarter digest chain for %s',
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


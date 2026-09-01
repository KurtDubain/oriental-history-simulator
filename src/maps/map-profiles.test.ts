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

const V1211_BASELINES = {
  '架构边界-入世': [
    ['ca18458391bec4c0', '49075f2efc985d62', 'c1b3eefde96d4684'],
    ['8ab81a217bfbf7af', '14b7d7114a7eca7c', 'e039dd311a640dcd'],
    ['128adc68d0016338', 'eb9de43aabc98a7b', '14e1ccc64d90b591'],
    ['5bc9bc09d966019b', '21ab56fa60a3c9d6', '08fc4a33889e91cf'],
    ['3fb4dddf7152db29', '0dee4435f2ff1b05', '4db3dca714560301'],
    ['2aff0263c124eaee', '748bc3f1631c5839', '7141cb63e519d34b'],
    ['dfc809dc3fc22202', '727014c17f87f8e0', 'af60fc163e7228f4'],
    ['f17039f943a23bcf', '21dfc1e4f3f3b03f', '8d5ce5ad7b0ccac7'],
    ['4ffe7a4f86361b0f', 'bdc67fe0badf7a5f', '8cd21f58c6dbf2e5'],
    ['7bf3403b55e379c4', 'f048fb15b06ed638', '15f2de54048deba4'],
    ['5aab95a22e2dcec3', 'ab53a3968c430aaf', '1024b3f15a8a8dfd'],
    ['63282364fe4afc58', '87ec15eae9525241', 'fe36068e5efe11c1'],
    ['fd71d3df2c785574', '2e0dbf1a3ddbe212', '55e416ef0c861827'],
  ],
  '州县民生': [
    ['61670f74c0631d6e', '5ba1e61bef3f55e7', '6905601648536b20'],
    ['1ca3ace2adb0a55b', 'c1ddb9198095dff9', '7e1511dd432718f3'],
    ['86de217fa9f549fa', '4faf3272c0e64f35', 'c09a7114e19440c2'],
    ['17198371523582fd', '1df211446f115a34', '9de43ae6ed3fc387'],
    ['0116ecde7eb0a871', '2997106094e38697', 'fbc8d3be4d40d6e0'],
    ['141a80ebac66b01c', 'e0c05b8070b4920a', 'be2fd99f70db36a4'],
    ['e34fa7d31a7633e9', '0a63adde41391d92', '0470ffa2e5e6660f'],
    ['52c1c835385a9647', '873563d444673cd8', '5db77d971c36b911'],
    ['49a9d39e6b0ae0d4', '808759d40e28db9b', 'bf8c27c15508dcfc'],
    ['74fe5575037e76ab', '5d5c3891241b4798', '6a9b5a9eab2edadb'],
    ['75bbd2cfeefe1564', '953a45864088cf3a', '301cc6578f86d284'],
    ['0580d8cb930419ab', 'f29c19673460176a', '38115ec63d7217e5'],
    ['68421f9c950508f8', '72afbc38cf79fff5', '83e5b3ba1e4215cf'],
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

  it.each(Object.entries(V1211_BASELINES))(
    'keeps the complete v1.21.1 opening and twelve-quarter digest chain for %s',
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

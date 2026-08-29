import { describe, expect, it } from 'vitest';
import { getMapProfile, validateMapProfile } from '..';
import { advanceWorldBy, createWorld, serializeWorld, validateWorld } from '../../sim';
import { REGION_GROUPS } from './simulation';

const REAL_WORLD_LABELS = /河北|北京|天津|山东|河南|山西|陕西|宁夏|辽宁|吉林|广东|福建|海南|台湾|日本|朝鲜|中原|岭南|东瀛|燕国|齐国|和国/;

describe('MAP03 contest-v01 content package', () => {
  it('contains a complete 68-region, 10-sea and 8-polity fictional atlas', () => {
    const profile = getMapProfile('contest-v01');
    expect(profile).toMatchObject({
      id: 'contest-v01',
      revision: 1,
      contentVersion: 'contest-v01-68',
      name: '云海八荒',
    });
    expect(profile.simulation.regions).toHaveLength(68);
    expect(profile.simulation.seaZones).toHaveLength(10);
    expect(profile.simulation.polities).toHaveLength(8);
    expect(profile.presentation.landShapes).toHaveLength(7);
    expect(profile.presentation.width).toBe(1000);
    expect(profile.presentation.height).toBe(700);
    expect(validateMapProfile(profile)).toEqual([]);
  });

  it('assigns every region to exactly one named fictional geography group', () => {
    const profile = getMapProfile('contest-v01');
    const grouped = Object.values(REGION_GROUPS).flat();
    expect(grouped).toHaveLength(68);
    expect(new Set(grouped).size).toBe(68);
    expect([...grouped].sort()).toEqual(profile.simulation.regions.map((region) => region.id).sort());

    const visibleCopy = [
      profile.name,
      profile.subtitle,
      profile.description,
      ...profile.simulation.regions.map((region) => region.name),
      ...profile.simulation.polities.flatMap((polity) => [polity.name, polity.shortName]),
      ...profile.simulation.seaZones.map((zone) => zone.name),
      ...profile.presentation.landShapes.map((shape) => shape.label),
      ...profile.presentation.macroLabels.map((label) => label.label),
      ...profile.presentation.geographyAreas.map((area) => area.label),
    ].join('|');
    expect(visibleCopy).not.toMatch(REAL_WORLD_LABELS);
  });

  it('gives every island polity a connected port network and a viable capital', () => {
    const profile = getMapProfile('contest-v01');
    const islandPolities = new Set(['p_liuhuo', 'p_yuedao', 'p_cangya']);
    for (const polity of profile.simulation.polities) {
      expect(profile.simulation.regions.some((region) => (
        region.id === polity.capitalRegionId && region.initialControllerId === polity.id
      ))).toBe(true);
      if (!islandPolities.has(polity.id)) continue;
      const ports = profile.simulation.regions.filter((region) => (
        region.initialControllerId === polity.id && region.port
      ));
      expect(ports.length).toBeGreaterThanOrEqual(2);
      expect(ports.every((region) => profile.simulation.portLinks.some((link) => link.regionId === region.id))).toBe(true);
    }
  });

  it('creates and advances the contest world deterministically without invariant violations', () => {
    const left = advanceWorldBy(createWorld('云海八荒-内容门', 'contest-v01'), 4);
    const right = advanceWorldBy(createWorld('云海八荒-内容门', 'contest-v01'), 4);
    expect(left.mapContentVersion).toBe('contest-v01-68');
    expect(left.regions).toHaveLength(68);
    expect(left.seaZones).toHaveLength(10);
    expect(left.polities).toHaveLength(8);
    expect(validateWorld(left)).toEqual([]);
    expect(serializeWorld(left)).toBe(serializeWorld(right));
  });
});

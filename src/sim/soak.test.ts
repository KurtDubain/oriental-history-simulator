import { expect, it } from 'vitest';

import { advanceWorld, createWorld, validateWorld } from './index';

it('keeps a held-out V0.3 seed set coherent for twenty years', () => {
  const distribution: Array<Record<string, number | string | boolean>> = [];
  for (const seed of ['北辰', '潮生', '孤城', '秋水']) {
    let world = createWorld(seed);
    let minimumLiving = world.polities.filter((polity) => polity.alive).length;
    let maximumLiving = minimumLiving;
    let tradeShipments = 0;
    let seaShipments = 0;
    for (let turn = 0; turn < 80; turn += 1) {
      world = advanceWorld(world);
      const living = world.polities.filter((polity) => polity.alive).length;
      minimumLiving = Math.min(minimumLiving, living);
      maximumLiving = Math.max(maximumLiving, living);
      tradeShipments += world.lastTurn?.trade.shipments.filter((shipment) => shipment.kind === '贸易').length ?? 0;
      seaShipments += world.lastTurn?.trade.shipments.filter((shipment) => shipment.legs.some((leg) => leg.kind === 'sea-lane')).length ?? 0;
    }
    expect(validateWorld(world), seed).toEqual([]);
    distribution.push({
      seed,
      finalLiving: world.polities.filter((polity) => polity.alive).length,
      minimumLiving,
      maximumLiving,
      unifiedEver: minimumLiving === 1,
      rebellions: world.history.filter((event) => event.kind === 'rebellion').length,
      eliminations: world.history.filter((event) => event.kind === 'polity_eliminated').length,
      tradeShipments,
      seaShipments,
      fleets: world.fleets.length,
      outbreaks: world.history.filter((event) => event.kind === 'outbreak_detected').length,
      practices: world.practiceStates.filter((practice) => practice.prototypeTurn !== null).length,
      hash: world.hash,
    });
  }
  expect(new Set(distribution.map((sample) => sample.hash)).size).toBe(distribution.length);
  expect(distribution.every((sample) => Number(sample.tradeShipments) > 0)).toBe(true);
  expect(distribution.every((sample) => Number(sample.seaShipments) > 0)).toBe(true);
  expect(distribution.every((sample) => Number(sample.fleets) > 0)).toBe(true);
  expect(distribution.every((sample) => Number(sample.rebellions) <= 16)).toBe(true);
}, 45_000);

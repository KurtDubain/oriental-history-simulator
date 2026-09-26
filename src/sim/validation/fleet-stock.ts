import type { FleetState, InvariantViolation } from '../types';

/** Current entities only; this is not a replacement for full archive validation. */
export function validateFleetStocks(fleets: readonly FleetState[]): InvariantViolation[] {
  return fleets.flatMap(fleet => {
    const { warships, transports, patrolShips, sailors, food } = fleet;
    return [warships, transports, patrolShips, sailors, food].every(n => Number.isSafeInteger(n) && n >= 0)
      && sailors > 0 && warships + transports + patrolShips > 0 ? []
      : [{ code: 'fleet.stock', message: `${fleet.name}舰船、水手或军粮无效`, entityId: fleet.id }];
  });
}

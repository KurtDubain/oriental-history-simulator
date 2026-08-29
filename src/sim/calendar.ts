import { SEASONS, type Season } from './types';

/** Maps a quarterly turn boundary to the canonical in-world date. */
export function getDateForTurn(turn: number): { year: number; season: Season } {
  const safeTurn = Math.max(0, Math.floor(turn));
  return {
    year: Math.floor(safeTurn / SEASONS.length) + 1,
    season: SEASONS[safeTurn % SEASONS.length] as Season,
  };
}

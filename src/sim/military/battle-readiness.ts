interface WoundFact {
  kind: 'character_wounded';
  turn: number;
  payload: { characterId: string; recoveryUntilTurn?: number };
}

export function battleRecoveryStatus(
  world: { facts: readonly unknown[]; turn: number },
  characterId: string,
  turn = world.turn,
): { recovering: boolean; untilTurn: number | null } {
  let fact: WoundFact | undefined;
  for (let index = world.facts.length - 1; index >= 0; index -= 1) {
    const candidate = world.facts[index] as WoundFact;
    if (candidate.kind === 'character_wounded' && candidate.payload.characterId === characterId) {
      fact = candidate;
      break;
    }
  }
  if (!fact) return { recovering: false, untilTurn: null };
  const untilTurn = fact.payload.recoveryUntilTurn ?? fact.turn + 2;
  return { recovering: turn < untilTurn, untilTurn };
}

export function isBattleReadyCharacter(
  world: { facts: readonly unknown[]; turn: number },
  character: { id: string; health: number },
): boolean {
  return character.health >= 55 && !battleRecoveryStatus(world, character.id).recovering;
}

export function commandHealthFactor(health: number): number {
  return Math.max(.62, Math.min(1, .55 + health / 220));
}

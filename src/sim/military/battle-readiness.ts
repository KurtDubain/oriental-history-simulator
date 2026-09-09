interface WoundFact {
  kind: 'character_wounded';
  turn: number;
  payload: { characterId: string; recoveryUntilTurn?: number };
}

/** Recovery capacity declines continuously; age itself never removes a command. */
export function recoverHealth(age: number, health: number, gain: number): number {
  const capacity = Math.max(35, 100 - 25 * Math.pow(Math.max(0, age) / 90, 4));
  const restored = health + Math.max(1, Math.round(gain / (1 + Math.pow(Math.max(0, age) / 80, 3))));
  return Math.round(Math.max(0, Math.min(100, restored, Math.max(capacity, health - 1))));
}

export function woundRecoveryQuarters(age: number, severity: number, health: number, variation: number): number {
  return Math.max(1, Math.ceil(.4 + severity * 4.2 + variation * 3.2
    + Math.pow(Math.max(0, age) / 70, 3) * (.8 + severity + (100 - health) / 100)));
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

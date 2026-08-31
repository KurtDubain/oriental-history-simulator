const UINT32_RANGE = 0x1_0000_0000;

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function keyedValue(seed: string, keys: readonly (string | number)[]): number {
  return hashString([seed, ...keys.map(String)].join('\u241f'));
}

export function keyedRandom(seed: string, ...keys: readonly (string | number)[]): number {
  return keyedValue(seed, keys) / UINT32_RANGE;
}

export function keyedInt(
  seed: string,
  minInclusive: number,
  maxInclusive: number,
  ...keys: readonly (string | number)[]
): number {
  if (maxInclusive < minInclusive) {
    throw new Error(`Invalid keyedInt range: ${minInclusive}..${maxInclusive}`);
  }
  const span = maxInclusive - minInclusive + 1;
  return minInclusive + Math.floor(keyedRandom(seed, ...keys) * span);
}

export function keyedChance(
  seed: string,
  probability: number,
  ...keys: readonly (string | number)[]
): boolean {
  return keyedRandom(seed, ...keys) < Math.max(0, Math.min(1, probability));
}

export function keyedPick<T>(
  seed: string,
  values: readonly T[],
  ...keys: readonly (string | number)[]
): T {
  if (values.length === 0) {
    throw new Error('Cannot pick from an empty collection');
  }
  return values[keyedInt(seed, 0, values.length - 1, ...keys)] as T;
}

export function stableCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort(stableCompare);
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

export function stableHash(value: unknown): string {
  return stableHashCanonical(stableStringify(value));
}

/** Hashes text that has already been produced by stableStringify. */
export function stableHashCanonical(canonical: string): string {
  const first = hashString(canonical).toString(16).padStart(8, '0');
  const second = hashString(`history-war\u241f${canonical}`).toString(16).padStart(8, '0');
  return `${first}${second}`;
}

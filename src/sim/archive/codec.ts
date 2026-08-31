import { Unzlib, strFromU8, strToU8, zlibSync } from 'fflate';

import { stableHash, stableHashCanonical, stableStringify } from '../random';
import type { SimulationFact } from '../facts';
import type { HistoryEvent } from '../types';
import type { WorldArchiveBlock, WorldArchiveBlockPayload } from './types';
import {
  MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES,
  MAX_ARCHIVE_BLOCK_RAW_BYTES,
  WORLD_ARCHIVE_ENCODING,
} from './types';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE_CACHE_LIMIT = 4;

const lruDecodeCache = new Map<string, WorldArchiveBlockPayload>();
interface BlockKeySnapshot {
  encoding: string;
  payloadDigest: string;
  compressedDigest: string;
  payloadRawBytes: number;
  payloadCompressedBytes: number;
  payloadBase64: string;
  key: string;
}
let blockKeyCache = new WeakMap<WorldArchiveBlock, BlockKeySnapshot>();

function cacheKey(block: WorldArchiveBlock): string {
  const cached = blockKeyCache.get(block);
  if (cached
    && cached.encoding === block.encoding
    && cached.payloadDigest === block.payloadDigest
    && cached.compressedDigest === block.compressedDigest
    && cached.payloadRawBytes === block.payloadRawBytes
    && cached.payloadCompressedBytes === block.payloadCompressedBytes
    && cached.payloadBase64 === block.payloadBase64) return cached.key;
  const key = [
    block.encoding,
    block.payloadDigest,
    block.compressedDigest,
    block.payloadRawBytes,
    block.payloadCompressedBytes,
    block.payloadBase64.length,
    stableHash(block.payloadBase64),
  ].join(':');
  blockKeyCache.set(block, {
    encoding: block.encoding,
    payloadDigest: block.payloadDigest,
    compressedDigest: block.compressedDigest,
    payloadRawBytes: block.payloadRawBytes,
    payloadCompressedBytes: block.payloadCompressedBytes,
    payloadBase64: block.payloadBase64,
    key,
  });
  return key;
}

function assertEncodedSizeHeader(block: WorldArchiveBlock): void {
  if (!Number.isSafeInteger(block.payloadCompressedBytes)
    || block.payloadCompressedBytes <= 0
    || block.payloadCompressedBytes > MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES) {
    throw new Error(`archive compressed payload exceeds ${MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES} bytes`);
  }
  if (!Number.isSafeInteger(block.payloadRawBytes)
    || block.payloadRawBytes <= 0
    || block.payloadRawBytes > MAX_ARCHIVE_BLOCK_RAW_BYTES) {
    throw new Error(`archive raw payload exceeds ${MAX_ARCHIVE_BLOCK_RAW_BYTES} bytes`);
  }
  const expectedBase64Length = Math.ceil(block.payloadCompressedBytes / 3) * 4;
  if (block.payloadBase64.length !== expectedBase64Length) {
    throw new Error('archive base64 length does not match its compressed byte count');
  }
}

function rememberDecoded(
  key: string,
  payload: WorldArchiveBlockPayload,
): WorldArchiveBlockPayload {
  lruDecodeCache.delete(key);
  lruDecodeCache.set(key, payload);
  while (lruDecodeCache.size > DECODE_CACHE_LIMIT) {
    const oldest = lruDecodeCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    lruDecodeCache.delete(oldest);
  }
  return payload;
}

function encodeBase64Fallback(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const packed = (first << 16) | (second << 8) | third;
    result += BASE64_ALPHABET[(packed >>> 18) & 63];
    result += BASE64_ALPHABET[(packed >>> 12) & 63];
    result += index + 1 < bytes.length ? BASE64_ALPHABET[(packed >>> 6) & 63] : '=';
    result += index + 2 < bytes.length ? BASE64_ALPHABET[packed & 63] : '=';
  }
  return result;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(strFromU8(bytes, true));
  return encodeBase64Fallback(bytes);
}

function decodedBase64Length(encoded: string): number {
  if (encoded.length === 0 || encoded.length % 4 !== 0) {
    throw new Error('archive payload is not canonical base64');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('archive payload contains invalid base64 characters');
  }
  const firstPadding = encoded.indexOf('=');
  if (firstPadding >= 0 && firstPadding < encoded.length - 2) {
    throw new Error('archive payload contains misplaced base64 padding');
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

function decodeBase64(encoded: string, maximumBytes: number): Uint8Array {
  const outputLength = decodedBase64Length(encoded);
  if (outputLength > maximumBytes) {
    throw new Error(`archive compressed payload exceeds ${maximumBytes} bytes`);
  }
  if (typeof globalThis.atob === 'function') {
    const output = strToU8(globalThis.atob(encoded), true);
    if (output.byteLength !== outputLength || encodeBase64(output) !== encoded) {
      throw new Error('archive payload is not canonical base64');
    }
    return output;
  }
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;
  for (let index = 0; index < encoded.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(encoded[index] as string);
    const second = BASE64_ALPHABET.indexOf(encoded[index + 1] as string);
    const thirdCharacter = encoded[index + 2] as string;
    const fourthCharacter = encoded[index + 3] as string;
    const third = thirdCharacter === '=' ? 0 : BASE64_ALPHABET.indexOf(thirdCharacter);
    const fourth = fourthCharacter === '=' ? 0 : BASE64_ALPHABET.indexOf(fourthCharacter);
    const packed = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < outputLength) output[outputIndex++] = (packed >>> 16) & 255;
    if (outputIndex < outputLength) output[outputIndex++] = (packed >>> 8) & 255;
    if (outputIndex < outputLength) output[outputIndex++] = packed & 255;
  }
  if (encodeBase64(output) !== encoded) {
    throw new Error('archive payload is not canonical base64');
  }
  return output;
}

function inflateBounded(compressed: Uint8Array, declaredRawBytes: number): Uint8Array {
  if (!Number.isSafeInteger(declaredRawBytes)
    || declaredRawBytes < 0
    || declaredRawBytes > MAX_ARCHIVE_BLOCK_RAW_BYTES) {
    throw new Error(`archive raw payload exceeds ${MAX_ARCHIVE_BLOCK_RAW_BYTES} bytes`);
  }
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  const decoder = new Unzlib((chunk) => {
    byteCount += chunk.byteLength;
    if (byteCount > MAX_ARCHIVE_BLOCK_RAW_BYTES || byteCount > declaredRawBytes) {
      throw new Error('archive raw payload exceeds its declared byte limit');
    }
    chunks.push(chunk);
  });
  // Feed compressed input incrementally so a tiny forged size header cannot
  // make the inflater materialize an arbitrarily large zlib bomb before our
  // output callback has a chance to enforce the declared/raw hard limits.
  const compressedChunkBytes = 4 * 1024;
  for (let offset = 0; offset < compressed.byteLength; offset += compressedChunkBytes) {
    const end = Math.min(compressed.byteLength, offset + compressedChunkBytes);
    decoder.push(compressed.subarray(offset, end), end === compressed.byteLength);
  }
  if (byteCount !== declaredRawBytes) {
    throw new Error(`archive raw byte count mismatch: expected ${declaredRawBytes}, received ${byteCount}`);
  }
  const raw = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isArchiveRecord(value: unknown): value is SimulationFact | HistoryEvent {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SimulationFact & HistoryEvent>;
  return typeof record.id === 'string'
    && Number.isSafeInteger(record.turn)
    && Number.isSafeInteger(record.year)
    && typeof record.season === 'string'
    && typeof record.kind === 'string'
    && typeof record.category === 'string'
    && Number.isSafeInteger(record.importance)
    && isStringArray(record.actorIds)
    && isStringArray(record.polityIds)
    && isStringArray(record.regionIds)
    && Array.isArray(record.causes)
    && Array.isArray(record.stateDeltas)
    && isStringArray(record.sourceFactIds);
}

function isArchivePayload(value: unknown): value is WorldArchiveBlockPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<WorldArchiveBlockPayload>;
  return Array.isArray(payload.facts)
    && payload.facts.every(isArchiveRecord)
    && Array.isArray(payload.history)
    && payload.history.every(isArchiveRecord);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item, seen);
  return Object.freeze(value);
}

export interface EncodedArchivePayload {
  encoding: typeof WORLD_ARCHIVE_ENCODING;
  payloadDigest: string;
  compressedDigest: string;
  payloadRawBytes: number;
  payloadCompressedBytes: number;
  payloadBase64: string;
}

export function encodeArchivePayload(payload: WorldArchiveBlockPayload): EncodedArchivePayload {
  const canonical = stableStringify(payload);
  const raw = strToU8(canonical);
  if (raw.byteLength > MAX_ARCHIVE_BLOCK_RAW_BYTES) {
    throw new Error(`archive raw payload exceeds ${MAX_ARCHIVE_BLOCK_RAW_BYTES} bytes`);
  }
  const compressed = zlibSync(raw, { level: 9 });
  if (compressed.byteLength > MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES) {
    throw new Error(`archive compressed payload exceeds ${MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES} bytes`);
  }
  const payloadBase64 = encodeBase64(compressed);
  return {
    encoding: WORLD_ARCHIVE_ENCODING,
    payloadDigest: stableHashCanonical(canonical),
    compressedDigest: stableHash(payloadBase64),
    payloadRawBytes: raw.byteLength,
    payloadCompressedBytes: compressed.byteLength,
    payloadBase64,
  };
}

export function decodeArchiveBlock(block: WorldArchiveBlock): WorldArchiveBlockPayload {
  assertEncodedSizeHeader(block);
  const key = cacheKey(block);
  const lru = lruDecodeCache.get(key);
  if (lru) return rememberDecoded(key, lru);

  if (block.encoding !== WORLD_ARCHIVE_ENCODING) {
    throw new Error(`unsupported archive encoding ${String(block.encoding)}`);
  }
  const compressed = decodeBase64(block.payloadBase64, MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES);
  if (compressed.byteLength !== block.payloadCompressedBytes) {
    throw new Error(
      `archive compressed byte count mismatch: expected ${block.payloadCompressedBytes}, received ${compressed.byteLength}`,
    );
  }
  if (stableHash(block.payloadBase64) !== block.compressedDigest) {
    throw new Error('archive compressed payload digest mismatch');
  }
  const raw = inflateBounded(compressed, block.payloadRawBytes);
  let parsed: unknown;
  const json = strFromU8(raw);
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('archive payload is not valid JSON');
  }
  if (!isArchivePayload(parsed)) throw new Error('archive payload is missing facts or history');
  const canonical = stableStringify(parsed);
  if (canonical !== json) throw new Error('archive payload is not canonical stable JSON');
  if (stableHashCanonical(json) !== block.payloadDigest) throw new Error('archive payload digest mismatch');
  return rememberDecoded(key, deepFreeze(parsed));
}

export function clearWorldArchiveDecodeCache(): void {
  blockKeyCache = new WeakMap<WorldArchiveBlock, BlockKeySnapshot>();
  lruDecodeCache.clear();
}

export function archiveDecodeCacheEntryCount(): number {
  return lruDecodeCache.size;
}

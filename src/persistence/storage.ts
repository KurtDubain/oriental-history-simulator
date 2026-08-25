// Keep the original database and store names so installed V0.1 autosaves remain discoverable.
const DATABASE_NAME = 'canghai-history-v01';
const STORE_NAME = 'world-saves';
const DATABASE_VERSION = 1;

export const AUTOSAVE_SLOT = 'autosave';
export const MAX_WORLD_SLOTS = 24;
export const MAX_SLOT_LENGTH = 64;
export const MAX_LABEL_LENGTH = 80;
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

const NAMED_SLOT_KEY_PREFIX = 'v1:world:';
const SLOT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

export type SaveEngineVersion = '0.1.0' | '0.2.0' | '0.3.0' | '1.0.0';

export interface SaveEnvelope {
  schemaVersion: 1;
  savedAt: string;
  engineVersion: SaveEngineVersion;
  payload: string;
  label?: string;
}

export interface WorldSaveSummary {
  /** Public slot id. The IndexedDB key prefix is deliberately not exposed to callers. */
  slot: string;
  label: string;
  isAutosave: boolean;
  status: 'ready' | 'corrupt';
  savedAt: string | null;
  engineVersion: SaveEngineVersion | null;
  seed: string | null;
  year: number | null;
  season: string | null;
  turn: number | null;
  hash: string | null;
  payloadBytes: number;
  error: string | null;
}

interface WorldSummaryFields {
  seed: string;
  year: number;
  season: string;
  turn: number;
  hash: string;
}

function payloadByteLength(payload: string): number {
  return new TextEncoder().encode(payload).byteLength;
}

function assertPayloadWithinLimit(payload: string): void {
  if (payloadByteLength(payload) > MAX_IMPORT_BYTES) {
    throw new Error('V1 世界存档不能超过 16MB。');
  }
}

function isEngineVersion(value: unknown): value is SaveEngineVersion {
  return value === '0.1.0' || value === '0.2.0' || value === '0.3.0' || value === '1.0.0';
}

function envelopeFromUnknown(value: unknown): SaveEnvelope {
  if (
    typeof value !== 'object'
    || value === null
    || !('schemaVersion' in value)
    || value.schemaVersion !== 1
    || !('payload' in value)
    || typeof value.payload !== 'string'
  ) {
    throw new Error('本地史册外层格式无法识别；V1 仍兼容 V0.1/V0.2/V0.3 存档。');
  }

  // V0.1 fixtures did not require these two fields. Keep that envelope readable,
  // but normalize it before handing it to V1 callers.
  const savedAt = 'savedAt' in value && typeof value.savedAt === 'string'
    ? value.savedAt
    : new Date(0).toISOString();
  const engineVersion = 'engineVersion' in value && isEngineVersion(value.engineVersion)
    ? value.engineVersion
    : '0.1.0';
  const label = 'label' in value && typeof value.label === 'string'
    ? normalizeWorldSaveLabel(value.label)
    : undefined;

  return {
    schemaVersion: 1,
    savedAt,
    engineVersion,
    payload: value.payload,
    ...(label ? { label } : {}),
  };
}

function worldFieldsFromPayload(payload: string): WorldSummaryFields {
  const parsed: unknown = JSON.parse(payload);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('世界正文不是对象。');
  }

  const seed = 'seed' in parsed ? parsed.seed : null;
  const year = 'year' in parsed ? parsed.year : null;
  const season = 'season' in parsed ? parsed.season : null;
  const turn = 'turn' in parsed ? parsed.turn : null;
  const hash = 'hash' in parsed ? parsed.hash : null;
  if (
    typeof seed !== 'string'
    || seed.length === 0
    || typeof year !== 'number'
    || !Number.isSafeInteger(year)
    || year < 1
    || typeof season !== 'string'
    || season.length === 0
    || typeof turn !== 'number'
    || !Number.isSafeInteger(turn)
    || turn < 0
    || typeof hash !== 'string'
    || hash.length === 0
  ) {
    throw new Error('世界正文缺少种子、纪年、季度或哈希。');
  }
  return { seed, year, season, turn, hash };
}

/**
 * Validate a public named-slot id. Labels may contain Chinese text; slot ids stay
 * deliberately machine-like so they can never collide with future metadata keys.
 */
export function normalizeWorldSlot(slot: string): string {
  if (typeof slot !== 'string') throw new Error('世界槽位必须是字符串。');
  const normalized = slot.trim();
  if (normalized === AUTOSAVE_SLOT) throw new Error('“autosave”是自动续写专用槽位。');
  if (normalized.length === 0 || normalized.length > MAX_SLOT_LENGTH || !SLOT_PATTERN.test(normalized)) {
    throw new Error(`世界槽位只能使用字母、数字、下划线或连字符，且不超过 ${MAX_SLOT_LENGTH} 个字符。`);
  }
  return normalized;
}

export function normalizeWorldSaveLabel(label: string): string {
  if (typeof label !== 'string') throw new Error('世界名称必须是字符串。');
  const normalized = label.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) throw new Error('世界名称不能为空。');
  if (normalized.length > MAX_LABEL_LENGTH) {
    throw new Error(`世界名称不能超过 ${MAX_LABEL_LENGTH} 个字符。`);
  }
  return normalized;
}

export function createSaveEnvelope(
  payload: string,
  label?: string,
  savedAt = new Date().toISOString(),
): SaveEnvelope {
  assertPayloadWithinLimit(payload);
  // A named save should never create a slot that listWorldSaves immediately
  // has to report as corrupt.
  worldFieldsFromPayload(payload);
  const normalizedLabel = label === undefined ? undefined : normalizeWorldSaveLabel(label);
  return {
    schemaVersion: 1,
    savedAt,
    engineVersion: '1.0.0',
    payload,
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
  };
}

/** A non-throwing boundary used by the collection UI so one damaged slot cannot hide the others. */
export function summarizeWorldSave(
  slot: string,
  value: unknown,
  isAutosave = slot === AUTOSAVE_SLOT,
): WorldSaveSummary {
  const fallbackLabel = isAutosave ? '自动续写' : slot;
  try {
    const envelope = envelopeFromUnknown(value);
    const fields = worldFieldsFromPayload(envelope.payload);
    return {
      slot,
      label: envelope.label ?? (isAutosave ? fallbackLabel : fields.seed),
      isAutosave,
      status: 'ready',
      savedAt: envelope.savedAt,
      engineVersion: envelope.engineVersion,
      ...fields,
      payloadBytes: payloadByteLength(envelope.payload),
      error: null,
    };
  } catch (error) {
    return {
      slot,
      label: fallbackLabel,
      isAutosave,
      status: 'corrupt',
      savedAt: null,
      engineVersion: null,
      seed: null,
      year: null,
      season: null,
      turn: null,
      hash: null,
      payloadBytes: 0,
      error: error instanceof Error ? error.message : '未知存档错误。',
    };
  }
}

export function encodeWorldFile(payload: string): string {
  assertPayloadWithinLimit(payload);
  return JSON.stringify({
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    engineVersion: '1.0.0',
    world: JSON.parse(payload) as unknown,
  });
}

function namedSlotStorageKey(slot: string): string {
  return `${NAMED_SLOT_KEY_PREFIX}${normalizeWorldSlot(slot)}`;
}

function storageKeyForSlot(slot: string): string {
  return slot === AUTOSAVE_SLOT ? AUTOSAVE_SLOT : namedSlotStorageKey(slot);
}

function slotFromStorageKey(key: IDBValidKey): { slot: string; isAutosave: boolean } | null {
  if (key === AUTOSAVE_SLOT) return { slot: AUTOSAVE_SLOT, isAutosave: true };
  if (typeof key !== 'string' || !key.startsWith(NAMED_SLOT_KEY_PREFIX)) return null;
  const slot = key.slice(NAMED_SLOT_KEY_PREFIX.length);
  return slot.length > 0 ? { slot, isAutosave: false } : null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地史册。'));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = callback(transaction.objectStore(STORE_NAME));
      let result: T | undefined;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error('本地史册读写失败。'));
      transaction.onerror = () => reject(transaction.error ?? new Error('本地史册事务失败。'));
      transaction.onabort = () => reject(transaction.error ?? new Error('本地史册事务已取消。'));
      transaction.oncomplete = () => resolve(result as T);
    });
  } finally {
    database.close();
  }
}

async function loadEnvelopeAtKey(storageKey: string): Promise<SaveEnvelope | null> {
  const result = await transact<unknown>('readonly', (store) => store.get(storageKey));
  return result === undefined ? null : envelopeFromUnknown(result);
}

async function storageKeyExists(storageKey: string): Promise<boolean> {
  const count = await transact<number>('readonly', (store) => store.count(storageKey));
  return count > 0;
}

async function assertNamedSlotCapacity(targetKey: string): Promise<void> {
  if (await storageKeyExists(targetKey)) return;
  const keys = await transact<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  const namedCount = keys.filter((key) => (
    typeof key === 'string' && key.startsWith(NAMED_SLOT_KEY_PREFIX)
  )).length;
  if (namedCount >= MAX_WORLD_SLOTS) {
    throw new Error(`本机最多收藏 ${MAX_WORLD_SLOTS} 个世界；请先删除一个旧槽位。`);
  }
}

/** Preserve the original autosave API; non-default slot callers are routed to V1 namespaced slots. */
export async function saveWorld(payload: string, slot = AUTOSAVE_SLOT): Promise<SaveEnvelope> {
  if (slot !== AUTOSAVE_SLOT) return saveWorldToSlot(payload, slot);
  const envelope = createSaveEnvelope(payload);
  await transact('readwrite', (store) => store.put(envelope, AUTOSAVE_SLOT));
  return envelope;
}

export async function saveWorldToSlot(payload: string, slot: string, label?: string): Promise<SaveEnvelope> {
  const storageKey = namedSlotStorageKey(slot);
  await assertNamedSlotCapacity(storageKey);
  const envelope = createSaveEnvelope(payload, label);
  await transact('readwrite', (store) => store.put(envelope, storageKey));
  return envelope;
}

export async function loadWorld(slot = AUTOSAVE_SLOT): Promise<SaveEnvelope | null> {
  return loadEnvelopeAtKey(storageKeyForSlot(slot));
}

export async function loadWorldFromSlot(slot: string): Promise<SaveEnvelope | null> {
  return loadEnvelopeAtKey(storageKeyForSlot(slot));
}

export async function deleteWorld(slot = AUTOSAVE_SLOT): Promise<void> {
  await transact('readwrite', (store) => store.delete(storageKeyForSlot(slot)));
}

export async function deleteWorldSlot(slot: string): Promise<void> {
  await deleteWorld(slot);
}

export async function listWorldSaves(): Promise<WorldSaveSummary[]> {
  const keys = await transact<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  const managed = keys.map(slotFromStorageKey).filter((item): item is NonNullable<typeof item> => item !== null);
  const summaries = await Promise.all(managed.map(async ({ slot, isAutosave }) => {
    try {
      const value = await transact<unknown>('readonly', (store) => store.get(storageKeyForSlot(slot)));
      return summarizeWorldSave(slot, value, isAutosave);
    } catch (error) {
      return summarizeWorldSave(slot, {
        schemaVersion: 0,
        readError: error instanceof Error ? error.message : '无法读取槽位。',
      }, isAutosave);
    }
  }));
  return summaries.sort((left, right) => {
    if (left.isAutosave !== right.isAutosave) return left.isAutosave ? -1 : 1;
    return (right.savedAt ?? '').localeCompare(left.savedAt ?? '') || left.slot.localeCompare(right.slot);
  });
}

/** Rename a collection entry's display label without changing its stable slot id or saved date. */
export async function renameWorldSlot(slot: string, label: string): Promise<SaveEnvelope> {
  const normalizedSlot = normalizeWorldSlot(slot);
  const storageKey = namedSlotStorageKey(normalizedSlot);
  const envelope = await loadEnvelopeAtKey(storageKey);
  if (!envelope) throw new Error('找不到要改名的世界槽位。');
  const renamed: SaveEnvelope = { ...envelope, label: normalizeWorldSaveLabel(label) };
  await transact('readwrite', (store) => store.put(renamed, storageKey));
  return renamed;
}

/** Copy a source (including autosave) into a fresh named branch. Existing targets are never overwritten. */
export async function duplicateWorldSlot(
  sourceSlot: string,
  targetSlot: string,
  label?: string,
): Promise<SaveEnvelope> {
  const source = await loadWorldFromSlot(sourceSlot);
  if (!source) throw new Error('找不到要复制的世界槽位。');
  const targetKey = namedSlotStorageKey(targetSlot);
  if (await storageKeyExists(targetKey)) throw new Error('目标世界槽位已经存在。');
  return saveWorldToSlot(source.payload, targetSlot, label ?? source.label);
}

export function downloadWorld(payload: string, filename: string): void {
  const blob = new Blob([encodeWorldFile(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readWorldFile(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('V1 世界存档不能超过 16MB。');
  }
  const raw = await file.text();
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('schemaVersion' in parsed)
    || parsed.schemaVersion !== 1
    || (
      (!('payload' in parsed) || typeof parsed.payload !== 'string')
      && (!('world' in parsed) || typeof parsed.world !== 'object' || parsed.world === null)
    )
  ) {
    throw new Error('这不是有效的 V1 或 V0.1/V0.2/V0.3 世界存档。');
  }
  if ('payload' in parsed && typeof parsed.payload === 'string') {
    assertPayloadWithinLimit(parsed.payload);
    return parsed.payload;
  }
  if ('world' in parsed && typeof parsed.world === 'object' && parsed.world !== null) {
    const payload = JSON.stringify(parsed.world);
    assertPayloadWithinLimit(payload);
    return payload;
  }
  throw new Error('这不是有效的 V1 或 V0.1/V0.2/V0.3 世界存档。');
}

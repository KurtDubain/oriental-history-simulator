export const WORLD_ARCHIVE_VERSION = 1 as const;
export const WORLD_ARCHIVE_CHUNK_TURNS = 16 as const;
export const WORLD_ARCHIVE_HOT_TURNS = 64 as const;
export const WORLD_ARCHIVE_ENCODING = 'stable-json+zlib-9+base64' as const;

/** Hard limits are checked before allocating either compressed or raw payloads. */
export const MAX_ARCHIVE_BLOCK_RAW_BYTES = 8 * 1024 * 1024;
export const MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES = 4 * 1024 * 1024;

export interface ArchiveRecordIndex {
  [key: string]: string[];
}

export interface ArchiveCountIndex {
  [key: string]: number;
}

export interface WorldArchiveBlockIndexes {
  actor: ArchiveRecordIndex;
  polity: ArchiveRecordIndex;
  region: ArchiveRecordIndex;
  kind: ArchiveRecordIndex;
  category: ArchiveRecordIndex;
}

export interface ArchiveTerritoryDelta {
  factId: string;
  turn: number;
  regionId: string;
  previousControllerId: string;
  nextControllerId: string;
  reason: 'battle_capture' | 'rebellion' | 'administrative_transfer' | 'amphibious_landing';
  warId: string | null;
}

export type ArchiveEventCategory =
  | '世界'
  | '人口'
  | '经济'
  | '政治'
  | '军事'
  | '外交'
  | '海洋'
  | '疾病'
  | '知识'
  | '迁徙';

export type ArchiveImportance = 1 | 2 | 3 | 4 | 5;

export type ArchiveCategoryCounts = Partial<Record<ArchiveEventCategory, number>>;

export type ArchiveImportanceCounts = Record<ArchiveImportance, number>;

export interface ArchiveHistoryTurnSummary {
  eventCount: number;
  majorEventCount: number;
  categoryCounts: ArchiveCategoryCounts;
  importanceCounts: ArchiveImportanceCounts;
}

/**
 * Exact, payload-derived Chronicle facets kept outside the compressed body.
 * Related counts deduplicate one entity within one event and include causal
 * evidence refs, so they can safely reject an unrelated block before decode.
 */
export interface ArchiveHistorySummary {
  eventCount: number;
  majorEventCount: number;
  categoryCounts: ArchiveCategoryCounts;
  importanceCounts: ArchiveImportanceCounts;
  relatedCounts: {
    character: ArchiveCountIndex;
    polity: ArchiveCountIndex;
    region: ArchiveCountIndex;
  };
  byTurn: Record<string, ArchiveHistoryTurnSummary>;
}

export interface ArchiveImportantEventPreview {
  eventId: string;
  turn: number;
  category: ArchiveEventCategory;
  kind: string;
  importance: 1 | 2 | 3 | 4 | 5;
  title: string;
  summary: string;
  actorIds: string[];
  polityIds: string[];
  regionIds: string[];
}

/**
 * Authenticated Fact and Chronicle chain tails captured at a completed chunk
 * boundary. Only checkpoints newer than the cold frontier are retained.
 */
export interface ArchiveDigestCheckpoint {
  throughTurn: number;
  factCount: number;
  factDigest: string;
  historyCount: number;
  historyDigest: string;
}

/**
 * A block owns one complete sixteen-turn interval. Payload records remain exact,
 * while the small indexes and previews permit cold-history discovery without a
 * decompression pass.
 */
export interface WorldArchiveBlock {
  version: 1;
  id: string;
  fromTurn: number;
  throughTurn: number;
  factCount: number;
  historyCount: number;
  firstFactId: string | null;
  lastFactId: string | null;
  firstEventId: string | null;
  lastEventId: string | null;
  beforeFactCount: number;
  afterFactCount: number;
  beforeHistoryCount: number;
  afterHistoryCount: number;
  beforeFactDigest: string;
  afterFactDigest: string;
  beforeHistoryDigest: string;
  afterHistoryDigest: string;
  indexes: WorldArchiveBlockIndexes;
  /** Absent only on development saves created before summary metadata existed. */
  historySummary?: ArchiveHistorySummary;
  territoryDeltas: ArchiveTerritoryDelta[];
  importantEventPreviews: ArchiveImportantEventPreview[];
  encoding: typeof WORLD_ARCHIVE_ENCODING;
  payloadDigest: string;
  compressedDigest: string;
  payloadRawBytes: number;
  payloadCompressedBytes: number;
  payloadBase64: string;
}

/**
 * This persistent DTO deliberately has no dependency on the aggregate
 * WorldState type. Keeping that boundary acyclic lets WorldState own the
 * archive state without making the archive implementation part of its type SCC.
 */
export interface WorldArchiveSystemState {
  version: 1;
  chunkTurns: typeof WORLD_ARCHIVE_CHUNK_TURNS;
  hotTurns: typeof WORLD_ARCHIVE_HOT_TURNS;
  archiveStartTurn: number;
  archivedThroughTurn: number;
  factBaseCount: number;
  factBaseDigest: string;
  historyBaseCount: number;
  historyBaseDigest: string;
  archivedFactCount: number;
  archivedHistoryCount: number;
  archivedFactDigest: string;
  archivedHistoryDigest: string;
  /** Cold records duplicated in active arrays because live state still cites them. */
  pinnedFactIds: string[];
  /** Founding and observer-intervention records duplicated in active Chronicle. */
  pinnedEventIds: string[];
  /** Pending chunk tails used to seal a block without re-hashing its records. */
  digestCheckpoints: ArchiveDigestCheckpoint[];
  blocks: WorldArchiveBlock[];
}

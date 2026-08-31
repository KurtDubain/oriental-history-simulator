import type { SimulationFact } from '../facts';
import type { HistoryEvent, WorldState } from '../types';
export {
  MAX_ARCHIVE_BLOCK_COMPRESSED_BYTES,
  MAX_ARCHIVE_BLOCK_RAW_BYTES,
  WORLD_ARCHIVE_CHUNK_TURNS,
  WORLD_ARCHIVE_ENCODING,
  WORLD_ARCHIVE_HOT_TURNS,
  WORLD_ARCHIVE_VERSION,
} from './state-types';
export type {
  ArchiveCategoryCounts,
  ArchiveCountIndex,
  ArchiveDigestCheckpoint,
  ArchiveEventCategory,
  ArchiveHistorySummary,
  ArchiveHistoryTurnSummary,
  ArchiveImportance,
  ArchiveImportanceCounts,
  ArchiveImportantEventPreview,
  ArchiveRecordIndex,
  ArchiveTerritoryDelta,
  WorldArchiveBlock,
  WorldArchiveBlockIndexes,
  WorldArchiveSystemState,
} from './state-types';
import type { WorldArchiveSystemState } from './state-types';

export interface WorldArchiveBlockPayload {
  facts: SimulationFact[];
  history: HistoryEvent[];
}

export type ArchiveWorldState = Omit<WorldState, 'archiveSystem'> & {
  archiveSystem?: WorldArchiveSystemState;
};

export interface ArchiveIntegrityIssue {
  code: string;
  message: string;
  blockId?: string;
  recordId?: string;
}

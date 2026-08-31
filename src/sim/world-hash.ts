import { stableHash } from './random';
import type { WorldState } from './types';

/**
 * Computes the authenticated digest for the authoritative world snapshot.
 *
 * Property order and retention windows are part of the save/replay contract.
 * Keep changes to this function behind the fixed-seed and migration gates.
 */
export function computeWorldHash(world: WorldState): string {
  const schemaVersion = (world as unknown as { schemaVersion: number }).schemaVersion;
  if (schemaVersion === 1) {
    const legacy: Record<string, unknown> = { ...world };
    delete legacy.hash;
    delete legacy.history;
    return stableHash(legacy);
  }
  // Unbounded narrative archives are authenticated by historyDigest and compact
  // per-character biographyDigest. Only current/decision-relevant institutional
  // records enter the quarterly snapshot hash, preventing an O(history) tick.
  const legacyCharacters = world.characters.map((character) => {
    const { biography: _biography, ...authoritativeCharacter } = character;
    void _biography;
    return authoritativeCharacter;
  });
  const v02Snapshot = {
    schemaVersion: world.schemaVersion,
    seed: world.seed,
    turn: world.turn,
    year: world.year,
    season: world.season,
    regions: world.regions,
    routes: world.routes,
    polities: world.polities,
    characters: legacyCharacters,
    armies: world.armies,
    wars: world.wars.filter((war) => war.active),
    families: world.families,
    relationships: world.relationships,
    factions: world.factions.filter((faction) => faction.active),
    diplomacy: world.diplomacy,
    offices: world.offices.filter((office) => office.active),
    backgroundPeople: world.backgroundPeople,
    commitments: world.commitments.filter((commitment) => (
      commitment.status === '生效'
      || (commitment.resolvedTurn !== null && world.turn - commitment.resolvedTurn < 16)
    )),
    historyDigest: world.historyDigest,
    lastTurn: world.lastTurn,
    counters: world.counters,
  };
  if (schemaVersion === 2) return stableHash(v02Snapshot);
  const v03Snapshot = {
    ...v02Snapshot,
    mapContentVersion: world.mapContentVersion,
    seaZones: world.seaZones,
    seaLanes: world.seaLanes,
    portLinks: world.portLinks,
    ports: world.ports,
    fleets: world.fleets,
    tradeCorridors: world.tradeCorridors.filter((corridor) => corridor.active || world.turn - corridor.lastActiveTurn < 8),
    navalOperations: world.navalOperations.filter((operation) => operation.completedTurn === null || world.turn - operation.completedTurn < 8),
    shipbuildingProjects: world.shipbuildingProjects.filter((project) => project.status === '建造中' || (project.completedTurn !== null && world.turn - project.completedTurn < 8)),
    pathogens: world.pathogens,
    infections: world.infections,
    practices: world.practices,
    practiceStates: world.practiceStates,
  };
  if (schemaVersion === 3) return stableHash(v03Snapshot);

  // Chronicle prose is a projection in schema 4. Facts and current state are
  // authoritative; changing a display threshold must not alter simulation.
  const characters = world.characters.map((character) => {
    const {
      biography: _biography,
      biographyDigest: _biographyDigest,
      ...authoritativeCharacter
    } = character;
    void _biography;
    void _biographyDigest;
    return authoritativeCharacter;
  });
  const counters = { ...world.counters, event: 0 };
  const lastTurn = world.lastTurn
    ? { ...world.lastTurn, eventIds: [] }
    : null;
  const {
    historyDigest: _historyDigest,
    characters: _legacyCharacterSnapshot,
    counters: _legacyCounters,
    lastTurn: _legacyLastTurn,
    ...schema4Base
  } = v03Snapshot;
  void _historyDigest;
  void _legacyCharacterSnapshot;
  void _legacyCounters;
  void _legacyLastTurn;
  const hasSituationSystem = Object.prototype.hasOwnProperty.call(world, 'situationSystem');
  const hasAgencySystem = Object.prototype.hasOwnProperty.call(world, 'agencySystem');
  const hasAgencyDecisionSystem = Object.prototype.hasOwnProperty.call(world, 'agencyDecisionSystem');
  // `null` is the modern default and carries no authority, so omit it just as
  // pre-POL02 schema-4 snapshots did. A migrated numeric boundary is retained
  // and authenticated on every subsequent save.
  const hasLegacyFactionFactBoundary = Number.isSafeInteger(world.legacyFactionFactBoundaryTurn);
  return stableHash({
    ...schema4Base,
    characters,
    counters,
    lastTurn,
    factDigest: world.factDigest,
    legacyArchiveBoundary: world.legacyArchiveBoundary,
    ...(hasLegacyFactionFactBoundary
      ? { legacyFactionFactBoundaryTurn: world.legacyFactionFactBoundaryTurn }
      : {}),
    ...(hasSituationSystem ? { situationSystem: world.situationSystem } : {}),
    ...(hasAgencySystem ? { agencySystem: world.agencySystem } : {}),
    ...(hasAgencyDecisionSystem ? { agencyDecisionSystem: world.agencyDecisionSystem } : {}),
  });
}

export const SIMULATION_SYSTEM_PHASES = [
  'environment',
  'economy_trade',
  'migration',
  'character_lifecycle',
  'society',
  'core_politics',
  'social_politics',
  'rebellions',
  'army_maintenance',
  'social_diplomacy',
  'war_declarations',
  'diplomacy',
  'military',
  'maritime',
  'disease',
  'knowledge',
  'military_careers',
  'appointments',
  'situations',
  'personal_memory',
  'quarter_finalize',
] as const;

export type SimulationSystemPhase = (typeof SIMULATION_SYSTEM_PHASES)[number];

export interface SimulationAdvanceTimings {
  cloneMs: number;
  systemsMs: number;
  hashMs: number;
  totalMs: number;
  systems: Record<SimulationSystemPhase, number>;
}

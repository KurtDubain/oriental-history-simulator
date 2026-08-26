import type {
  EventCategory,
  EventCause,
  OfficeKind,
  Season,
  StateDelta,
} from '../types';

export type SimulationFactKind =
  | 'war_started'
  | 'war_ended'
  | 'battle'
  | 'territory_control_changed'
  | 'appointment_started'
  | 'appointment_ended'
  | 'character_death'
  | 'marriage'
  | 'situation_milestone';

export interface BattleForceFact {
  armyId: string;
  polityId: string;
  commanderId: string;
  deputyCommanderId: string | null;
  soldiersBefore: number;
  soldiersAfter: number;
  moraleBefore: number;
  moraleAfter: number;
  trainingBefore: number;
  supplyBefore: number;
  losses: number;
}

export interface WarStartedFactPayload {
  warId: string;
  warKind: 'interstate' | 'rebellion';
  attackerId: string;
  defenderId: string;
  goal: '征服' | '边境' | '独立' | '复仇' | '霸权';
  targetRegionIds: string[];
  reason: string;
}

export type WarEndResult =
  | 'attacker_advantage'
  | 'defender_advantage'
  | 'negotiated_peace'
  | 'attacker_destroyed'
  | 'defender_destroyed'
  | 'attacker_dissolved'
  | 'defender_dissolved';

export interface WarEndedFactPayload {
  warId: string;
  attackerId: string;
  defenderId: string;
  result: WarEndResult;
  winnerId: string | null;
  loserId: string | null;
  reason: string;
  durationTurns: number;
  attackerScore: number;
  defenderScore: number;
  indemnity: number;
}

export interface BattleFactPayload {
  warId: string;
  targetRegionId: string;
  routeId: string;
  attackerWon: boolean;
  attackerPower: number;
  defenderPower: number;
  militiaLosses: number;
  attacker: BattleForceFact;
  defenders: BattleForceFact[];
}

export interface TerritoryControlFactPayload {
  regionId: string;
  previousControllerId: string;
  nextControllerId: string;
  reason: 'battle_capture' | 'rebellion' | 'administrative_transfer' | 'amphibious_landing';
  warId: string | null;
}

export interface AppointmentFactPayload {
  appointmentId: string;
  action: 'started' | 'ended';
  officeKind: OfficeKind;
  holderId: string;
  polityId: string;
  regionId: string | null;
  armyId: string | null;
  fleetId: string | null;
  rank: number;
}

export interface CharacterDeathFactPayload {
  characterId: string;
  age: number;
  role: string;
  health: number;
  diseaseId: string | null;
}

export interface MarriageFactPayload {
  leftCharacterId: string;
  rightCharacterId: string;
  leftFamilyId: string;
  rightFamilyId: string;
  diplomatic: boolean;
}

export interface SituationMilestoneFactPayload {
  situationId: string;
  situationType: string;
  transition: 'formed' | 'phase_changed' | 'resolved';
  fromPhase: 'emerging' | 'active' | 'critical' | null;
  toPhase: 'emerging' | 'active' | 'critical' | null;
  tension: number;
  momentum: number;
  outcomeKey: string | null;
}

interface SimulationFactBase<K extends SimulationFactKind, P> {
  id: string;
  turn: number;
  year: number;
  season: Season;
  kind: K;
  category: EventCategory;
  importance: 1 | 2 | 3 | 4 | 5;
  actorIds: string[];
  polityIds: string[];
  regionIds: string[];
  causes: EventCause[];
  stateDeltas: StateDelta[];
  sourceFactIds: string[];
  payload: P;
}

export type BattleFact = SimulationFactBase<'battle', BattleFactPayload>;
export type WarStartedFact = SimulationFactBase<'war_started', WarStartedFactPayload>;
export type WarEndedFact = SimulationFactBase<'war_ended', WarEndedFactPayload>;
export type TerritoryControlFact = SimulationFactBase<'territory_control_changed', TerritoryControlFactPayload>;
export type AppointmentStartedFact = SimulationFactBase<'appointment_started', AppointmentFactPayload>;
export type AppointmentEndedFact = SimulationFactBase<'appointment_ended', AppointmentFactPayload>;
export type CharacterDeathFact = SimulationFactBase<'character_death', CharacterDeathFactPayload>;
export type MarriageFact = SimulationFactBase<'marriage', MarriageFactPayload>;
export type SituationMilestoneFact = SimulationFactBase<'situation_milestone', SituationMilestoneFactPayload>;

export type SimulationFact =
  | WarStartedFact
  | WarEndedFact
  | BattleFact
  | TerritoryControlFact
  | AppointmentStartedFact
  | AppointmentEndedFact
  | CharacterDeathFact
  | MarriageFact
  | SituationMilestoneFact;

export type SimulationFactInput = SimulationFact extends infer Fact
  ? Fact extends SimulationFact
    ? Omit<Fact, 'id' | 'turn' | 'year' | 'season'>
    : never
  : never;

export interface LegacyArchiveBoundary {
  sourceSchemaVersion: 1 | 2 | 3;
  turn: number;
  historyEventCount: number;
  historyDigest: string;
}

import type {
  CommodityKind,
  EventCause,
  HistoryEvent,
  Season,
  StateDelta,
  TurnReport,
} from './types';

export interface V03TurnContext {
  turn: number;
  year: number;
  season: Season;
  events: HistoryEvent[];
  population: TurnReport['population'];
  food: TurnReport['food'];
  wealth: TurnReport['wealth'];
  logistics: TurnReport['logistics'];
  trade: TurnReport['trade'];
  migration: TurnReport['migration'];
  health: TurnReport['health'];
  knowledge: TurnReport['knowledge'];
  maritime: TurnReport['maritime'];
  routeCapacityReserved: Record<string, number>;
  seaCapacityReserved: Record<string, number>;
  commodityStart: Partial<Record<CommodityKind, number>>;
}

export interface V03EventInput {
  category: HistoryEvent['category'];
  kind: string;
  title: string;
  summary: string;
  importance: HistoryEvent['importance'];
  actorIds?: string[];
  polityIds?: string[];
  regionIds?: string[];
  causes: EventCause[];
  evidence?: string[];
  stateDeltas?: StateDelta[];
}

export type V03Emit = (input: V03EventInput) => HistoryEvent;

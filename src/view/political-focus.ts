import { findWorldFact } from '../sim/archive';
import { getDateForTurn } from '../sim/calendar';
import { calculateFactionPowerLedger } from '../sim/politics/power-ledger';
import type { SituationState } from '../sim/situations';
import type {
  CharacterState,
  FamilyState,
  FactionState,
  HistoryEvent,
  SimulationFact,
  WorldState,
} from '../sim/types';

export interface PoliticalFocusLink {
  readonly polityId: string;
  readonly polityName: string;
  readonly factionId: string;
  readonly factionName: string;
  readonly active: boolean;
  readonly detail: string;
}

type PoliticalFocusLabelWorld = Pick<WorldState, 'factions' | 'polities'>;

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inactiveDetail(faction: FactionState, polityName: string, polityAlive: boolean): string {
  if (!polityAlive) return `${polityName}已亡，此派只留于旧史`;
  if (faction.endedTurn === null) return '此派已退出当下朝局，本处只留史迹';
  const date = getDateForTurn(faction.endedTurn);
  return `此派已于第${date.year}年${date.season}退出当下朝局，本处只留史迹`;
}

function toPoliticalFocusLink(
  world: PoliticalFocusLabelWorld,
  factionId: string,
  detail: string,
): PoliticalFocusLink | null {
  const faction = world.factions.find((item) => item.id === factionId);
  if (!faction) return null;
  const owner = world.polities.find((item) => item.id === faction.polityId);
  if (!owner) return null;
  const active = faction.active && owner.alive;
  return {
    polityId: owner.id,
    polityName: owner.name,
    factionId: faction.id,
    factionName: faction.name,
    active,
    detail: active ? detail : `${detail}；${inactiveDetail(faction, owner.name, owner.alive)}`,
  };
}

function politicalFocusLinks(
  world: PoliticalFocusLabelWorld,
  evidenceByFactionId: ReadonlyMap<string, ReadonlySet<string>>,
): PoliticalFocusLink[] {
  return [...evidenceByFactionId.entries()]
    .flatMap(([factionId, details]) => {
      const detail = [...details].join('；');
      const link = toPoliticalFocusLink(world, factionId, detail);
      return link ? [link] : [];
    })
    .sort((left, right) => (
      Number(right.active) - Number(left.active)
      || stableCompare(left.polityId, right.polityId)
      || stableCompare(left.factionId, right.factionId)
    ));
}

function oneFactionEvidence(factionId: string, detail: string): Map<string, Set<string>> {
  return new Map([[factionId, new Set([detail])]]);
}

/**
 * Resolves a person's current, explicit faction identity. Names, roles and
 * biography prose are deliberately not considered affiliation evidence.
 */
export function projectPersonPoliticalFocus(
  world: WorldState,
  person: CharacterState,
): readonly PoliticalFocusLink[] {
  if (!person.factionId) return [];
  const faction = world.factions.find((item) => item.id === person.factionId);
  if (!faction || faction.polityId !== person.polityId) return [];
  const membership = faction.memberIds.includes(person.id);
  const detail = faction.leaderId === person.id
    ? `${person.name}正领此派，派中名册亦有载`
    : membership
      ? `${person.name}列名此派成员册`
      : `${person.name}当前归入此派`;
  return politicalFocusLinks(world, oneFactionEvidence(faction.id, detail));
}

function activeOfficeDescriptions(
  world: WorldState,
  polityId: string,
  characterIds: ReadonlySet<string>,
): string[] {
  return world.offices
    .filter((office) => (
      office.active
      && office.polityId === polityId
      && characterIds.has(office.holderId)
    ))
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((office) => {
      const holder = world.characters.find((item) => item.id === office.holderId);
      return `${holder?.name ?? office.holderId}任${office.kind}`;
    });
}

/**
 * Finds every faction with a concrete current foothold for this family. A
 * family is never collapsed to one affiliation: different living members may
 * sit in different factions, and each ledger-backed faction remains separate.
 */
export function projectFamilyPoliticalFocus(
  world: WorldState,
  item: FamilyState,
): readonly PoliticalFocusLink[] {
  const familyMemberIds = new Set(item.memberIds);
  const livingMembers = world.characters.filter((character) => (
    character.alive
    && character.familyId === item.id
    && familyMemberIds.has(character.id)
  ));
  const ledgerFamilyMemberIds = new Set(world.characters
    .filter((character) => character.alive && character.familyId === item.id)
    .map((character) => character.id));
  const evidenceByFactionId = new Map<string, Set<string>>();

  for (const faction of world.factions) {
    const registeredMembers = livingMembers.filter((member) => (
      member.factionId === faction.id && faction.memberIds.includes(member.id)
    ));
    const registeredMemberIds = new Set(registeredMembers.map((member) => member.id));
    const offices = activeOfficeDescriptions(world, faction.polityId, registeredMemberIds);
    const hasLedgerFamilyMember = faction.memberIds.some((id) => ledgerFamilyMemberIds.has(id));
    const familyResources = faction.active && hasLedgerFamilyMember
      ? calculateFactionPowerLedger(world, faction).resources.filter((resource) => (
          resource.category === 'family_backing'
          && resource.evidence.some((ref) => ref.entityType === 'family' && ref.entityId === item.id)
        ))
      : [];

    if (offices.length === 0 && familyResources.length === 0) continue;
    const details = new Set<string>();
    if (offices.length > 0) {
      details.add(`族中在朝者：${offices.join('、')}`);
    }
    if (familyResources.length > 0) {
      const ledgerMemberIds = new Set(familyResources.flatMap((resource) => resource.characterIds));
      const ledgerMembers = world.characters
        .filter((character) => ledgerMemberIds.has(character.id))
        .sort((left, right) => stableCompare(left.id, right.id))
        .map((character) => character.name);
      details.add(`此派以${item.name}的家门与财富为权势支点${ledgerMembers.length ? `，所系族人为${ledgerMembers.join('、')}` : ''}`);
    }
    evidenceByFactionId.set(faction.id, details);
  }

  return politicalFocusLinks(world, evidenceByFactionId);
}

function addFactEvidence(
  evidenceByFactionId: Map<string, Set<string>>,
  factionIds: readonly (string | null | undefined)[],
  detail: string,
): void {
  for (const factionId of factionIds) {
    if (!factionId) continue;
    const details = evidenceByFactionId.get(factionId) ?? new Set<string>();
    details.add(detail);
    evidenceByFactionId.set(factionId, details);
  }
}

function explicitFactFactionEvidence(
  fact: SimulationFact,
  evidenceByFactionId: Map<string, Set<string>>,
): void {
  if (fact.kind === 'faction_lifecycle') {
    addFactEvidence(evidenceByFactionId, [
      ...fact.payload.affectedFactionIds,
      ...fact.payload.createdFactionIds,
      ...fact.payload.endedFactionIds,
      ...fact.payload.before.map((snapshot) => snapshot.factionId),
      ...fact.payload.after.map((snapshot) => snapshot.factionId),
    ], '本件史事明载此派的建立、分合或终结');
  } else if (fact.kind === 'faction_relation_changed') {
    addFactEvidence(
      evidenceByFactionId,
      [fact.payload.leftFactionId, fact.payload.rightFactionId],
      '本件史事明载此派参与的结盟或相争',
    );
  } else if (fact.kind === 'court_action_resolved') {
    addFactEvidence(evidenceByFactionId, [
      fact.payload.actorFactionId,
      fact.payload.targetFactionId,
      ...fact.payload.affectedFactionIds,
    ], '本件史事明载此派参与的朝堂行动');
  } else if ((fact.kind === 'embodied_action_submitted' || fact.kind === 'embodied_action_resolved')
    && fact.payload.targetKind === 'faction') {
    addFactEvidence(
      evidenceByFactionId,
      [fact.payload.targetId],
      '本件史事明载此派成为人物行动的对象',
    );
  }

  for (const delta of fact.stateDeltas) {
    if (delta.entityType === 'faction') {
      addFactEvidence(
        evidenceByFactionId,
        [delta.entityId],
        '本件史事记下了此派的权势变化',
      );
    }
    if (delta.field !== 'factionId') continue;
    addFactEvidence(
      evidenceByFactionId,
      [
        typeof delta.before === 'string' ? delta.before : null,
        typeof delta.after === 'string' ? delta.after : null,
      ],
      '本件史事记下了人物改换派属',
    );
  }
}

/**
 * Resolves only factions named by an event's authoritative source-Fact chain.
 * `findWorldFact` intentionally covers both the hot suffix and compressed cold
 * archive; Chronicle title, summary, actors and polity names are not searched.
 */
export function projectHistoryEventPoliticalFocus(
  world: WorldState,
  event: HistoryEvent,
): readonly PoliticalFocusLink[] {
  const evidenceByFactionId = new Map<string, Set<string>>();
  const visitedFactIds = new Set<string>();
  const pendingFactIds = [...event.sourceFactIds];
  while (pendingFactIds.length > 0) {
    const factId = pendingFactIds.shift() as string;
    if (visitedFactIds.has(factId)) continue;
    visitedFactIds.add(factId);
    const fact = findWorldFact(world, factId);
    if (!fact) continue;
    explicitFactFactionEvidence(fact, evidenceByFactionId);
    pendingFactIds.push(...fact.sourceFactIds);
  }
  return politicalFocusLinks(world, evidenceByFactionId);
}

/** Resolves the faction IDs persisted in Situation participants, and no others. */
export function projectSituationPoliticalFocus(
  world: PoliticalFocusLabelWorld,
  situation: SituationState,
): readonly PoliticalFocusLink[] {
  const evidenceByFactionId = new Map<string, Set<string>>();
  for (const factionId of situation.participants.factionIds) {
    if (evidenceByFactionId.has(factionId)) continue;
    evidenceByFactionId.set(factionId, new Set(['卷宗的参与派系列有此派']));
  }
  return politicalFocusLinks(world, evidenceByFactionId);
}

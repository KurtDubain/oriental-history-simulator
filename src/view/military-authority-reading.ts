import type { ArmyOrderKind, ArmyState, WorldState } from '../sim/types';
import { compact } from './compact-number';

const ORDER_LABEL: Readonly<Record<ArmyOrderKind, string>> = {
  hold: '固守',
  advance: '进军',
  intercept: '截击',
  reinforce: '驰援',
  retreat: '撤退',
};

export interface MilitaryRetinueReading {
  ownerId: string;
  ownerName: string;
  soldiers: number;
  cohesion: number;
}

export interface MilitaryAuthorityReading {
  armyId: string;
  nominalPolityId: string;
  nominalPolityName: string;
  regionId: string;
  regionName: string;
  lawfulCommanderId: string;
  lawfulCommanderName: string;
  deputyCommanderId: string | null;
  deputyCommanderName: string | null;
  actualAllegianceId: string;
  actualAllegianceName: string;
  allegianceStrength: number;
  allegianceBasis: string;
  commandDiverged: boolean;
  retinues: readonly MilitaryRetinueReading[];
  retinueSoldiers: number;
  retinueSummary: string;
  orderKind: ArmyOrderKind;
  orderLabel: string;
  orderTargetId: string | null;
  orderTargetKind: 'region' | 'army' | null;
  orderTargetName: string;
  orderTargetRegionId: string | null;
  orderIssuerId: string;
  orderIssuerName: string;
  orderIssuedTurn: number;
  orderBlocked: boolean;
  authoritySummary: string;
}

export function projectMilitaryAuthority(world: WorldState, army: ArmyState): MilitaryAuthorityReading {
  const person = (id: string | null | undefined) => world.characters.find((item) => item.id === id);
  const region = world.regions.find((item) => item.id === army.regionId);
  const polity = world.polities.find((item) => item.id === army.polityId);
  const lawful = person(army.commanderId);
  const deputy = person(army.deputyCommanderId);
  const actual = person(army.allegiance.characterId);
  const issuer = person(army.order.issuerId);
  const targetArmy = army.order.targetArmyId
    ? world.armies.find((item) => item.id === army.order.targetArmyId)
    : null;
  const targetRegionId = targetArmy?.regionId ?? army.order.targetRegionId;
  const targetRegion = world.regions.find((item) => item.id === targetRegionId);
  const orderTargetName = targetArmy?.name ?? targetRegion?.name ?? '本营';
  const retinues = army.retinues.map((retinue) => ({
    ownerId: retinue.ownerId,
    ownerName: person(retinue.ownerId)?.name ?? '无名将校',
    soldiers: retinue.soldiers,
    cohesion: retinue.cohesion,
  }));
  const retinueSoldiers = retinues.reduce((sum, retinue) => sum + retinue.soldiers, 0);
  const retinueSummary = retinues.length
    ? retinues.map((retinue) => `${retinue.ownerName}亲军${compact.format(retinue.soldiers)}`).join('、')
    : '无具名亲军';
  const commandDiverged = army.commanderId !== army.allegiance.characterId;
  const lawfulCommanderName = lawful?.name ?? '无帅';
  const actualAllegianceName = actual?.name ?? lawfulCommanderName;
  const actualRetinue = retinues.find((retinue) => retinue.ownerId === army.allegiance.characterId);
  const allegianceBasis = actual
    ? `统率${actual.leadership}、声望${actual.renown}、忠诚${actual.loyalty}${actualRetinue ? `、直属亲军${compact.format(actualRetinue.soldiers)}` : ''}`
    : `军团士气${army.morale}`;
  const orderLabel = `${ORDER_LABEL[army.order.kind]}${orderTargetName}${army.order.status === 'blocked' ? '（道路受阻）' : ''}`;
  return {
    armyId: army.id,
    nominalPolityId: army.polityId,
    nominalPolityName: polity?.name ?? '无属',
    regionId: army.regionId,
    regionName: region?.name ?? '驻地不详',
    lawfulCommanderId: army.commanderId,
    lawfulCommanderName,
    deputyCommanderId: army.deputyCommanderId,
    deputyCommanderName: deputy?.name ?? null,
    actualAllegianceId: army.allegiance.characterId,
    actualAllegianceName,
    allegianceStrength: army.allegiance.strength,
    allegianceBasis,
    commandDiverged,
    retinues,
    retinueSoldiers,
    retinueSummary,
    orderKind: army.order.kind,
    orderLabel,
    orderTargetId: targetArmy?.id ?? targetRegion?.id ?? null,
    orderTargetKind: targetArmy ? 'army' : targetRegion ? 'region' : null,
    orderTargetName,
    orderTargetRegionId: targetRegion?.id ?? null,
    orderIssuerId: army.order.issuerId,
    orderIssuerName: issuer?.name ?? '军中无署名',
    orderIssuedTurn: army.order.issuedTurn,
    orderBlocked: army.order.status === 'blocked',
    authoritySummary: commandDiverged
      ? `${lawfulCommanderName}依法掌令，士卒更听${actualAllegianceName}`
      : `${lawfulCommanderName}奉令掌军，士卒也听其号令`,
  };
}

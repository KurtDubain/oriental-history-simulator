import type { RosterItem } from '../components/RosterPanel';
import type { ArmyState, WorldState } from '../sim/types';
import {
  character,
  compact,
  livingCharacter,
  polity,
  region,
  worldFamilies,
} from './dossier-adapter-shared';

export function polityRoster(world: WorldState): RosterItem[] {
  return world.polities
    .filter((item) => item.alive)
    .sort((a, b) => b.controlledRegionIds.length - a.controlledRegionIds.length || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: `${livingCharacter(world, item.rulerId)?.name ?? '君位空悬'} · ${region(world, item.capitalRegionId)?.name ?? '无都'}`,
      meta: `${item.controlledRegionIds.length} 地 · 威权 ${Math.round(item.authority)}`,
      accent: item.color,
      alert: item.warWeariness > 55,
    }));
}

export function peopleRoster(world: WorldState): RosterItem[] {
  return world.characters
    .filter((item) => item.alive)
    .sort((a, b) => b.renown - a.renown || b.ambition - a.ambition || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: `${polity(world, item.polityId)?.name ?? '无属'} · ${item.role} · ${item.politicalClass ?? '出身未详'}`,
      meta: `${item.age} 岁 · 影响 ${Math.round(item.influence ?? item.renown)}`,
      accent: polity(world, item.polityId)?.color,
      alert: item.ambition > 78 && item.loyalty < 40,
    }));
}

export function familyRoster(world: WorldState): RosterItem[] {
  return worldFamilies(world)
    .slice()
    .sort((a, b) => b.prestige - a.prestige || b.politicalInfluence - a.politicalInfluence || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: `${polity(world, item.polityId)?.name ?? '无属'} · ${item.active === false ? '谱系已绝' : `家主 ${character(world, item.headId)?.name ?? '未定'}`}`,
      meta: `${item.memberIds.length} 人 · 家望 ${Math.round(item.prestige)}`,
      accent: polity(world, item.polityId)?.color,
      alert: item.active === false || !character(world, item.headId)?.alive,
    }));
}

export function militaryRoster(world: WorldState): RosterItem[] {
  const armies = world.armies
    .filter((item) => item.soldiers > 0)
    .sort((a, b) => b.soldiers - a.soldiers || a.id.localeCompare(b.id))
    .map((item: ArmyState) => ({
      id: item.id,
      title: item.name,
      subtitle: `${livingCharacter(world, item.commanderId)?.name ?? '无帅'} · 驻${region(world, item.regionId)?.name ?? '途中'}`,
      meta: `${compact.format(item.soldiers)} 人 · 士气 ${Math.round(item.morale)}`,
      accent: polity(world, item.polityId)?.color,
      alert: item.supply < 45 || item.morale < 40,
    }));
  const fleets = world.fleets
    .slice()
    .sort((a, b) => (b.warships + b.patrolShips) - (a.warships + a.patrolShips) || a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      title: item.name,
      subtitle: `${livingCharacter(world, item.commanderId)?.name ?? '无帅'} · ${item.mission}`,
      meta: `${item.warships + item.transports + item.patrolShips} 船 · 战备 ${Math.round(item.readiness)}`,
      accent: polity(world, item.polityId)?.color,
      alert: item.repairNeed > 55 || item.morale < 40,
    }));
  return [...fleets, ...armies];
}


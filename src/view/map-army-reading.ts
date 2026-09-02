import type { MapArmyView } from './map-contract';
import { compact } from './compact-number';

export function mapArmyHoverReading(army: MapArmyView) {
  const lawful = army.lawfulCommanderName ?? '主帅不详';
  const actual = army.actualAllegianceName ?? lawful;
  const authority = army.commandDiverged
    ? `${lawful}掌令 / 实听${actual}`
    : `${lawful}掌令 · 军中同听`;
  const retinue = (army.retinueSoldiers ?? 0) > 0 ? ` · 亲军${compact.format(army.retinueSoldiers ?? 0)}` : '';
  return {
    name: army.name,
    type: `${army.nominalPolityName ?? '无属'}军团 · 可点击`,
    rows: [
      ['兵权', authority],
      ['军势', `${compact.format(army.strength)}${retinue}`],
      ['军令', army.orderLabel ?? army.status ?? '在营'],
      ...(army.expectedContact
        ? [['预计接敌', `${army.expectedContact.armyName} · ${army.expectedContact.regionName}`]]
        : []),
    ],
  };
}

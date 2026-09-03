import { useState } from 'react';
import { Swords, X } from 'lucide-react';
import type { WarGroupProjection } from '../view/war-group-projection';
import { compact } from '../view/compact-number';

export interface WarFocusSummaryProps {
  war: WarGroupProjection;
  onInspectPerson: (personId: string) => void;
  onInspectBattle: (eventId: string) => void;
  onClose: () => void;
}

export function WarFocusSummary({ war, onInspectPerson, onInspectBattle, onClose }: WarFocusSummaryProps) {
  const [openBattleFactId, setOpenBattleFactId] = useState<string | null>(null);
  return (
    <aside className="war-focus-summary" aria-label={`${war.title}战局摘要`} data-testid="war-focus-summary" data-war-id={war.warId}>
      <header>
        <span><Swords size={15} aria-hidden="true" /> 战局聚焦</span>
        <button type="button" onClick={onClose} aria-label="退出战局聚焦"><X size={16} /></button>
        <strong>{war.title} · {war.durationLabel}</strong>
        <small>主战线：{war.mainFront}</small>
      </header>
      <div className="war-focus-summary__sides">
        {war.sides.map((side) => (
          <section key={side.polityId} data-role={side.role}>
            <div><strong>{side.polity}</strong><span>{side.armyCount}营 · {compact.format(side.soldiers)}</span></div>
            <details className="war-focus-summary__groups">
              <summary>查看各集团投入</summary>
              {side.groups.map((group) => (
              <div className="war-focus-summary__group" key={group.id} data-faction-id={group.factionId ?? undefined} data-soldiers={group.soldiers}>
                <span>{group.name} · {group.leader}</span>
                <small>{group.persons.length}人 {compact.format(group.soldiers)} · {group.posture}{group.fronts.length ? ` ${group.fronts.join('、')}` : ''}{group.lossesThisTurn ? ` · 本季损${compact.format(group.lossesThisTurn)}` : ''}</small>
                <div>{group.persons.map((person) => (
                  <button key={person.id} type="button" data-person-id={person.id} onClick={() => onInspectPerson(person.id)} title={`${person.formation}，受${person.commander}节制`}>
                    {person.name} · {compact.format(person.soldiers)}
                  </button>
                ))}</div>
              </div>
              ))}
            </details>
          </section>
        ))}
      </div>
      {war.contacts[0] ? (
        <p className="war-focus-summary__contact">
          <strong>即将接敌</strong>{war.contacts[0].attackerCommander}（{war.contacts[0].attackerGroup}）将在{war.contacts[0].region}迎上{war.contacts[0].defenderCommanders}（{war.contacts[0].defenderGroups}），约{war.contacts[0].steps}步。
        </p>
      ) : null}
      {war.latestBattle ? (
        <button type="button" className="war-focus-summary__contact war-focus-summary__battle" onClick={() => {
          if (war.latestBattle?.eventId) onInspectBattle(war.latestBattle.eventId);
          else setOpenBattleFactId((current) => current === war.latestBattle?.factId ? null : war.latestBattle?.factId ?? null);
        }}>
          <strong>最近交战</strong>{war.latestBattle.region}：{war.latestBattle.attackerCommander}（{war.latestBattle.attackerGroup}）{war.latestBattle.result}；战前{compact.format(war.latestBattle.attackerBefore)}对{compact.format(war.latestBattle.defenderBefore)}，攻损{compact.format(war.latestBattle.attackerLosses)}、守损{compact.format(war.latestBattle.defenderLosses)}。{war.latestBattle.aftermath}
          {openBattleFactId === war.latestBattle.factId ? <small>此役尚无独立史页，战前兵力与伤亡直接取自当季战报。</small> : null}
        </button>
      ) : null}
    </aside>
  );
}

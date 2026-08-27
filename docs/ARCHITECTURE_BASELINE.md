# 《沧衡纪》架构增长基线

> 建立于 2026-08-27，命令：`npm run test:audit:architecture`

## 当前规模

- `src` 下生产 TypeScript / TSX：69 个文件，约 41,899 行（测试排除）。
- 相对模块依赖：229 条。
- 当前热点：`engine.ts` 3,191 行、`App.tsx` 2,817 行、`WorldMap.tsx` 2,734 行、`invariants.ts` 2,649 行。
- 其次为 `v02.ts` 1,976 行、`v03-ocean.ts` 1,945 行、`view/adapters.ts` 1,712 行、`agency/decision.ts` 1,580 行。

行数是增长预警，不是机械拆文件指标。新增领域规则不得再默认进入四个最高热点；只有形成稳定输入、输出和所有权后才拆分。

## 已知依赖风险

扫描会报告由 `WorldState` 汇总类型形成的 type-only 环：`types.ts` 与 Facts、Agency、Situation 类型彼此引用。它们目前不会产生浏览器运行时循环，但说明总状态类型已经承担过多聚合职责。后续拆分优先把纯 DTO 放入无实现依赖的契约模块；在完成固定 seed 行为对照前，不为“消除图上的线”一次性移动全部类型。

## 本纵切的所有权

```text
engine.ts（季度顺序与提交）
  → turn-pipeline.ts（阶段顺序、一次执行、计时）
    → agency/decision.ts（支持行动、军令 Intent、机构回应）
      → typed Facts（权威发生）
        → PersonalMemory / Situation / 玩家投影（下游读取）
```

- `AgencyDecisionSystemState` 继续是人物权力行动的唯一持久化 owner。
- `agency_support_resolved` 与 `agency_intent_*` 是支持、请令和回应的权威事实；Chronicle、传记和 UI 不反向决定结果。
- `turn-pipeline.ts` 不接触 `WorldState`，只保证既定阶段按顺序执行一次并产出计时；领域模块仍独立拥有状态变化。
- 本轮没有向 `App.tsx`、`WorldMap.tsx` 或 `engine.ts` 增加新玩法规则。

## 后续收缩顺序

1. C14/C15 前把 Agency 与战争相关校验从 `invariants.ts` 移到领域校验模块，共用一次索引。
2. 人物入世前把时间、对象选择和弹层路由从 `App.tsx` 收到 controller/hook，保持单一 `WorldState` owner。
3. 政治地图进入实现前拆分 `WorldMap` 的投影、绘制、命中和手势，继续共用同一几何结果。
4. 档案继续增长前按人物、国家、家族、军团和 Situation 拆分玩家投影，不允许组件解释原始 Fact。

每次架构提交必须通过旧档迁移、固定 seed、存档续推、Facts/Chronicle 对照、桌面与 390×844 浏览器验收；不得顺带改平衡或用重写制造不可审查差异。

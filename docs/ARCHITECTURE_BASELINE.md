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

## v1.6.1 第一轮职责收口

- `src/view/embodiment-view.ts` 成为入世档案与文本快照的共同投影 owner；身份标签、对象、可用原因和最近结果不再由 `App.tsx` 重复解释。`App.tsx` 从约 3,130 行降至 3,027 行。
- `src/sim/validation/embodiment.ts` 只接收本季新增 Facts，负责入世提交/结果唯一配对和领域 Fact 链接；原错误码、文案和有界扫描语义保持不变。`invariants.ts` 从约 2,700 行降至 2,651 行。
- 拆分后为 77 个生产 TS/TSX 文件、约 45,870 行；增长来自明确契约与专项回归，不再把职责留在两个热点文件。现有 type-only 聚合环未扩大为运行时依赖环。
- 固定种子“架构边界-入世”“州县民生”推进 12 季后，world hash、Fact digest、History digest、数量、地方官人选以及全部行动 ID/可用原因与拆分前逐项一致。

## v1.6.2 地图四层与档案首段

- `WorldMap.tsx` 从 2,734 行降至 783 行，只保留 React 生命周期、对象选择和可访问交互编排；地图 DTO、展示坐标投影、Canvas 绘制、共享布局/命中和手势计算分别有独立 owner。
- 军团与城港图标的 Canvas 绘制和点按使用同一 screen-space layout；悬停与轻点读取同一优先级 Scene Hit，不再维护两套距离判断。移动端宽容半径、14/10px 触控拖动阈值、28px 点按取消线和双指锚点语义未改。
- 世界到地图的玩家投影，以及地区、军团、水师、商路、疫病与技艺速览已从总 `view/adapters.ts` 抽离；旧公共入口只作稳定 re-export，组件仍只消费有界 view model。
- 当前架构检查为 84 个生产 TS/TSX 文件、46,290 行，无新增运行时循环；`WorldMap.tsx` 已退出热点告警，总 `view/adapters.ts` 降至 1,474 行。ARC06 尚需继续拆人物、国家、家族与历史因果档案，因此任务 28 仍保持开放。

## v1.6.3 档案投影收口

- 人物、国家、家族、历史因果与名册投影分别由 `person-dossier-adapter`、`country-dossier-adapter`、`family-dossier-adapter`、`history-causal-adapter` 与 `roster-adapter` 拥有；重复的查找、日期与证据链接只保留在内部共享层。
- `view/adapters.ts` 从 1,474 行降至 26 行，只保留地图、档案与名册的兼容 re-export；人物模块 837 行，其余新领域模块均低于 200 行。
- 架构检查为 90 个生产 TS/TSX 文件、46,384 行；没有新增依赖环。独立模块与兼容入口在固定世界上逐项相等，全部投影前后序列化世界保持一致，ARC06 与任务 28 已关闭。

## v1.7.0 地图内容包边界

- `src/maps` 成为地图内容的唯一 owner：契约、registry、规模派生、完整性校验和 `private-v03` 内容包彼此分离；旧 `sim/data` 与 `view/map-geography` 只保留兼容 re-export。
- `createWorld(seed, profileId)`、海洋初始化、地图投影、Scene Hit、Canvas renderer 与全文快照都从同一 profile 读取。政权制度/海洋倾向、地理分区、视觉排除路线和河流导引不再散落在领域或 renderer 中。
- 独立 `check:maps` 在生产构建前验证 ID、首都、控制权、路线、海陆运输图、港口、展示位置与陆形；当前架构检查为 99 个生产文件、46,897 行，没有新增依赖环。
- MAP02 行为门冻结两个世界从 T0 到 T12 的 world hash、Fact digest 与 History digest；默认创建和显式私人 profile 创建逐字节相等，schema 4 与旧档内容版本保持不变。

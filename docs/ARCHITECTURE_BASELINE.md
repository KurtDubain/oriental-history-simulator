# 《沧衡纪》架构增长基线

> 建立于 2026-08-27，v1.25.0 人物命途纵切收口于 2026-09-04，命令：`npm run test:audit:architecture`

## 当前规模

- `src` 下生产 TypeScript / TSX：169 个文件，61,904 行（测试排除）。v1.24.1 只增加地图人物标签的确定性避让与视觉优先级，没有新增模拟 owner、世界字段或页面。
- 相对模块依赖：652 条，其中 422 条 runtime、230 条 type-only；运行时环与跨层违例均为 0，类型总图仍只有既有的 12 模块契约环，正好落在 12/12 的不增长预算内。
- 当前热点：`engine.ts` 3,114/3,120 行、`invariants.ts` 2,665/2,665 行、`App.tsx` 2,296/2,300 行（实际/门禁）。
- 其次为 `v02.ts` 2,488 行、`v03-ocean.ts` 2,460 行、`agency/decision.ts` 2,032 行、`Inspector.tsx` 1,352 行与 `map-renderer.ts` 1,128 行。`observer-leads.ts` 为 388/400 行，`WorldMap.tsx` 为 1,053/1,100 行，`view/adapters.ts` 为 52/100 行。

行数是增长预警，不是机械拆文件指标。新增领域规则不得再默认进入四个最高热点；只有形成稳定输入、输出和所有权后才拆分。

### 权威状态准入规则

任何新数据进入 `WorldState` 前必须同时回答“下一季哪个系统会消费它”或“它如何防止同一事实被重复消费”。两者都不能回答的数据不得进入 `WorldState`；展示排序、恢复焦点、题目留任、比较账、UI 分支和调试摘要应当由当前权威状态纯投影，或在确有交互恢复需要时进入有界 observer-only 设置。不得以“以后可能用到”为由增加顶层字段、季度阶段或持久兼容层。

## 已知依赖风险

v1.10.1 的扫描已从正则匹配改为 TypeScript AST 与 Tarjan SCC，能区分编译后真实存在的边与被擦除的 `import type`。当前：

- runtime 依赖图没有循环，也没有 `sim/maps → App/components/view/audio/infra` 的跨层回写。
- 类型总图仅有一个 12 模块 SCC：`types.ts` 汇总 `WorldState`，Facts、Agency 和 Situation 合约又以 type-only 方式反向参照总状态。相关 import 不进入浏览器 JavaScript，所以这是契约所有权债务，不是初始化顺序或 `undefined` 风险。
- 门禁将 runtime cycle 与跨层依赖视为硬失败；type-only SCC 先锁定为 12 模块的不增长预算。后续只在对应领域纵切中把持久化 DTO 与可执行实现分开，不为消除图上的线一次性搬动存档契约。

## COMPACT01 删除的状态所有权

```text
人物目标 / 计划
  → 唯一 owner：WorldState.agencyDecisionSystem
  → 最近提交与结果：typed agency / embodied Facts
  ✕ 删除：AgencyShadowLedger / branch / restore point / comparison / localStorage

当世三问
  → 当前 Situation + 本季战争 / 朝堂 Facts 的无状态投影
  ✕ 删除：ObserverLeadContinuityState / 固定槽位 / 任期 / 挑战者 / 仲裁账

舆图
  → 疆界 / 军争 / 供养 / 地势四种玩家概念
  ✕ 删除：六种专业叠层、MapFlow DTO、流线命中、专业 marker 与选择策略
```

- 旧 `canghai-agency-shadow-ledger-v1` 和 ObserverDesk 中的 `leadContinuity` 都直接忽略，不迁移到新 store 或 wrapper。
- `App.tsx` 继续是唯一 `WorldState` React owner；世界打开、推进、天意、收藏与存读档不再同步观察账本。
- COMPACT01 完成时 `WorldState` 为 44 个顶层字段；v1.24.0 只新增唯一的 `personalForces` 兵力 owner，成为 45 个字段并升级至 schema 5。季度流水线仍为 22 个阶段，没有增加人物逐季军事 AI。
- v1.22.2 的个人版 / 参赛版 JavaScript gzip 均为 411,080 bytes，CSS gzip 均为 38,777 bytes。v1.23.0 两种构建的 JavaScript gzip 均为 417,164 bytes，CSS gzip 均为 39,396 bytes，仍低于 410 KiB / 40 KiB 门禁；包体余量不用于恢复已删除概念。

### 周边压力进入军政阅读的边界

`core-impact-projection.ts` 只读取最近一季已结算的 Fact、stateDelta 与战役快照，最多投影三条“低补给与战力、地方压力与朝局、疾病死亡与职权交接”结果。它不持久化、不参与下一季结算，也不根据同时出现的数值推测因果。

- 已有明确凭证时，三问、战局、军团和朝局可附带一条“军政牵动”；普通贸易、迁徙或疫病仍留在地区档案和史册。
- 疾病只有在人物病故 Fact 与同席位任免 Fact 能闭合时才说明权力交接；现有总量军中病亡不能归因到具体军团，因此保持沉默。
- 例行军粮 Shipment 即使指向具体军团，也不等于军政后果；只有低补给改令或 Battle Fact 明记的战前补给进入默认阅读。一般关税与国库支出无法证明资金同源，不描述成征兵、军饷或造舰原因。
- 该模块是现有权威记录的只读 adapter，不是第二套事实账本；`WorldState` 顶层字段、季度阶段、schema 与四层舆图均未改变。

## 人物军势与军权纵切的所有权

```text
PersonalForceState owner / soldiers / cohesion / readiness / formation
  → military/personal-forces.ts（唯一兵力、战损、补员、解散与 schema-4 迁移 owner）
  → ArmyState.participantIds + derived soldiers（临时行营，不重复拥有兵力）
  → military/authority.ts + military/orders.ts（法定主将、实际拥戴、派令与执行路径）
  → Fact / runtime + full validation / archive pins
  → war-group / map / person-dossier 纯投影
  → 人物点与行军箭线 / 人物与行营速览 / 卷宗 / 文本快照

NavalOperationState.manifest
  → v03-ocean.ts（装载舱单 / 分段航行 / Shipment 守恒 / 返港命令）
  → runtime + full validation
```

- `personal-forces.ts` 是陆军士兵唯一权威入口：人物一人至多一支，行营缓存必须等于有效参与者之和；招募从地区人口进入具体人物，伤亡按战前投入比例整数分配，退出、死亡和解散都回到具体个人或地区。
- `orders.ts` 是军令规划、目标、路径与“本季签发、下季执行”的唯一 owner；行营只保存当前令，旧令由 Fact/冷热档案持有，不在热状态串链。
- `validation/military-authority.ts` 同时服务完整校验和前缀有界的季度校验；运行时只读取本季新增 Fact 与上季已验真的当前来源，不扫描历史前缀。
- UI 不保存兵权副本。`war-group-projection.ts`、`map-adapter.ts`、`map-dossier-adapter.ts` 与 `person-dossier-adapter.ts` 都只读同一人物军势、行营、法定主将与实际拥戴；已删除的 Army-first 共享解释层不再作为兼容 wrapper 存在。
- 跨海行动在实际装载时冻结 `loadedTurn / soldiersDeparted / transportEdgeIds`。舱单冻结后，成功登陆、航损返航与已装载行动中止按同一舱单写入 Shipment；撤回舰队保持返港使命，直到实际靠港后才恢复常规调度。

## 人物命途纵切的所有权

```text
关系 / 集团 / 忠诚 / 既有职守 / PersonalForce
  → military/expedition-response.ts（一次出征的确定性响应，不保存响应账本）
  → ArmyState.participantIds（完整个人军势加入临时行营）

Battle Fact 的个人参战与伤亡快照
  → military/battle-fate.ts（无恙 / 负伤 / 战死的一次确定性裁决）
  → character-death.ts（自然死亡、病死、战死共用的权威下线清理）
  → 既有家产、家主、君位、官职、派系与军中接替链

Fact + Chronicle 导航 ID
  → view/person-story-arc.ts（只读章回压缩与四段生平）
  → 人物档案 / 完整人物传 / render_game_to_text
```

- 出征响应只在组建行营时运行：主将与同行者共用一套可出征资格，同行人数固定有界；普通留守不生成事实，只有证据充分的公开拒绝才进入 Fact、生平与史册。
- 战后命运只裁决 Battle Fact 中真实参战的人，并使用该人的战前兵力与实际损失。负伤沿用 `health`，战死沿用统一死亡入口；没有 `WoundState`、伤势分类、俘虏状态或第二套死亡清理。
- 人物故事不进入 `WorldState`，不缓存阶段和分数。重复会战只在展示层按战争、地点、攻守与结果压成章回，原 Fact/Event 保持完整；Chronicle 只提供可点击导航，不成为另一份叙事真相。
- v1.25.0 没有升级 schema 5、没有增加 `WorldState` 顶层字段，也没有增加季度阶段。固定 seed 的新历史会因战后裁决而改变，但同版本重放的 world hash、Fact digest 与 History digest 必须完全一致。

## 将领集团与战局投影的所有权

```text
FactionState + Character.factionId
  → faction-lifecycle.ts（共军、支持、地方、家门与共事关系形成 2～4 个稳定集团）
  → 既有 power-ledger.ts（官职、军令、家门、支持与战绩）

PersonalForceState + ArmyState participantIds / commander / allegiance / order
  → war-group-projection.ts（按人物部曲汇总活动战争，不保存第二份集团或兵力）
  → WarFocusSummary + 既有军争 Canvas（战线、路线、接敌、胜败与进退）
```

- 每名参战人物按自身集团归入一处，行营和人物部曲不重复加总；法定掌令与军中实际拥戴不同时，投影保留双方姓名与集团。
- 集团名称只在建立时从军团、地方、领袖旧部、家门或中枢根基取得；每季只更新成员层级，不随官职反复改名。旧 schema 4 派系保留原名，不补造旧史。
- `ArmyState.recentMovement` 是每军一条、覆盖式的兼容记录，用来表现普通境内行军已经走过的真实一步；它不增加 `WorldState` 顶层字段、不形成历史数组，也不参与随机或领域结算。只有跨敌境、接敌、撤退、占领或登陆继续进入原有 Fact / Chronicle。
- `war-group-projection.ts` 只读当前战争、人物军势、行营、集团和 Battle Fact；观察、战争聚焦与打开战局摘要不会修改世界、RNG、Fact、Chronicle 或序列化正文。
- v1.25.0 为人物出征响应、战后命运和可溯源生平纵切使用 415 KiB JavaScript gzip 门禁；单 JavaScript raw 仍为 585 KiB、CSS gzip 仍为 40 KiB。个人版与参赛版实测 JavaScript gzip 均为 423,991 bytes，CSS gzip 均为 40,040 bytes，最大 JavaScript 文件原始体积为 592,442 bytes。

## 后续收缩顺序

1. 先把 Agency Intent 交易链校验从 `invariants.ts` 移到 `validation/agency-intent.ts`，共用已有 Fact/Event 索引并保持违例顺序与错误码。
2. `App.tsx` 下一刀只收时间播放、页内导航/弹层调度与存档恢复 controller；`WorldState` 继续只有一个 React owner。
3. `engine.ts` 先拆新世界初始化 `world factory`，再在独立纵切中收军团补给/战争/会战域；不同时改变季度顺序或数值。
4. 上述边界稳定后，再将 Facts、Agency、Situation 的持久化纯 DTO 从实现模块拆出，逐步压低 12 模块 type-only SCC。
5. 延迟加载只针对经 bundle/profile 证明能独立且有体积收益的二级工具；不为此引入顶层路由器。Web Worker、ECS 和多页路由继续暂缓，分别等待主线程性能、数据布局或真实导航需求证据。

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

## v1.8.0 双地图与发布隔离

- `contest-v01@1` 以独立内容包提供 68 州、10 海域、8 政权及全套海陆运输和展示数据；模拟域未增加地图 ID 分支。
- registry 分别提供“当前最新 profile”与“精确 `id@revision`”查询。创建界面可按 ID 选择当前修订；活跃世界、存档与 renderer 只按已进入 hash 的 `mapContentVersion` 反解精确修订，禁止从旧存档跳到 latest。
- `WorldSaveSummary` 以 `ready / incompatible / corrupt` 区分可读、缺图与损坏；缺图存档可复制留底，读取失败不会先覆盖 autosave。三问与入世观察状态的本地 key 也升级为 `mapContentVersion + seed`，私人旧 key 仅作一次兼容回退。
- Vite 通过 `@map-profile-catalog` 与 `@app-changelog` 同时切换完整个人内容和参赛 allowlist；兼容 `sim/data` 与 `view/map-geography` 也从当前 catalog 解析，不再形成私人模块捷径。
- `build:contest` 使用独立 TypeScript 配置，并在 Rollup 模块图中拒绝私人地图、完整 catalog 与个人更新记录。最终产物还必须匹配 v1.8.0 的 `contest-profile.json`，并通过从私人 profile 自动派生的 328 项名称/ID 扫描。
- 390×844 与 640×900 世界外壳使用不可编程横滚的 `overflow: clip`；季报账本说明在 760px 内向内收边，弹页焦点恢复使用 `preventScroll`，避免隐藏 tooltip 将整张地图横向推移。
- 当前架构检查为 105 个生产 TS/TSX 文件、47,987 行、365 条相对依赖；既有 8 条 `WorldState` type-only 聚合环未增加新的运行时内容环。`engine.ts`、`App.tsx` 与 `invariants.ts` 仍是下一轮纵切必须收缩的三个热点。

## v1.10.1 工程边界与持续门禁

- `App.tsx` 从 v1.10.0 的约 3,301 行降至约 2,525 行。对象标签/关注转换、Agency 跟踪/档案投影、`render_game_to_text` 快照和它们的 observer-only 合约已有独立 owner；纯投影回归同时核对输出和世界不变性。页面壳仍是权威世界唯一 React owner，拆分模块不保存第二份模拟状态。
- `calendar.ts` 和 `world-hash.ts` 成为纪年/权威摘要的纯 owner，`engine.ts` 只保留兼容 re-export。`invariants.ts`、`v03-intervention.ts` 和 `persistence.ts` 改为直接依赖纯模块；运行时闭包分别从 33 降至 21、32 降至 4 与 34 降至 32。`engine.ts` 从 3,210 行降至约 3,098 行，哈希构造顺序、保留窗口、schema 和存档均未改变。
- 架构门直接拒绝 runtime SCC、禁止的跨层依赖、type-only 债务增长和热点预算超标。当前预算为 `App.tsx` 2,300、`observer-leads.ts` 400、`engine.ts` 3,120、`invariants.ts` 2,665、`WorldMap.tsx` 1,100、`view/adapters.ts` 100 行；这些是防反弹上限，不是为了凑行数填满的目标。
- Vite 将 framework、simulation、maps 和应用入口分为稳定产物边界。v1.21.1 曾达到约 429,904 bytes JavaScript gzip，COMPACT01 先通过真实删除把总 JavaScript gzip 门禁收紧为 410 KiB；v1.25.0 仅为人物出征、战后命运与有来源的生平纵切把该总门禁有界调整为 415 KiB，单 JS raw 585 KiB 与 CSS gzip 40 KiB 门禁不变。
- `.github/workflows/quality.yml` 在 Pull Request 和 `main` 推送上使用 `.nvmrc` 固定 Node 22，以 `npm ci` 从锁文件安装，依次执行单测、架构门、两种构建/产物预算、安全更新与关键浏览器链；失败时上传 `output/` 以便复现。发布检查同时约束 `package.json` / lockfile / 个人版更新记录 / 参赛版更新记录一致，并在生产变更时要求版本递增。

## v1.19.0 政治投影与地图载荷边界

- `PoliticalFocusLink` 是人物、家族、史事和 Situation 到朝局的唯一跨入口 DTO；四类投影均为纯函数，不修改世界，不扩充 `ArchiveEntityKind`。同一 `CourtFocusRequest` 通过一个 App handler 关闭旧卷、打开国家朝局并聚焦 exact faction；无效或跨政权请求明确失败，不选默认替身。
- 地图 catalog 不再编入浏览器 maps chunk，而是按 allowlist 写入 HTML `application/json` 数据节点。`<`、U+2028 与 U+2029 在构建时转义，registry 解析后仍执行完整 profile validation 和深冻结。参赛产物仅含 `contest-v01`，328 项私人令牌扫描与模块图隔离继续作为硬门。
- 实测个人/参赛 `maps` chunk gzip 均为 2,822 bytes；无反向运行依赖的 `sim/politics` 另成 41,728-byte 缓存边界，使主 simulation chunk 从 597,260 降至 555,770 bytes，不再只剩约 1.8 KiB 的单文件余量。总 JavaScript gzip 为 416,511 / 416,421 bytes，CSS gzip 均为 39,796 bytes，原预算不放宽。HTML 载荷会增加少量压缩传输体积，本次优化的明确目标是降低 JavaScript 解析/执行并恢复单文件工程余量，不宣称总下载量减少。
- 最终架构门为 155 个生产文件 / 62,061 行 / 358 runtime + 220 type-only imports，0 runtime cycle、0 跨层违例；`App.tsx` 与 `WorldMap.tsx` 分别为 2,563/2,600 与 1,088/1,100 行。

## v1.20.0 朝臣身份与政治结盟边界

```text
人物“所图”纯投影（embodied-court）
  → EmbodiedActionCommand（exact actor + target faction）
    → 朝局单席候选队列（court-alliance-actions）
      → 原 faction relation 领域裁决
        → faction_relation_changed
          → 承诺 / 双向恩义 / 传记 / PersonalMemory / 权势账 / Chronicle
```

- `court-alliance-contract.ts` 只拥有结盟门槛、期限与每政权单席容量；`court-alliance-actions.ts` 拥有自然候选发现、精确对象重验、稳定排序、容量仲裁和唯一领域写入。玩家命令没有另一套成功率、排序权或状态写入路径。
- `embodied-court.ts` 只读人物身份、官职与精确派系 ID，负责展示和把命令重建为领域候选；`embodied-identity.ts` 收拢各身份行动共用的提交/结果信封。角色结果的 `stateDeltas` 保持为空，只以 `domainFactId` 反链原 `faction_relation_changed`。
- 请求过季、跨政权、派系退场、领袖更替或条件不足时，领域裁决不产生差量；同政权单席竞争落选只生成留待后议结果。成功后，政治联盟承诺与双方恩义继续由原政治领域持有，不在 Agency 层复制第二份联盟状态。
- 两个固定种子的十二季无玩家 world hash、Fact digest 与 History digest 与 v1.19.0 逐字一致；新增身份路径不会改写普通世界自行演化的顺序。当前 AST 门为 159 个生产文件 / 63,010 行 / 373 runtime + 224 type-only imports，0 runtime cycle、0 跨层违例，type-only 契约环保持 12/12。

# 《沧衡纪》架构增长基线

> 建立于 2026-08-27，v1.20.0 更新于 2026-09-01，命令：`npm run test:audit:architecture`

## 当前规模

- `src` 下生产 TypeScript / TSX：159 个文件，63,010 行（测试排除）。
- 相对模块依赖：597 条，其中 373 条 runtime、224 条 type-only；运行时环与跨层违例均为 0，类型总图仍只有既有的 12 模块契约环，正好落在 12/12 的不增长预算内。
- 当前热点：`engine.ts` 3,120/3,120 行、`invariants.ts` 2,642/2,665 行、`App.tsx` 2,563/2,600 行（实际/门禁）。
- 其次为 `v02.ts` 2,481 行、`agency/decision.ts` 2,021 行、`v03-ocean.ts` 1,951 行、`v1-agency-shadow.ts` 1,479 行、`Inspector.tsx` 1,396 行。`WorldMap.tsx` 为 1,088/1,100 行，仍由已拆分的 Scene / renderer / gesture 契约支撑；`view/adapters.ts` 为 53/100 行。

行数是增长预警，不是机械拆文件指标。新增领域规则不得再默认进入四个最高热点；只有形成稳定输入、输出和所有权后才拆分。

## 已知依赖风险

v1.10.1 的扫描已从正则匹配改为 TypeScript AST 与 Tarjan SCC，能区分编译后真实存在的边与被擦除的 `import type`。当前：

- runtime 依赖图没有循环，也没有 `sim/maps → App/components/view/audio/infra` 的跨层回写。
- 类型总图仅有一个 12 模块 SCC：`types.ts` 汇总 `WorldState`，Facts、Agency 和 Situation 合约又以 type-only 方式反向参照总状态。相关 import 不进入浏览器 JavaScript，所以这是契约所有权债务，不是初始化顺序或 `undefined` 风险。
- 门禁将 runtime cycle 与跨层依赖视为硬失败；type-only SCC 先锁定为 12 模块的不增长预算。后续只在对应领域纵切中把持久化 DTO 与可执行实现分开，不为消除图上的线一次性搬动存档契约。

## 本纵切的所有权

```text
WorldState 显式人物归属 / 家族在朝支点 / Fact / Situation participants
  → political-focus.ts（纯证据投影）
    → 人物 / 家族 / 史事 / Situation 既有档案
      → CourtFocusRequest（observer-only 精确导航）
        → CourtProjection（同一席位、权势账与地图根基入口）
```

- `political-focus.ts` 只读结构化 ID 与 Fact 因果链，禁止从名称或叙事文案猜归属；历史派系失效时原 ID 保留且跳转关闭。
- `CourtFocusRequest` 只属于观察导航，不进入 `WorldState`、存档、Fact、Chronicle 或 hash；它也不改写地图的派系 overlay 焦点。
- 构建按个人版/参赛版 allowlist 把地图 profile 序列化为安全 `application/json` HTML 载荷；浏览器 registry 同步校验和冻结，SSR/审计仍读静态 catalog。
- 本轮没有改动 `engine.ts`、`invariants.ts`、存档 schema 或任何模拟数值；`App.tsx` 只增加唯一精确朝局导航出口。

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
- 架构门直接拒绝 runtime SCC、禁止的跨层依赖、type-only 债务增长和热点预算超标。当前预算为 `App.tsx` 2,600、`engine.ts` 3,120、`invariants.ts` 2,665、`WorldMap.tsx` 1,100、`view/adapters.ts` 100 行；这些是防反弹上限，不是为了凑行数填满的目标。
- Vite 将 framework、simulation、maps 和应用入口分为稳定产物边界。v1.18.0 为第四类权威 Situation 与持久 Fact 校验将个人版/参赛版的紧约束统一收在：单 JS raw 585 KiB、JS gzip 总量 418 KiB、CSS gzip 总量 40 KiB。该上限只比本次实测留出约 1% 余量，后续功能若继续增长，优先做可证明的代码拆分或删除，不能无依据放宽门禁。
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

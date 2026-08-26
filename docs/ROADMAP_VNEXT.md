# 《沧衡纪》vNext Roadmap 与后续任务清单

> 对应设计：[NEXT_SYSTEM_DESIGN.md](./NEXT_SYSTEM_DESIGN.md)
> 性能依据：[SIMULATION_PERFORMANCE_AUDIT.md](./SIMULATION_PERFORMANCE_AUDIT.md)
> 任务状态：Phase A 已完成；Phase B 的 B01/B02/B03/B08 军权危机纵切已落地，下一入口仍在 Phase B，先扩展第二类局势，不提前进入人物 Agency

## 1. 路线总览

```text
Phase A 真实性与性能基础
  ↓
Phase B Situation 可玩纵切
  ↓
Phase C 人物与家族真正行动
  ↓
Phase D 战争成为持续故事
  ↓
Phase E 长期世界与 Scenario
  ↓
Phase F UX、地图 LOD 与发布打磨
```

建议单人全职开发按 10～14 周估算，并在每个 Phase 结束形成可玩的发布点。时间只是排期参考，不能替代验收门。

## 2. 优先级重排

### P0：先让真实发生可被所有系统感知

1. 性能与档案基线。
2. Simulation Fact / Chronicle 分离，先修 Battle。
3. Runtime Validation 与 AutosaveCoordinator。
4. Situation 核心和“军权危机”纵向切片。
5. 当世三问稳定追踪 Situation。
6. Character Goal/Plan shadow mode 与首个“争取统军”计划。
7. 旧家族分类为可行动家族/legacy household。

### P1：让人物、家族和战争完成闭环

1. 人物 Intent 逐类接管旧阈值行为。
2. PersonalMemory、经历成长、真正 LOD。
3. 新世界家族生成器与家族年度 AI。
4. Campaign、Siege、战争目标和战争结果。
5. Situation 扩展、史册聚合、经济语义、地图 LOD。
6. Simulation Quality Audit。

### P2：扩大重玩性，不阻塞核心体验

1. 大一统末世、海贸时代等 Scenario。
2. 史家预测。
3. 多方战争、盟友参战和复杂和约。
4. 更深海权和上帝干预。
5. Web Worker，仅在性能门触发时。

完整家族重生成从附件建议的 P0 调整到 P1：P0 先完成分类和迁移边界，避免在故事线尚未验证前重做所有开局平衡。完整 AI 也先 shadow，再分行为接管，防止一次替换现有稳定模拟。

## 3. Phase A — 真实性与性能基础

### Goal

修复“真实发生但没有入史就不算经历”的架构错误，并保证下一阶段不会放大每季历史扫描和存档写入。

### Dependencies

- schema 1/2/3 存档保持可读，当前运行时正式升级为 schema 4。
- Fact 命名、ID、digest 与 legacy boundary 规则已经冻结并由迁移测试保护。

### Tasks

- [x] **A00 — 修正审计基线**：更新旧 `v02-audit` 的 schema 2 假设，明确历史审计与当前 schema 3/4 的用途。
- [x] **A01 — 端到端性能埋点**：分别测 clone、各系统、hash、runtime/full validation、React commit、Canvas、serialize 和 IndexedDB。
- [x] **A02 — schema 4 设计与迁移夹具**：新增迁移边界、计数器、digest；保留 schema 1/2/3 读取。
- [x] **A03 — Turn Fact Buffer**：让领域系统在季度上下文中写 typed Fact，不直接要求公开史册。
- [x] **A04 — BattleFact**：每次 `resolveBattle` 在军团可能解散前无条件记录双方军团、主副将、战前后状态、胜负和损失。
- [x] **A05 — Territory/Appointment/Life Fact 最小集**：覆盖领土转移、任免、死亡、婚姻，支撑 Situation 与回拨。
- [x] **A06 — 副将职业改读 Fact**：首次参战、战功、经历与晋升证据不再读取 Chronicle `battle`。
- [x] **A07 — Chronicle Projector 双写**：保留现有 HistoryEvent/UI，但其条目引用 sourceFactIds；普通小战可不公开。
- [x] **A08 — 历史回拨兼容桥**：新世界优先读 Territory Fact，旧档继续读 HistoryEvent delta。
- [x] **A09 — Runtime Validation**：生产每季只校验本季账、changedIds、Fact/Event 增量 digest 和 hash。
- [x] **A10 — Full Validation 保留**：创建、读档、导入、手动保存、测试和审计继续完整扫描。
- [x] **A11 — AutosaveCoordinator**：dirty generation、single-flight、latest-only、8 季/5 秒 idle、暂停与后台 flush。
- [x] **A12 — Phase A 回归矩阵**：春夏秋战斗、同季多战、战后军团解散、史册裁剪、旧档迁移、4×/8× 写盘。

### Risks

- Fact 与旧 Event 双写期间可能发生重复副作用。
- schema 迁移若倒推旧 Fact，可能伪造过去。
- Autosave 异步完成顺序可能覆盖新档。

### Controls

- Fact 是唯一成长输入；旧 Event 仅展示。
- 旧 schema 3 只建立 `legacyArchiveBoundary`，不伪造未被记录的旧战斗。
- Autosave 以 generation 比较拒绝旧快照晚写。

### Acceptance Criteria

- 每次真实会战恰好对应一个 BattleFact。
- 非冬季和同季后续战斗都能增加参战副将经历。
- 调高/调低 Chronicle 展示阈值，续推世界 hash 完全一致。
- Runtime validator 不扫描完整 history/fact archive。
- 4×/8× 连续一分钟，自动写盘不超过约 12 次；并发写入始终 ≤1。
- 暂停后 2 秒内 IndexedDB 是最新世界。
- schema 3 原始史册、familyId、领土和 hash 验证不被改写。
- 全部既有测试、生产构建和浏览器 E2E 通过。

### Completion Evidence（2026-08-25）

- 120 项 Vitest、TypeScript/生产构建、桌面与 390×844 Chromium E2E 全部通过。
- 3 个种子 × 80 季 Phase A 审计：模拟 P95 56.559ms，runtime validation P95 25.087ms，最大存档 6.746MiB。
- 百年检查点：0/20/50/100 年存档 0.702/6.319/10.312/13.359MiB；100 年模拟 P95 70.043ms，runtime validation P95 47.344ms。
- 4×/8× 各连续一分钟的 fake-clock 写盘测试均不超过 12 次，并发写入上限为 1；真实 Chromium 验证暂停后 2 秒内自动存档达到最新 turn/hash。
- 春、夏、秋、冬与同季多战均进入 BattleFact；已解散军团仍保留战前后参与者快照，Chronicle 裁剪不改变世界 hash。

## 4. Phase B — Situation 可玩纵向切片

### Goal

不等待完整 AI 重做，先让现有世界状态和 Fact 形成可持续追踪的故事线，并完成“北境军权危机”纵向切片。

### Dependencies

- Phase A Fact Bus、digest 和 Chronicle Projector 完成。
- Situation 不直接依赖 UI Event 文本。

### Tasks

- [x] **B01 — SituationState 与 reducer**：实现 `open/resolved`、`emerging/active/critical`、tension、momentum 和有界历史。
- [x] **B02 — Candidate Registry**：按 type + scopeKey 合并候选，连续两季形成，设置活跃上限和滞回。
- [x] **B03 — 军权危机检测器**：军令、主帅、野心、忠诚、中央权威、君臣关系、军中与家族支持。
- [ ] **B04 — 继承危机检测器**：君主健康、继承候选、合法性、派系、外戚和军方支持。
- [ ] **B05 — 朝堂权斗检测器**：权臣、派系结盟、清洗与中央控制。
- [ ] **B06 — 战争进程检测器**：现阶段先聚合 War/Battle Fact，不等待 Campaign。
- [ ] **B07 — 地方危机检测器**：粮食支撑季数、人口迁出、民怨与疫情，设置叙事多样性限制。
- [x] **B08 — Situation Milestone Fact**：形成、升级、降温和结案；参与者变化先保留在权威局势历史中，待需要公开时再投影。
- [ ] **B09 — 结案摘要**：起止快照、里程碑、核心人物/家族、制度与领土后果。
- [ ] **B10 — Situation 详情页**：玩家语言、历史证据、Simulation Audit 三层。
- [ ] **B11 — 历史工作台接入**：按 Situation 聚合和展开源 Facts。
- [ ] **B12 — Situation 生命周期测试**：滞回、结案、参与者死亡、政权灭亡、上限与确定性。

### Risks

- 检测器过多导致每季全表扫描。
- tension 只是另一个无意义综合分。
- Situation 没有主体行动，只成为事件文件夹。

### Controls

- 首版只做五类，检测器读取本季 Facts 和当前索引。
- 每个驱动信号必须引用字段或 Fact，UI 可展开。
- critical 必须存在有权限和资源的可执行主体。

### Acceptance Criteria

- 相同 seed 与操作序列产生完全相同的 Situation 序列。
- 每个开放 Situation 至少有两条结构证据与一个下一观察信号。
- 非决定性普通波动不产生三季内反复建档/结案。
- 所有 milestone 引用真实 Fact。
- 活跃 Situation 不超过设定上限，resolved 不再参与模拟更新。
- 完整跑通“副将立功 → 军权增长 → 朝廷反应 → 危机 → 结案”的只读故事线。

### B01/B03 Completion Evidence（2026-08-26）

- Situation 已成为 schema 4 权威状态；每季在 `appointments` 后、季度封账前消费当季 Facts 与显式索引，不读取 Chronicle。
- 军权危机要求连续两季达标、至少两条结构证据和下一观察信号；形成门槛经自然世界样本由 52 校准到 62，避免普通军职压力过早占满正式局势。
- 形成、阶段变化与结案均生成 `situation_milestone` Fact，并反向挂接到稳定 Situation ID；里程碑 Fact 必须引用更早的真实领域 Fact。
- resolved 状态冻结，开放/结案/候选/证据/参与者/变化记录均有硬上限；Phase-A schema 4 存档只从下一季开始观察，不倒推旧局势。
- `render_game_to_text` 暴露最多 12 条开放局势与 2 条近期结案，供自动化与下一轮 UI 使用；本轮没有改变当世三问、关注、自动暂停或历史工作台。
- 聚焦测试、完整 Vitest、TypeScript、生产构建、固定种子确定性/存档续推审计和桌面/移动端浏览器回归构成验收门。

## 5. Phase C — 当世三问、人物与家族真正行动

### Goal

把 Situation 变成玩家主循环，并让人物与家族从“被评分的属性”升级为有持续目标的主体。

### Dependencies

- Phase B Situation ID、milestone 与结案稳定。
- Character Agency 先 shadow，不可直接与旧行为同时写世界。

### Tasks：观察循环

- [ ] **C01 — 当世三问题源切换**：优先选择 Situation；无匹配时才回退旧裸状态线索。
- [ ] **C02 — 三问连续性仲裁**：最短保留 3 季、持续超越门槛、结案回响、多样性惩罚。
- [ ] **C03 — 关注 Situation**：观察台持久化 situation ID，而非只关注代理人物/政权。
- [ ] **C04 — 自动暂停**：milestone、phase change、核心人物死亡和结案触发。
- [ ] **C05 — QuarterPulse 局势变化**：显示升温、降温、新生和结案，不重复列普通 Facts。

### Tasks：人物 Agency

- [ ] **C06 — Desire 初始化**：八根欲望，按出身、性格、家族、经历和 seed 确定生成。
- [ ] **C07 — Goal/Plan 数据模型**：主目标 1、次目标 2、计划最多 5 步、硬失效和最短惯性。
- [ ] **C08 — PersonalMemory**：上限 16、永久 4、普通记忆聚合；保留现有有向关系记忆。
- [ ] **C09 — Agency shadow mode**：记录旧行为与新 Intent 建议差异，不改变结果。
- [ ] **C10 — Intent Buffer 与 Resolver 契约**：人物提交意图，领域检查权限、资源、关系和风险。
- [ ] **C11 — 首个计划模板**：副将“获得独立统军权”。
- [ ] **C12 — 军中支持计划**：提携、培养副将集团、家族背书、请求军令、保留军权。
- [ ] **C13 — 抗命/削权/安抚接管**：旧 refusal/purge 公式降级为可行性与风险。
- [ ] **C14 — Power Base**：军令、驻地、军中关系、家族、派系与声望共同构成起事基础。
- [ ] **C15 — 叛乱接管**：允许主帅而非只允许地方长官发起；起兵前必须有准备史。

### Tasks：成长与 LOD

- [ ] **C16 — Career Exposure**：从 Battle/Appointment/Governance/Diplomacy Facts 累积领域经历。
- [ ] **C17 — 冬季成长结算**：天赋上限、年龄、健康、能力差和年度变化上限。
- [ ] **C18 — Simulation Tier**：Core 每季、Active 触发/冬季、Background 年度聚合。
- [ ] **C19 — LOD 晋升规则**：职位、军令、家主、Situation 参与者触发；玩家关注不得触发。

### Tasks：家族

- [ ] **C20 — 家族分类迁移**：great/established/minor/legacy_household；旧 ID 不合并。
- [ ] **C21 — 家族年度战略**：保全、官职、军权、资产、联姻、继承六类。
- [ ] **C22 — 家族与成员冲突**：支持/撤回资源，不直接改写人物 Goal。
- [ ] **C23 — 家族财富语义**：接入守恒账，或更名为资产指数并禁止直接支付。
- [ ] **C24 — 新世界家族生成器**：10～15 大族、20～30 中族、总可行动家族 48～60。
- [ ] **C25 — 家族 UI**：战略、官职网络、地域席位、成员分歧和历史 Situation。

### Tasks：已知小问题

- [ ] **C26 — 人物关系方向**：人物档案默认只显示 `sourceId === currentPerson` 的“我怎么看对方”，另行展示对方态度。
- [ ] **C27 — 人物健康显示**：活人使用真实 `item.health`，不再固定显示 100。
- [ ] **C28 — 水陆副将对等**：舰队副将使用同一职业 Fact 与成长链。

### Risks

- Agency 与旧系统双重任命/叛乱。
- Goal 每季换心或所有高野心者走同一计划。
- 玩家关注影响 LOD 后改变模拟。
- 新家族生成破坏旧档或世界平衡。

### Controls

- 每个行为类型明确唯一 owner 和切换开关。
- 最短 Goal 惯性、不同欲望组合、资源与记忆约束。
- Authoritative tier 不读取 observer state。
- 新生成器仅用于新世界，旧世界只分类。

### Acceptance Criteria

- 重大意志事件的 goalId/planId/sourceFactIds 可追溯率 100%。
- 无准备且无突发硬触发的政变/叛乱为 0。
- 同 seed 读档后 Goal、Plan step 与 Intent 一致。
- 玩家关注前后，同样推进操作得到相同世界 hash。
- 新世界可行动家族在 40～70 范围，战略单人家族比例显著下降。
- 陆军与水师副将都能走“参战 → 显名 → 独立统军”链。
- 当世三问未结案题目的平均留任时间达到设计门槛。
- 桌面与移动端完整覆盖“关注一条局势 → 自动推进 → 里程碑暂停 → 结案回看”。

## 6. Phase D — 战争成为持续故事

### Goal

把“军团沿路径吃格子”升级为有目标、有主帅、有补给、有围城和结果的一段战争史，同时保持宏观模拟。

### Dependencies

- Battle/Appointment/Territory Fact 已稳定。
- 人物 Goal 可以产生战争相关 Intent。
- 现有海运、登陆和补给账本不可被绕过。

### Tasks

- [ ] **D01 — War Goal 生效**：targetRegionIds 参与路线、战果与和谈；目标失效时重评。
- [ ] **D02 — War Exhaustion**：由战损、财政、补给、时间、领土和民怨实际增长。
- [ ] **D03 — CampaignState**：集结、推进、接敌、围城、巩固、撤退/结束。
- [ ] **D04 — Campaign 主帅与军团编组**：一战通常每方 1 个，必要时最多 2 个。
- [ ] **D05 — 战略重规划**：目标失守、补给断裂、主帅死亡和援军触发。
- [ ] **D06 — SiegeState**：高城防/首都/有守军地区才创建。
- [ ] **D07 — 围城季度结算**：城粮、军粮、士气、疾病、强攻、突围、援军、投降。
- [ ] **D08 — 控制权转移门**：野战胜利不再默认立即占领有意义城市。
- [ ] **D09 — 和约结果**：目标完成度、战争分数、耗竭、赔款和控制线共同决定。
- [ ] **D10 — 海军 Campaign 接口**：登陆和封锁形成 Campaign milestone，不做即时海战。
- [ ] **D11 — 战争 Situation**：由 Campaign、Battle、Siege 和 Peace Facts 驱动。
- [ ] **D12 — 战争 UI**：目标、阶段、主帅、战线、补给、最近转折和下一观察。
- [ ] **D13 — 战争统计审计**：时长、胜负、弱者逆袭、围城比例、永久战争和目标完成率。

### Risks

- 每个地区都围城导致战争停滞。
- Campaign 与旧 processMilitary 双重移动。
- 新层级破坏海运和人口/粮食守恒。

### Controls

- 无城防、无守军和低战略节点允许快速占领。
- Campaign 分阶段接管旧军事流程，每次只迁移一个阶段。
- 所有损失继续写现有 TurnReport 账本并跑 invariant。

### Acceptance Criteria

- 高城防重要城市的大多数控制权变化前至少有一季 Siege。
- 每次领土转移都能追溯到投降、占领、登陆或政治交接 Fact。
- 围城人口、粮食、财富与军队损失全部守恒。
- 战争目标实质改变路线、战果与和约。
- 所有 Campaign/Siege 在战争结束后关闭，无悬空引用。
- 强军优势来自兵力、训练、补给和主帅；弱军逆袭必须能展示地形、时机、情报或补给证据。

## 7. Phase E — 长期世界、档案与 Scenario

### Goal

让世界可靠运行 100～300 年，并通过宏观开局增加重玩性，而不是用新系统掩盖平衡问题。

### Dependencies

- Situation、Agency 和 Campaign 已能生成稳定 Fact。
- 先有 100～300 年真实体积与性能报告。

### Tasks

- [ ] **E01 — Simulation Quality Audit 框架**：正确性与“是否有趣”分开报告。
- [ ] **E02 — PR/Release/Nightly 分层种子矩阵**：8×80、32×200、100×400、12×1200 季。
- [ ] **E03 — Narrative Metrics**：密度、人物流动、王朝更替、Situation 多样性、统治集中度。
- [ ] **E04 — Story Coverage**：核心人物无故事比例、副将路径、家族兴衰、三问留任和换题。
- [ ] **E05 — Active/Cold Archive**：按年或四年分块 Fact/Chronicle，活动世界只保留热数据。
- [ ] **E06 — Archive Digest 与 portable export**：缺块/篡改可检测，历史工作台渐进加载。
- [ ] **E07 — 分支共享旧史**：内容寻址块避免复制世界时重复全部古代档案。
- [ ] **E08 — ScenarioConfig**：宏观开局与系统权重，完全独立于 seed。
- [ ] **E09 — 群雄并起正式化**：把当前默认世界改成 Scenario，而不是特殊 seed 文案。
- [ ] **E10 — 大一统末世**：统一帝国、老君主、低权威、地方军门和财政压力。
- [ ] **E11 — 海贸时代**：高港口/商业/海权权重与输入性疾病风险。
- [ ] **E12 — 平衡回归**：疾病、战争、继承、海权在三问中的占比和世界长期形态。
- [ ] **E13 — Worker 决策复测**：只有超过移动端预算才立项。

### Risks

- 冷档案使导出、分支和历史搜索复杂。
- Scenario 变成脚本剧情。
- 自动化指标被优化成“数据好看但不好玩”。

### Controls

- 档案块有 digest、兼容适配器和可恢复错误提示。
- Scenario 只提供初始条件，不指定人物结果与固定年份事件。
- 每个 Release Audit 搭配人工 50 年故事复述测试。

### Acceptance Criteria

- 100、200、300 年世界都能保存、读取、导出、继续推演并保持确定性。
- 季度成本不因加载全部冷史而线性增长。
- 同 Scenario 不同 seed 产生明显不同历史；相同 Scenario + seed + 操作完全一致。
- 人工测试者在 50 年后能复述至少 5 段有起因、转折和结果的故事。
- 世界不在大多数种子中陷入永恒和平、永久战争或永久超级帝国。

## 8. Phase F — UX、地图 LOD 与发布打磨

### Goal

让新深度首先以“历史”被理解，而不是让玩家阅读新一批数字和调试面板。

### Dependencies

- Situation、Agency、Campaign 和 Archive 的读取接口冻结。

### Tasks

- [ ] **F01 — 世界首页改为“正在形成的时代”**：突出 2～4 条 Situation，而不是所有对象平铺。
- [ ] **F02 — 经济语义卡**：粮食支撑季数、风险州、死亡来源、军费支撑季数。
- [ ] **F03 — 三层因果抽屉**：玩家语言、证据、Simulation Audit。
- [ ] **F04 — 地图 Overview LOD**：国家、首都、最大军团、战争、重大 Situation。
- [ ] **F05 — 地图 Regional LOD**：地区、港口、军团、舰队、Campaign、参与区。
- [ ] **F06 — 地图 Local LOD**：全州名、Siege、商路、迁徙、疫情和关键人物。
- [ ] **F07 — LOD 命中契约**：不可见对象没有点击热区；阈值有滞回。
- [ ] **F08 — 人物档案**：真实 Desire/Goal/Plan、阻碍、最近转折和定向关系。
- [ ] **F09 — 家族档案**：跨代时间轴、家族战略、成员冲突和官职网络。
- [ ] **F10 — 战争档案**：War → Campaign → Battle/Siege 的可折叠阅读。
- [ ] **F11 — Situation 结案卡与时代命名**：结案后进入人物传记、家族史、国史和世界史。
- [ ] **F12 — 史家预测（P2）**：预测不进世界 hash，结案时验证。
- [ ] **F13 — 390×844 移动端全流程**：Situation、人物目标、战争、史册、缩放与安全区。
- [ ] **F14 — Safari/Firefox 发布矩阵**：存档、Canvas 手势、IndexedDB 和焦点管理。
- [ ] **F15 — 新手引导重写**：从“读地图”升级为“关注一条局势并看完第一次转折”。
- [ ] **F16 — 试玩访谈与遥测问卷**：玩家是否知道现在看什么、为何暂停、下一步等什么。

### Acceptance Criteria

- 新玩家 3 分钟内能关注一条 Situation 并说明其当前矛盾。
- 推进一季后能找到“上一季变化”和“下一观察”。
- 默认界面不直接展示 Utility、Threshold 等审计数值。
- 地图三层 LOD 在桌面与移动端均有视觉/命中自动化测试。
- 查看、筛选、关注、预测和地图操作不改变世界 hash。
- 发布矩阵的控制台错误为 0，键盘、触控和焦点路径可用。

## 9. 立即执行的下一 Sprint

第一轮 Phase A 最小闭环已经按以下顺序完成；下一轮从第 10 项开始：

1. [x] A01：端到端性能埋点与 0/20/50/100 年基线。
2. [x] A02：schema 4 迁移夹具与 legacy boundary。
3. [x] A03：Turn Fact Buffer。
4. [x] A04：BattleFact，覆盖春季与同季多战。
5. [x] A06：副将成长改读 Fact。
6. [x] A07：Chronicle Projector 双写，证明展示裁剪不影响 hash。
7. [x] A09/A10：Runtime/Full Validation 分离。
8. [x] A11：AutosaveCoordinator。
9. [x] A12：完整 release regression。
10. [x] B01/B02/B03/B08：建立 Situation reducer、候选滞回、军权危机检测器和里程碑 Fact，暂不扩类型。
11. [ ] 下一纵切：从 B04 继承危机或 B06 战争进程中只选一类，复用同一 reducer、证据与审计门。

这一 Sprint 的演示目标只有一句话：

> 春季发生的一场未入世界史的小战，仍然会成为副将真实经历，并在后续形成一条可持续追踪的军权危机。

## 10. 每个任务的 Definition of Done

任何任务只有同时满足以下条件才算完成：

- 有权威数据 owner，未产生第二条隐式真相来源。
- 相同 seed 与操作序列完全确定。
- 有单元/系统测试覆盖正常路径和至少一个失败路径。
- 存档迁移、保存续推和旧档读取有对应测试。
- 不把 observer state 写入世界 hash。
- 新增可增长列表有明确上限、摘要或冷归档策略。
- 玩家默认看到历史语言，审计数值需要主动展开。
- `npm run test:run`、`npm run build`、浏览器 E2E 和对应长期审计通过。
- `progress.md` 记录本轮决策、风险和下一位开发者入口。

## 11. 暂时不要开始的任务

- 不先做更多 Situation 类型。
- 不先做完整围城 UI。
- 不先增加宗教、文化、资源、兵种或地图。
- 不先重写整个 `engine.ts` 或迁移完整 ECS。
- 不先合并旧存档中的同姓家族。
- 不先让所有 200 名人物运行完整 Goal/Plan。
- 不先接入 LLM 叙事或 NPC 决策。
- 不在完成性能复测前引入 Worker。

下一阶段的成功不是“任务全部铺开”，而是每一阶段都能独立试玩、独立验证，并且让同一个世界比上一阶段更容易被理解和记住。

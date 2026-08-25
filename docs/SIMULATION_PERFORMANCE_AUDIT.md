# 《沧衡纪》vNext 模拟性能审计

> 审计日期：2026-08-25
> 审计基线：V1.0 / schema 3 / commit `b350438`
> 性质：只读审计；没有为了得到数据修改模拟代码

## 1. 执行结论

当前引擎在 20～50 年尺度仍能稳定运行，问题还没有严重到必须立刻使用 Web Worker。已经确认的优先热点是：

1. UI 每季在 `advanceWorld` 之后执行完整 `validateWorld`，重复扫描全部历史。
2. 380ms autosave debounce 在 1×～4× 下接近每季完整序列化，8× 下又可能持续饥饿直到暂停。
3. 存档和完整校验成本随历史、人物、关系和归档实体增长。
4. `cloneWorld` 每季深拷贝全部人物传记、关系记忆和已结束领域对象；这是中长期风险，但还不是第一刀。

正确顺序是：先测量完整用户链路，再拆运行时校验、重做自动保存、建立 Fact/Archive 边界，最后根据目标移动设备数据决定是否 Worker 化。

## 2. 测量结果

### 2.1 现有多种子审计

命令：`V03_AUDIT_TURNS=80 V03_AUDIT_DETERMINISM_TURNS=24 npm run test:audit:v03`

| 指标 | 结果 |
|---|---:|
| 种子 × 季度 | 4 × 80 |
| Tick 数 | 320 |
| `advanceWorld` P50 | 45.917ms |
| `advanceWorld` P95 | 56.99ms |
| 最大单 Tick | 262.03ms |
| 最大存档 | 4.348MiB |
| 守恒/引用失败 | 0 |

注意：`scripts/v03-audit.ts` 的 Tick 计时只包住 `advanceWorld`，不包含 UI 随后调用的 `validateWorld`、React commit、Canvas 绘制、序列化或 IndexedDB 写入。

### 2.2 浏览器完整校验与序列化样本

在本机 Chromium 中动态导入真实 `src/sim` 模块，逐季运行 `advanceWorld → validateWorld`，并在检查点序列化完整世界。

样本 A：

| 季度 | 历史数 | 人物数 | 家族数 | 关系数 | 存档字节 | 序列化 |
|---:|---:|---:|---:|---:|---:|---:|
| 20 | 617 | 198 | 172 | 192 | 2,046,054 | 15.9ms |
| 40 | 1,298 | 212 | 173 | 279 | 3,251,949 | 27.7ms |
| 80 | 2,238 | 234 | 173 | 441 | 4,785,136 | 39.6ms |

该样本 80 季内：

- `advanceWorld` P50 34.0ms，P95 42.0ms。
- `validateWorld` P50 35.9ms，P95 51.9ms。
- 最后一季 `advanceWorld` 36.6ms，随后完整校验 51.3ms。

这说明 UI 的真实季度成本不是审计报告里的 42～57ms，而是还要加约 36～52ms 完整校验以及渲染。

样本 B 的长检查点：

| 季度 | 历史数 | 人物数 | 家族数 | 关系数 | 存档字节 | 完整校验 | 序列化 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 80 | 2,036 | 233 | 172 | 411 | 4,471,306 | 53.2ms | 35.6ms |
| 160 | 3,096 | 268 | 182 | 642 | 6,152,665 | 67.8ms | 52.6ms |

不同种子不能直接比较绝对增长率，但两个样本都证明完整校验、关系数量和存档大小会随世界年龄上升。

### 2.3 家族结构附带数据

样本 A 开局有 172 个家族，其中 164 个是单人家族，占 95.3%，最大家族只有 5 人。这不仅是玩法问题，也意味着未来若给每个家族增加 Goal/Plan，成本会被大量无意义单人实体放大。

## 3. 已确认热点

### 3.1 每季完整历史校验

调用链：

```text
App.advanceOne
→ advanceWorld
→ assertValidWorld
→ validateWorld
```

相关位置：

- `src/App.tsx` 的 `advanceOne`。
- `src/sim/invariants.ts` 的 `validateWorld` 与 `assertWorld`。

`validateWorld` 会：

- 为完整 history 建集合和索引。
- 遍历所有历史事件、参与者、证据和差量。
- 从头重新计算 `historyDigest`。
- 对每个 `deputy_promoted` 再执行 `history.some` 查战斗证据，最坏可接近 O(H²)。
- 最后再次计算世界 hash。

`historyDigest` 在 `pushEvent` 中本来已经增量维护，因此生产每季重算全文抵消了这项优化的一部分。

#### 方案

- 保留当前完整验证，改名或明确为 `validateWorldFull`。
- 增加 `validateTurnRuntime(previous, result, turnArtifacts)`：只验证本季变化、引用、账本、Fact/Event digest 和 hash。
- 创建、读取、导入、手动保存、测试和 release audit 继续跑完整验证。
- 开发模式可每 16 或 32 季抽样执行完整验证。

#### 验收

- Runtime validator 不迭代完整 history/fact archive。
- 篡改当季人口、粮食、财富、Fact 引用、状态差量和 digest 都会失败。
- 第 20 年与第 300 年 runtime validation 成本处于同一数量级。

### 3.2 Autosave 调度

当前 `src/App.tsx` 对每次 world 变化建立 380ms timer，随后执行：

```text
stableStringify(world)
→ TextEncoder 计算大小
→ JSON.parse 提取摘要
→ IndexedDB put
```

速度影响：

- 1× / 2×：几乎每季保存。
- 4×：季度间隔约 450ms，基本每季保存 4～7MB。
- 8×：季度间隔约 225ms，timer 不断取消，长时间推演可能直到暂停才保存。
- 已开始的异步写入没有全局 single-flight；慢设备上可能出现写入重叠或旧快照晚完成。

#### AutosaveCoordinator

- 世界变化只设置 dirty generation。
- 满足“距离上次至少 8 季”或“距离上次至少 5 秒且浏览器 idle”时保存。
- 暂停、切到后台、打开新世界、天意干预和显式退出时 flush。
- 任意时刻最多一个保存任务。
- 保存期间继续推进只保留最新待保存 generation，不排队保存每个中间世界。
- 失败保留 dirty，指数退避并提示“保存至第 N 季”。

#### 验收

- 4× / 8× 连续运行一分钟，自动写入不超过约 12 次。
- 同时写任务始终不超过 1。
- 8× 不会一直零保存；暂停后 2 秒内保存到最新季度。
- 保存失败后下一次成功不会回写旧季度。

### 3.3 Clone 与反复查找

`cloneWorld` 每季深拷贝：

- 82 个地区及其嵌套字段。
- 全部人物和最多 80 条人物传记。
- 全部关系和各自记忆。
- 家族、派系、官职、承诺、战争、舰队、疾病和实践。
- 完整 history 数组本身，虽然 HistoryEvent 对象是共享的。

领域逻辑又大量使用数组 `.find()`。在当前规模尚能运行，但加入 Goal、Plan、Fact 和 Situation 后不应继续复制同样模式。

#### 渐进方案

1. 每季建立一次 EntityIndex，传给系统，替代热点内层 `.find()`。
2. 静态地图定义与动态 RegionState 分离并共享。
3. 已结束战争、官职、承诺和派系转入冷档案，活动数组只保留决策所需对象。
4. 给 `cloneWorld` 分阶段埋点，确认人物、关系还是疾病/实践占主导。
5. 仅在数据证明有收益后引入 collection-level copy-on-write；不立即迁移 ECS 或 Immer。

### 3.4 历史与存档上限

当前存档硬限制为 16MiB。20 年样本已约 4～4.8MB，40～50 年约 6～7MB。不能基于当前测试声称稳定支持 100～300 年。

#### 中期架构

```text
Active World Snapshot
  + Current open archive chunk
  + Immutable yearly/four-year Fact chunks
  + Compact Chronicle index
  + factDigest / historyDigest / archiveDigest
```

- 自动保存只重写活动快照和当前未封口块。
- 已封口块内容寻址，可被分支共享；复制世界不重复复制全部旧史。
- Portable export 可以打包全部块，普通继续游戏不每季 stringify 整个古代史。
- 热世界保留近期完整 Fact；旧 Fact 的常用查询进入紧凑索引和 Situation 结案摘要。

#### 验收

- 100、200、300 年分别有存档大小和读写耗时门禁。
- 缺失或篡改历史块会被 digest 检出。
- 历史工作台可以渐进加载，当前季度推进不等待旧块。
- 分支仍能在相同 seed 和权威状态下确定性续推。

## 4. 性能预算

| 指标 | 桌面目标 | 中档移动设备目标 |
|---|---:|---:|
| 模拟 + runtime validation P95 | <75ms | <130ms |
| 单次 React/Canvas 可交互更新 P95 | <32ms | <50ms |
| 输入响应 | <100ms | <120ms |
| 自动保存主线程长任务 | <50ms | <80ms |
| 8× 任务积压 | 0 持续积压 | 0 持续积压 |
| 50 年本地档案 | <8MiB | <8MiB |
| 300 年 portable archive | 设专项门禁，默认不得超过当前导入上限 | 同左 |

存档 300 年目标可能需要压缩或分块后重新设定；在架构实现前不承诺仅靠当前单 JSON 达成。

## 5. Worker 决策门

只有完成 Runtime Validation、AutosaveCoordinator、EntityIndex 和历史分块后，满足任一条件才引入 Worker：

- 目标移动设备 100 年世界的季度 P95 仍大于 130ms。
- 连续 8× 出现超过 2% 的 >100ms Long Task。
- Canvas/React 主线程即使不做模拟仍无法及时响应触控。

Worker 若启用，只移动确定性 Simulation Engine；UI 继续持有只读快照。协议必须传递 `previousHash + action + nextHash + turnArtifacts`，不能每帧双向传整个历史档案。

## 6. 性能任务顺序

1. 增加端到端 phase profiler。
2. 拆 runtime/full validation。
3. 实现 AutosaveCoordinator。
4. Fact Bus 同时提供 changedIds，减少运行时校验扫描面。
5. 建 Turn EntityIndex。
6. 归档已结束领域对象。
7. 做 100～300 年档案门禁与分块。
8. 复测后决定 Worker。

这套顺序的原则是：先消除已经证实的重复工作，再处理推测中的架构瓶颈。

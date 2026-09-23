# 基线指标方案 · 认识你自己 | Know Yourself

> 起草：2026-09-17 ｜ 状态：已批准（2026-09-17）· **P0 已实施（2026-09-17）**：白名单扩展、客户端 P0 事件、/privacy 同步、`npm run metrics:report` 与 `npm run test:metrics`（已挂进 `npm test` 链尾）均已落地 · **P1 已实施（2026-09-23）**：四个延续信号全部落地（第五节实施注记），报告脚本新增延续率读数，/privacy 枚举已同步
> 关联：PRODUCT.md（北极星与基线指标原文定义）、MARKET_RESEARCH.md（决策依据）、ROADMAP.md
> 原则一句话：**所有"人"的判断都在浏览器本地完成，服务器只接收 +1。**

## 一、为什么现在做

- PRODUCT.md 自认：目前只有结果图像帮助度一种聚合计数，**没有完整的行为漏斗与留存基线**。
- 北极星（28 天有意义回访率）从开始记录之日起需 **28 天**才能读出第一个数——每晚一周部署，基线就晚一周。这是全项目时间最敏感、成本最低的一件事。
- MARKET_RESEARCH.md 的所有增长建议（小红书/知乎/SEO/开发者渠道）都要有基线才能验证成败。本方案必须**赶在任何推广内容发布之前**上线。

## 二、隐私红线（不可协商）

1. 只用第一方聚合计数：落库进 `aggregate_events` 按（事件、实体、值、日）累加，**不存任何用户级标识**——无账号 id、无 attempt id、无 cookie、无指纹、无第三方脚本。
2. 服务器**永远无法把两次事件关联到同一个人**：漏斗推进、28 天回访判定等"人"逻辑全部在客户端用本机已有的 Storage v3 数据计算，客户端只在判定成立时发一个匿名 +1。
3. 答案、结果内容、札记正文永不进入指标事件。
4. `/privacy` 现有承诺（无第三方 analytics、无行为画像）不变；新增事件后**必须同步更新该页枚举**（见第六节），这是发布门槛项。

## 三、现有基础设施盘点（本方案零新表）

| 设施 | 现状 | 本方案用法 |
| --- | --- | --- |
| `aggregate_events` 表 | (event_name, entity_type, entity_id, value, event_day, event_count) 日粒度计数器，PK 防重 | 唯一落库位置，直接复用 |
| `/api/metrics/event` 路由 | 已有：`assertTrustedMutation` 来源校验 + `allowRateLimitedRequest(request, "aggregate-event", 12)` 每分钟 IP 限流（键存 SHA-256） | 扩展事件白名单；限额评估见第九节 |
| `recordAggregateEvent()`（src/lib/server/journal.ts） | 白名单仅 `quiz_visual_helpfulness`，visualKey 走 `^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$` 校验 | 按第五节白名单扩展，维度校验沿用同一正则 |
| Storage v3 | attempts 含 timestamp、bookmarks、sessions | 北极星判定的数据源，**快照协议一字不动** |
| `day()` 助手 / `request_rate_limits` 表 | 已有 | 沿用 |

## 四、北极星的可计算化定义

PRODUCT.md 原文：28 天内在**至少两个不同日期**完成"有意义反思"的人占比；有意义反思 = 完成一次测评，且包含至少一次有意的延续动作（私密保存、记录下一步、回顾/对比历史、开始关联测评）。

**v1 实现口径分两档，都只发匿名计数：**

| 档 | 延续动作的判定 | 说明 |
| --- | --- | --- |
| P0 严格版（上线即有） | "另一个日期又完成了一次测评"——开始并完成任一测评是最强的延续动作 | 仅凭 attempts 时间戳即可判定，零新增本地状态 |
| P1 完整版（次周补齐） | 额外识别：访问历史页、重看 28 天内的旧结果、新增收藏、创建札记草稿 | 重看旧结果与历史页访问用现有数据即可判定；收藏与札记补为延续信号 |

**计数设计（关键：每台设备对分子、分母各最多贡献一次）：**

- `baseline_cohort`：本设备完成**首个**测评时 +1（设备进组，即分母）。
- `baseline_return`：本设备首次满足"完成日后 0 < 延续动作日 ≤ 28 天"时 +1（value = 首次达成的延续类型 + 间隔桶）。
- 北极星（滚动 28 天）≈ Σ `baseline_return` ÷ Σ `baseline_cohort`。每台设备对两个计数各最多 +1 一次，比率天然逼近"人"口径。

"每设备一次"由本机 ping 账本保证（第五节）；清浏览器数据会被视为新设备——接受，见第九节。

## 五、事件设计（完整白名单）

**维度编码**：`entity_id` = 测评 id 或路由类；`value` = 复合维度串，格式 `lang:设备类[:长度桶]`，如 `zh:mobile:medium`。设备类用 matchMedia 断点（≤768px 为 mobile，否则 desktop），语言取本地 preferences，长度桶按题量 ≤10 / 11–30 / >30（客户端从 definition 算）。

| event_name | entity_type | entity_id | value | 触发点（客户端） |
| --- | --- | --- | --- | --- |
| `route_view` | route | home / catalog / detail / result / history / bookmarks / journal / community | lang:device | 对应页面首次有效渲染（useEffect 挂载即发，账本去重） |
| `quiz_start` | quiz | quizId | lang:device:bucket | 答题页挂载并渲染第一题 |
| `quiz_complete` | quiz | quizId | lang:device:bucket | 结果算出且 attempt 已写入本机 |
| `result_read` | quiz | quizId | lang:device | 结果正文滚动到底（"读完了"的理解代理信号） |
| `baseline_cohort` | cohort | （空） | lang:device | 本设备首个完成，设备一生一次（账本） |
| `baseline_return` | cohort | （空） | 延续类型:间隔桶（1d / 2-7d / 8-28d） | 首次达成 P0/P1 延续判定 |
| `quiz_visual_helpfulness` | quiz_visual | quizId | visualKey:helpful | 已有，不变 |
| `ai_insight` | quiz_ai | quizId（实验期仅 `attachment-style`） | requested / generated / failed / helpful / not_helpful | 实验位：结果页「另一个视角」卡片的点击、生成成败与好评计数，走同一聚合计数接口 |

**P1 追加的延续信号**（均带"本机 28 天内有过完成"的前置判定，判定不成立就静默不发）：`continuation_history`、`continuation_result_revisit`（重看完成日 ≠ 今天的旧结果）、`continuation_bookmark`、`continuation_journal_draft`（登录用户此事件由服务端在创建草稿时自记，不经客户端）。

> **P1 实施注记（2026-09-23）**：三个客户端信号的 28 天窗口判定在浏览器本地完成（`latestReturnWindowCompletion`：完成日须早于今天且 ≤28 天，与 P0 回访判定同窗口同口径），经同一 ping 账本按"每设备每事件每天最多一次"去重，事件维度为 `continuation` 类型 + `lang:device` 值；`continuation_journal_draft` 在 `createJournalEntry` 服务端动作内判定——前置条件=账号云端的最近一次完成在 1–28 天窗口内（UTC 日距），去重=该账号当天还没有创建过草稿（读的是业务动作本就持有的行，不新增任何用户级状态），计数本身仍是无标识的日粒度 +1（value 留空，服务端不掌握语言/设备维度），且**不出现在公开事件白名单**，客户端永远无法伪造投递。`baseline_return` 维持 P0 严格口径（value 仅 `completion:*`），避免把服务端可记的信号混进客户端一次性账本造成口径不对称；P1 的延续率按第六节公式 Σ `continuation_*` ÷ Σ `quiz_complete` 独立读出。

**本机 ping 账本**：独立 localStorage 键 `know-yourself:v3:metrics-pings`（不动 Storage v3 快照），结构 `{eventKey: lastDay}`。用途：① 同设备同日同事件去重（route_view、quiz_start 等，重开页面/换标签不重复计数）；② `baseline_cohort` / `baseline_return` 的设备一次性。账本内容永不外发。

**漏斗比率的诚实声明**：详情→开始→完成等转化率按"同日聚合计数相除"近似。服务器不做人级链接，单人跨步骤（上午看详情、晚上完成）会稀释比率；滚动 7 天平滑后足以判断基线趋势，不用于精确单人归因。这是隐私换精度的自觉取舍，与产品定位一致。

## 六、基线指标映射（PRODUCT.md 七项 → 事件公式）

| PRODUCT.md 指标 | 公式（滚动 7 天近似） |
| --- | --- |
| 北极星：28 天有意义回访率 | Σ `baseline_return` ÷ Σ `baseline_cohort`（滚动 28 天） |
| 发现 → 详情 | Σ `route_view(detail)` ÷ Σ `route_view(home)+route_view(catalog)` |
| 详情 → 开始 | Σ `quiz_start` ÷ Σ `route_view(detail)` |
| 开始 → 完成（按长度/语言/设备分） | Σ `quiz_complete` ÷ Σ `quiz_start`，value 三段天然提供全部分段维度 |
| 结果理解与深度 | Σ `result_read` ÷ Σ `quiz_complete`，辅以已有图像帮助度反馈 |
| 结果 → 有意私密延续率 | P0 用 `baseline_return` 的 1d 桶近似；P1 补齐为 Σ `continuation_*` ÷ Σ `quiz_complete` |
| 7 天 / 28 天内第二日回访 | `baseline_return` 的间隔桶分布（1d / 2-7d / 8-28d） |

## 七、报告与验证

- `scripts/metrics-report.mjs` → `npm run metrics:report`：只读连 SQLite，输出滚动 7/28 天的各漏斗计数、转化率、北极星与图像反馈汇总。先做 CLI 报告，不为内部数据扩 admin 界面。
- `scripts/test-metrics.mjs` → `npm run test:metrics`：干跑校验——事件白名单、维度编码合法性、账本去重、限流命中，沿用现有 test:* 脚本模式，并挂进 `npm test` 链。
- 上线 checklist：`$env:NODE_ENV=''; npm test` 全绿 + `npm run typecheck` + `npm run lint` + `npm run build`（本机全局 NODE_ENV=production 的坑见项目记忆，跑测试前先清）。

## 八、阶段计划

| 阶段 | 内容 | 时间 |
| --- | --- | --- |
| P0 | 白名单扩展 + route_view / quiz_start / quiz_complete / result_read + cohort/return 严格版 + /privacy 文案同步 + report/test 两脚本 | 评审通过后一周内，**赶在任何推广发布之前** |
| P1 | 四个 continuation 信号 + 札记服务端计数 | P0 后一周 |
| P2 | 第一次北极星读数（P0 上线满 28 天），据此裁决 PRODUCT.md 第二阶段命题（历史/对比/关联测评是否提升回访）与社区扩张证据 | P0 上线后第 4 周 |

## 九、已知局限与实施注意（接受的风险）

1. 清 localStorage = 新"设备"，分子分母重算 → 轻微高估；无 cookie 无法根治，接受。
2. 同人多设备 = 分身，各自计一次 → 偏差方向不定但量级小，接受。
3. 爬虫与预取可抬高 route_view；useEffect 挂载 + 账本去重可挡大部分，残余噪音靠按天平滑，接受。
4. 漏斗按天比率是近似（见第五节声明）：趋势可用，单人归因不可用。
5. 现行 `aggregate-event` 限流为每分钟 12 次：一次深度访问可能连发 5–6 个事件，实施 P0 时需上调该 action 限额（如 30/分钟）或按事件类别分 action，避免真实用户被 429。
6. 指标缺失不阻塞功能发布：可靠性、无障碍、隐私、性能仍是发布门槛（PRODUCT.md 原则），本方案只补"可测量"这一块地基。

# Know Yourself · 架构一页图

**更新：2026 年 9 月 20 日**

> 这是一份写给项目所有者的事实地图：只描述现状，不描述愿景。
> 维护契约：任何架构变更必须同步更新本文档，改代码不改图视同破坏契约。

## 总纲

一个 Node 进程服务所有页面和接口，一个 SQLite 文件存所有数据，一个媒体目录放图片，一个 worker 进程加工图片，一条 CI 流水线看守发布。**就这五样，没有第六样。**

## 运行时：四块 + 一扇门

```
浏览器（用户）
   | HTTPS
   v
Caddy「门卫」 —— 域名 knowyourself.cc.cd 的证书自动续期，
   |             只把请求原样转给本机 3333 端口
   v
Node 主进程（Next.js 应用，systemd 守护，端口 3333）
   |
   |-- 页面：React 在服务器端把 HTML 先拼好再发，浏览器接管交互
   |-- 接口：src/app/api/ 下 37 个路由——登录、社区 feed、札记、举报、聚合计数、AI 视角实验（quiz-insight，实验位）……
   |
   |-- 读写 --> SQLite 单文件（/var/lib/quiz-platform/app.sqlite3）
   |            账号、云端测评历史、札记修订、互动、治理审计、配额
   |            ——全在这一个文件里。没有独立的数据库服务器。
   |
   `-- 上传 --> 媒体 worker（scripts/media-worker.mjs）
                 校验（JPEG/PNG/WebP、8 MiB、25 MP）→ 旋转归正 → 转 sRGB
                 → 剥 EXIF/GPS（隐私：拍摄设备与位置不外泄）
                 → 生成 320/960/1600 三档 WebP
                 v
              媒体目录 /var/lib/quiz-platform/media/（原图不保留，只留变体）
```

各块一句话：

- **Caddy**：唯一的公网入口。负责 HTTPS 证书与反向代理，本身不懂业务。
- **主进程**：页面和接口都在这个进程里，Next.js 单体。
- **SQLite**：一个文件就是整个数据库；备份的本质是拷文件（WAL 模式，拷前要 checkpoint）。
- **媒体 worker**：独立常驻进程，唯一职责是把上传的图片变成安全、尺寸分档的变体。

**边界（容易混淆处）**：同一台 VPS 上还住着机器人栈与运维台——它们与本项目**没有任何代码或数据关联**，只是共享机器和 Caddy 这个入口。两套 SQLite 是两个文件、两个世界。

## 代码地图（东西在哪）

| 位置 | 是什么 |
|---|---|
| `src/app/` | 页面 + 接口，URL 与文件夹一一对应（assessments / test / quiz / result / journal / community / account / history / bookmarks / settings / admin / complaints / api） |
| `src/components/` | UI 零件，分 shell / quiz / result / journal / community 五组 |
| `src/core/quiz/` | **评分引擎**：纯逻辑，不懂界面；type / dimensions / score 三类算法 |
| `src/lib/test-registry.ts` | 193 个测评模块的唯一元数据入口 |
| `src/lib/storage.ts` | 浏览器本地库（游客测评数据住这里） |
| `src/lib/server/` | 服务端重活：database（SQLite 门面）、journal、governance、email、badges、ai-insight（实验位：结果页 AI 组装卡，key 留空即隐藏） |
| `tokens.css` + `globals/rebuild/refactor.css` | 视觉系统：tokens 是配色字典，三个 css 是三个年代的皮肤层（待蒸馏为一层） |
| `scripts/` | 14 个测试套件 + 媒体 worker + 打包脚本 |
| `deploy/` | 生产部署的单元与运维说明 |

## 数据的「本地优先」双工

游客答题 → 结果只存**用户浏览器自己的库**（IndexedDB，Storage v3）；注册登录后本机数据与云端自动**合并**；原始答案永不上云，云端只存结果摘要。账号删除通过墓碑机制清理云端与媒体数据。

## 发布链路（代码怎么变成线上）

```
改代码 → commit 到分支
→ CI 八道关：依赖审计 → lint → typecheck → 14 套测试 → 旗舰审计 → a11y 审计 → 构建 → standalone 打包
→ 全绿 → 受限部署用户发布到 VPS → systemd 重启进程
```

**关键规则：main = 线上。** 功能分支不推 main，线上就纹丝不动；推了 main、CI 全绿，才会上线。

## 安全网与已知裂缝

- `npm test` 14 套件兜底（本机运行前须清空 `NODE_ENV`——本机全局变量污染是环境坑，非代码问题）。
- 数据库 / 媒体 / 删除墓碑每日一致性快照，滚动保留 30 天；**不是**异地容灾，主机或磁盘损坏不可恢复。
- 已知结构性裂缝：生产环境若缺 `BETTER_AUTH_SECRET` 环境变量，构建仍然全绿，但登录与社区接口会 500。修复项排第一。

## 所有者自测（不看图回答，答出即入账）

1. 一张图片从用户点「上传」到别人看见，路过了哪几站？
2. 改一行代码到用户看到变化，路过了哪几站？
3. 一条测评答案，游客时存在哪？登录后呢？

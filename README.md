# NPUArena demo

本地演示站，包含静态榜单前端和账号 API。顶部把 **Benchmarks**（可按固定协议评测的任务）与 **Leaderboards**（已有项目的成绩榜）分开，并按训练加速、推理加速、算子加速分类。目前还没有正式发布的自动评测 Benchmark；Leaderboards 展示 [`zhaoyiyidan/modded-nanogpt-npu`](https://github.com/zhaoyiyidan/modded-nanogpt-npu)、[`YChen-zzz/cifar10-airbench-npu`](https://github.com/YChen-zzz/cifar10-airbench-npu) 和 [`YChen-zzz/nanoVLM-npu`](https://github.com/YChen-zzz/nanoVLM-npu) 的仓库成绩。三个榜单的硬件、质量门槛与计时范围各自独立，不跨榜单混排。

首页使用线路板动画和完整 NPUArena 名称作为主视觉。NanoGPT 榜单页面分为概览、数据与模型、评测规则、提交、排行榜。正式提交仍走 GitHub PR。站内可查询公开 PR 的 GitHub 状态。

Benchmarks 与 Leaderboards 目录各有“创建”入口。创建 Benchmark 可保存本机任务草稿；创建 Leaderboard 可填写比较口径、提交方式、审核方式及可选的首条成绩，并在本机查看、编辑草稿。“接入已有榜单”是单独的来源映射流程。上述草稿仍保存在浏览器 `localStorage`，不随账号同步，也未公开发布。注册、登录和退出已由服务端处理；没有自动导入服务或 NPU 评测后端。

## 本地运行

在项目根目录运行 `python server.py --host 127.0.0.1 --port 4173`，然后打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。第一次启动会自动创建 `data/npuarena.sqlite3`；该文件已被 Git 忽略。使用原来的 `python -m http.server` 只能浏览静态页面，无法注册或登录。

主要入口：`/#/benchmarks`、`/#/create`、`/#/leaderboards`、`/#/leaderboards/new`、`/#/import`、`/#/nanogpt`、`/#/airbench`、`/#/nanovlm`、`/#/account/register`。前端仍是无构建步骤的 HTML、CSS 与 JavaScript，修改后刷新浏览器即可查看。

## 账号与数据库

`server.py` 提供同源的 `/api/auth/register`、`/api/auth/login`、`/api/auth/logout` 和 `/api/auth/me`。`database.py` 在 SQLite 或 PostgreSQL 中保存用户、密码哈希和会话。密码经随机盐和 scrypt 计算后入库，明文不会写入数据库或浏览器存储。浏览器收到的是 7 天有效、`HttpOnly`、`SameSite=Lax` 的会话 Cookie；数据库只保存会话令牌的 SHA-256 摘要。退出登录会删除会话。注册和登录有限次尝试限制。

本地默认使用 SQLite，不需额外安装依赖。部署时可配置 `DATABASE_URL` 使用 PostgreSQL，并先执行 `pip install -r requirements.txt`。示例见 [`.env.example`](.env.example)；实际凭据应放在部署环境中，不要提交到仓库。使用 HTTPS 时设置 `PUBLIC_ORIGIN=https://你的域名` 和 `COOKIE_SECURE=true`，并让反向代理转发原始 Host。数据库服务不要直接开放到公网。

账号数据只保存在运行 `server.py` 的那台机器或所配置的 PostgreSQL 中。GitHub 仓库存放代码，不存放账号数据库；换服务器时需要迁移数据库。Benchmark、Leaderboard 和接入草稿目前仍是浏览器本地数据，不会自动按账号同步。

## 数据

`dist/data.js` 是从仓库 README 的 NPU leaderboard 生成的离线快照。页面上的“从 GitHub 刷新”会优先读取 `master` 当前 commit 的 SHA，并按该 SHA 读取 README；成功后将成绩、源码和日志链接固定在同一提交。若 GitHub API 不可用，则回退到直接读取 `master` README；网络不可用时显示离线快照。离线快照中的源码和日志链接指向 `master`，并非固定提交。

`dist/extra-leaderboards.js` 收录 AirBench 和 nanoVLM 各两条 NPU 成绩及其固定 Git commit。两个详情页均可从 GitHub 刷新 README；成功后按耗时排序。能读取 commit SHA 时，说明、实现目录和日志链接固定到同一提交；GitHub API 受限时回退到分支地址，并在页面标明链接会随分支更新。AirBench 的成绩是单张 Ascend 910C 上至少 20 次完整训练的平均耗时及平均 TTA 准确率；nanoVLM 的成绩是 8 张 Ascend NPU 上一次完整运行中 200 个计时 step 的耗时及最终验证损失。站点没有独立复跑这些仓库成绩。

“接入已有榜单”保存来源地址、成绩字段、硬件口径和排序规则。保存草稿不会自动读取任意网址或将成绩发布到本站。NanoGPT 的 PR 查询使用 GitHub 公开 API，只展示 GitHub 返回的开放、关闭、草稿或合并状态；是否入榜仍以仓库 README 为准。

NanoGPT 的硬件展示统一按物理卡数计为 **8×Ascend 910C**，对应 **16 个 die / 16 个分布式训练进程**。源仓库 README 目前仍写为 `16×Ascend 910C`，这是 die 与物理卡计数口径不一致；网站依据项目负责人确认的物理卡口径展示。

## 下一步接入真实平台

1. 把赛题草稿、提交与审核流程接入账号和数据库。
2. 将 GitHub PR 同步变成服务端任务，记录规则版本、审核结论和可追溯的 commit SHA。
3. 在硬件资源与安全边界明确后接入评测队列和隔离执行节点。

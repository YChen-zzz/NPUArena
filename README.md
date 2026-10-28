# NPUArena

NPU 性能挑战与排行榜平台，包含榜单前端和账号 API。顶部把 **Benchmarks**（可按固定协议评测的任务）与 **Leaderboards**（已有项目的成绩榜）分开，并按训练加速、推理加速、算子加速分类。目前还没有正式发布的自动评测 Benchmark；Leaderboards 展示 [`zhaoyiyidan/modded-nanogpt-npu`](https://github.com/zhaoyiyidan/modded-nanogpt-npu)、[`YChen-zzz/VIT-TIMM-npu`](https://github.com/YChen-zzz/VIT-TIMM-npu)、[`YChen-zzz/Qwen3-transformers-npu`](https://github.com/YChen-zzz/Qwen3-transformers-npu)、[`YChen-zzz/cifar10-airbench-npu`](https://github.com/YChen-zzz/cifar10-airbench-npu) 和 [`YChen-zzz/nanoVLM-npu`](https://github.com/YChen-zzz/nanoVLM-npu) 的仓库成绩。五个榜单的硬件、质量门槛与计时范围各自独立，不跨榜单混排。

首页使用线路板动画和完整 NPUArena 名称作为主视觉。NanoGPT 榜单页面分为概览、数据与模型、评测规则、提交、排行榜。正式提交仍走 GitHub PR。站内可查询公开 PR 的 GitHub 状态。

访客无需注册即可提交 Benchmark 或 Leaderboard 提案：填写联系邮箱、简介和 GitHub 仓库，提案先进入管理员审核队列，审核通过后展示在相应目录的“社区提案”区域。Benchmark 的详细本机草稿可以一键带入提案表单。管理员仍可独立创建和编辑 Leaderboard 草稿；“接入已有榜单”的来源映射草稿仍保存在浏览器 `localStorage`。公开注册已关闭；管理员登录和退出由服务端处理。社区提案不等同于正式赛题或成绩记录，网站没有 NPU 自动评测后端。

## 本地运行

在项目根目录运行 `python server.py --host 127.0.0.1 --port 4173`，然后打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。第一次启动会自动创建 `data/npuarena.sqlite3`；该文件已被 Git 忽略。使用原来的 `python -m http.server` 只能浏览静态页面，无法登录。

主要入口：`/#/benchmarks`、`/#/leaderboards`、`/#/submit`、`/#/admin/submissions`、`/#/create`、`/#/leaderboards/new`、`/#/import`、`/#/nanogpt`、`/#/airbench`、`/#/nanovlm`、`/#/account/login`。前端仍是无构建步骤的 HTML、CSS 与 JavaScript，修改后刷新浏览器即可查看。

## 账号与数据库

`server.py` 提供同源的管理员登录、退出和 `/api/auth/me` 接口。公开注册和邮箱确认默认关闭，直接调用对应 API 会返回 `404`。只有管理员账号可以登录；普通账号无法通过登录接口建立新会话。`database.py` 在 SQLite 或 PostgreSQL 中保存用户、密码哈希、角色、会话和 Leaderboard 草稿。密码经随机盐和 scrypt 计算后入库，明文不会写入数据库或浏览器存储。浏览器收到的是 7 天有效、`HttpOnly`、`SameSite=Lax` 的会话 Cookie；数据库只保存会话令牌的 SHA-256 摘要。

首次使用时，在服务器终端运行 `python manage_admin.py create 管理员邮箱 --name 管理员昵称`。命令会交互式要求输入并确认密码，不会把密码放进命令行参数。已有账号可用 `python manage_admin.py grant 已有邮箱` 授予管理员权限；撤销时运行 `python manage_admin.py revoke 已有邮箱`。这些命令使用与 `server.py` 相同的 `DATABASE_URL` 或 `NPUARENA_DB_PATH`。角色从数据库读取，已有会话在下次请求时即反映变更。Leaderboard 草稿的读取、创建、修改和删除由服务端接口逐次校验管理员角色及同源请求，页面上的按钮隐藏仅用于界面引导。

本地默认使用 SQLite，不需额外安装依赖。部署时可配置 `DATABASE_URL` 使用 PostgreSQL，并先执行 `pip install -r requirements.txt`。示例见 [`.env.example`](.env.example)；实际凭据应放在部署环境中，不要提交到仓库。管理员登录**无需 SMTP 或 Turnstile**。上线后登录仍须使用 HTTPS，并配置 `PUBLIC_ORIGIN=https://你的域名` 和 `COOKIE_SECURE=true`；账号接口在非本机 HTTP 下拒绝请求。若使用反向代理，可在 `TRUSTED_PROXY_IPS` 中列出代理的真实来源 IP，应用只接受这些代理传入的 `X-Forwarded-For`。数据库服务不要直接开放到公网。服务器上的环境变量不会由 `.env.example` 自动加载。

账号、Leaderboard 管理员草稿和社区提案数据保存在运行 `server.py` 的那台机器或所配置的 PostgreSQL 中。GitHub 仓库存放代码，不存放数据库；换服务器时需要迁移数据库。详细 Benchmark 本机草稿和接入草稿仍是浏览器本地数据，不会自动按账号同步。旧版本在浏览器 `localStorage` 中的 Leaderboard 草稿不会自动迁移到服务端。

## 免注册提案与审核

访客在 `/#/submit` 提交类型、方向、标题、至少 20 字的说明、GitHub 仓库主页及联系邮箱；硬件、主指标和质量门槛可补充。`POST /api/submissions` 只接收文本和 GitHub 仓库链接，不上传或执行代码。成功后只显示一次私密回执链接；请用户自行保存，以查看待审核、通过或退回状态及管理员备注。本站不发送邮件，填写的邮箱**未经验证**，只能作为联系信息，不能证明提交者身份。邮箱只向管理员显示，不出现在公开提案或回执接口中。

提案保存在数据库 `community_submissions` 表，默认为 `pending`。管理员登录后在 `/#/admin/submissions` 查看邮箱和内容，可以通过或退回，也可以更改审核结果。只有 `approved` 提案出现在 Benchmarks / Leaderboards 的“社区提案”区域；正式成绩仍按各仓库的 GitHub PR 规则提交。回执令牌只在创建时返回，数据库仅保存其 SHA-256 摘要；丢失链接后无法自行查询状态，管理员可通过联系邮箱人工处理。

提交限流由数据库事务维护：同一规范化邮箱每 2 小时最多 1 条，同一来源 IP 每 2 小时最多 4 条，全站每天最多 80 条。表单另设隐藏字段阻拦简单机器人；跨站请求被拒绝，公开部署要求 HTTPS。邮箱可被冒用，这套限制只能降低滥用频率，不能保证邮箱归属；若后续出现大量恶意提案，应加入邮箱确认或 GitHub 登录。管理员审核前任何提案都不会公开。

渗透测试报告（2026-10-27）列出两项中危注册问题，未列出高危。目前公开注册默认关闭，因此外部无法通过注册接口批量建号或枚举账号邮箱。免登录提案不会创建账号，也不查询邮箱是否已注册；提案内容经管理员审核后才展示。后端保留此前的邮箱确认、人机验证及多维限流实现，只有将 `PUBLIC_REGISTRATION_ENABLED=true` 并配置 SMTP、Turnstile 后才可能重新启用；若将来恢复公开注册，需重新开放前端入口并复测。上线后仍应在 HTTPS 域名下复测管理员登录与访客提交，并配置边缘层的请求限流与异常告警。报告中的通用 WAF、巡检和审计建议需要在部署环境单独落实。

## 数据

`dist/data.js` 是从仓库 README 的 NPU leaderboard 生成的离线快照。页面上的“从 GitHub 刷新”会优先读取 `master` 当前 commit 的 SHA，并按该 SHA 读取 README；成功后将成绩、源码和日志链接固定在同一提交。若 GitHub API 不可用，则回退到直接读取 `master` README；网络不可用时显示离线快照。离线快照中的源码和日志链接指向 `master`，并非固定提交。

`dist/extra-leaderboards.js` 收录 ViT-TIMM 两条、Qwen3 两条、AirBench 三条和 nanoVLM 两条 NPU 成绩。ViT-TIMM 与 Qwen3 的成绩直接读取各仓库最新 commit 的 README；源码与日志按 README 中的记录链接打开。四个详情页均可从 GitHub 刷新 README；成功后按耗时排序。AirBench 和 nanoVLM 读取到 commit SHA 时，说明、实现目录和日志链接固定到同一提交；ViT-TIMM 和 Qwen3 的每条记录按 README 表格中的记录版本打开源码和日志。GitHub API 受限时，README 刷新回退到分支地址。AirBench 的成绩是单张 Ascend 910C 上至少 20 次完整训练的平均耗时及平均 TTA 准确率；nanoVLM 的成绩是 8 张 Ascend NPU 上一次完整运行中 200 个计时 step 的耗时及最终验证损失。

“接入已有榜单”保存来源地址、成绩字段、硬件口径和排序规则。保存草稿不会自动读取任意网址或将成绩发布到本站。NanoGPT 的 PR 查询使用 GitHub 公开 API，只展示 GitHub 返回的开放、关闭、草稿或合并状态；是否入榜仍以仓库 README 为准。

NanoGPT 的硬件展示统一按物理卡数计为 **8×Ascend 910C**，对应 **16 个 die / 16 个分布式训练进程**。源仓库 README 目前仍写为 `16×Ascend 910C`，这是 die 与物理卡计数口径不一致；网站依据项目负责人确认的物理卡口径展示。

## 下一步接入真实平台

1. 把赛题草稿、提交与审核流程接入账号和数据库。
2. 将 GitHub PR 同步变成服务端任务，记录规则版本、审核结论和可追溯的 commit SHA。
3. 在硬件资源与安全边界明确后接入评测队列和隔离执行节点。

(() => {
  'use strict';

  const REPO = 'https://github.com/zhaoyiyidan/modded-nanogpt-npu';
  const UPSTREAM = 'https://github.com/KellerJordan/modded-nanogpt';
  const RAW_README = 'https://raw.githubusercontent.com/zhaoyiyidan/modded-nanogpt-npu/master/README.md';
  const app = document.getElementById('app');
  const drawerRoot = document.getElementById('drawerRoot');
  const extraBoards = window.NPU_ARENA_LEADERBOARDS || {};
  const state = {
    records: window.NPU_SNAPSHOT || [], source: '离线快照', syncedAt: null, snapshotSha: null,
    recordFilter: 'all', recordSearch: '', category: 'all', leaderboardCategory: 'all', template: 'training',
    user: null, authChecked: false, authError: '', leaderboardDrafts: [], leaderboardDraftsError: ''
  };
  let stopAnimation = () => {};

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmt = value => Number(value).toFixed(2);
  const leaders = () => [...state.records].sort((a, b) => a.minutes - b.minutes);
  const fastest = () => leaders()[0];
  const optimizedCount = () => state.records.filter(record => record.optimized).length;
  const isAdmin = () => state.user?.role === 'admin';
  const adminGate = () => `<div class="page container account-page"><div class="account-card"><span class="eyebrow">ADMIN ACCESS</span><h1>${state.authChecked ? '仅管理员可管理 Leaderboard' : '正在检查账号…'}</h1><p>${state.authChecked ? state.user ? '当前账号没有管理员权限。请使用管理员账号登录。' : '创建、修改和接入 Leaderboard 需要管理员账号。' : '请稍候。'}</p>${state.authChecked ? `<a class="button button-primary" href="${state.user ? '#/account' : '#/account/login'}">${state.user ? '查看账号' : '登录管理员账号'}</a>` : ''}</div></div>`;
  const safeRecordUrl = url => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:blob|tree)\/(?:master|[a-f0-9]{40})\/[\w./-]+$/.test(url) ? url : REPO;
  const versionedUrl = url => safeRecordUrl(state.snapshotSha ? url.replace('/master/', `/${state.snapshotSha}/`) : url);

  function parseReadme(text) {
    const section = text.split('## NPU leaderboard')[1]?.split('## Below is the original')[0];
    if (!section) throw new Error('找不到 NPU 榜单章节');
    const rows = [];
    for (const line of section.split('\n')) {
      const match = line.match(/^(\d+)\s*\|\s*([\d.]+) minutes\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*\[log\]\((.*?)\)/);
      if (!match) continue;
      const folder = match[5].split('/logs/')[0];
      rows.push({
        id: folder.split('/').at(-1), historyIndex: Number(match[1]), minutes: Number(match[2]),
        gpuRecord: Number(match[3]), description: match[4].replace(/\*\*\[optimized\]\*\*\s*/, '').trim().replace(/\.$/, ''),
        optimized: match[4].includes('[optimized]'),
        logUrl: `${REPO}/blob/master/${match[5]}`, sourceUrl: `${REPO}/tree/master/${folder}/source`,
        recordUrl: `${REPO}/tree/master/${folder}`
      });
    }
    if (!rows.length) throw new Error('没有找到可解析的成绩');
    return rows;
  }

  function leaderboardFeature() {
    return `<article class="leaderboard-feature">
      <div class="feature-main"><div class="feature-topline"><span class="category-label">训练加速</span><span class="status-dot">GitHub 仓库榜单</span></div>
        <h3><a href="#/nanogpt">Modded NanoGPT · NPU</a></h3>
        <p>8× Ascend 910C 上的训练记录，按达到 FineWeb 目标验证损失的时间排序。</p>
        <div class="feature-facts"><div><span>硬件</span><strong>8× Ascend 910C <small>16 die</small></strong></div><div><span>数据集</span><strong>FineWeb</strong></div><div><span>质量目标</span><strong>val loss ≤ 3.28</strong></div><div><span>排名指标</span><strong>训练时间 ↓</strong></div></div>
        <div class="feature-actions"><a class="button button-primary" href="#/nanogpt/leaderboard">查看完整榜单 ↗</a><a class="text-link" href="#/nanogpt">了解榜单规则 →</a></div>
        <p class="feature-source">${state.records.length} 条记录 · 来源 GitHub README · 通过 GitHub PR 提交</p>
      </div><div class="feature-ranking"><div class="feature-ranking-head"><span>已收录前三名</span><strong>${fmt(fastest().minutes)} <small>min</small></strong></div><div class="preview-list">${topThree()}</div><a href="#/nanogpt/leaderboard" class="feature-ranking-link">查看全部 ${state.records.length} 条成绩 <span>→</span></a></div>
    </article>`;
  }

  function topThree() {
    return leaders().slice(0, 3).map((record, index) => `<a class="preview-row" href="#/nanogpt/leaderboard"><span class="preview-rank">${String(index + 1).padStart(2, '0')}</span><span class="preview-name">${esc(record.description)}</span><strong>${fmt(record.minutes)} <small>min</small></strong></a>`).join('');
  }

  const extraList = () => Object.values(extraBoards).sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999));
  const extraRecords = board => [...board.records].sort((a, b) => a.seconds - b.seconds);
  const boardScore = (board, seconds) => Number(seconds).toFixed(board.precision || 2);
  const boardUrl = (board, path, kind = 'tree', ref = board.sha) => `${board.repo}/${kind}/${ref}/${path}`;
  const boardReadmeUrl = board => `${board.repo}/blob/${board.sha}/README.md${board.sectionAnchor ? `#${board.sectionAnchor}` : '#npu-leaderboard-record-history'}`;
  const boardPinned = board => /^[a-f0-9]{40}$/.test(board.sha);
  function extraBoardCard(board) {
    const best = extraRecords(board)[0];
    return `<article class="board-card"><div class="board-card-top"><span class="category-label">训练加速</span><span class="status-dot">GitHub 仓库榜单</span></div>
      <h3><a href="#/${board.slug}">${esc(board.title)}</a></h3><p>${esc(board.summary)}</p>
      <div class="board-card-facts"><span>${esc(board.hardware)}</span><span>${esc(board.dataset)}</span><span>${esc(board.target)}</span></div>
      <div class="board-card-bottom"><div><small>当前最快 · ${board.records.length} 条成绩</small><strong>${boardScore(board, best.seconds)} <span>${board.unit}</span></strong></div><a class="button button-outline button-small" href="#/${board.slug}/leaderboard">查看榜单 ↗</a></div></article>`;
  }

  function homePage() {
    return `<div class="home-page">
      <section class="hero-banner container"><div class="hero-visual"><canvas id="circuitCanvas" aria-hidden="true"></canvas><div class="hero-core">
        <svg class="processor-graphic" viewBox="0 0 240 240" aria-hidden="true" focusable="false">
          <defs><linearGradient id="processorFace" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#166f69"/><stop offset="1" stop-color="#094f53"/></linearGradient><linearGradient id="processorTrace" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6eee0"/><stop offset="1" stop-color="#5cc8b8"/></linearGradient></defs>
          <path class="processor-pins" d="M65 19v24m37-24v24m36-24v24m37-24v24M65 197v24m37-24v24m36-24v24m37-24v24M19 65h24m-24 37h24m-24 36h24m-24 37h24m154-110h24m-24 37h24m-24 36h24m-24 37h24"/>
          <rect class="processor-shadow" x="36" y="38" width="168" height="168" rx="21"/>
          <rect class="processor-die" x="36" y="34" width="168" height="168" rx="21"/>
          <rect class="processor-inner" x="51" y="49" width="138" height="138" rx="11"/>
          <path class="processor-network processor-network--first" d="M75 92 120 72M75 92 120 120M75 92 120 168M75 148 120 72M75 148 120 120M75 148 120 168"/>
          <path class="processor-network processor-network--second" d="M120 72 165 92M120 72 165 148M120 120 165 92M120 120 165 148M120 168 165 92M120 168 165 148"/>
          <g class="processor-nodes"><g class="processor-layer processor-layer--input"><circle cx="75" cy="92" r="6"/><circle cx="75" cy="148" r="6"/></g><g class="processor-layer processor-layer--hidden"><circle cx="120" cy="72" r="6"/><circle cx="120" cy="120" r="6"/><circle cx="120" cy="168" r="6"/></g><g class="processor-layer processor-layer--output"><circle cx="165" cy="92" r="6"/><circle cx="165" cy="148" r="6"/></g></g>
          <path class="processor-corner" d="M61 70v-9h9m100 0h9v9M61 166v11h9m100 0h9v-11"/>
        </svg>
        <h1>NPUArena</h1>
      </div></div></section>
      <div class="home-intro container"><a class="button button-primary" href="#/leaderboards">查看 Leaderboards ↗</a><a class="text-link" href="#/benchmarks">浏览 Benchmarks →</a></div>
      <section class="section container"><div class="section-heading"><h2>排行榜</h2><a class="section-more" href="#/leaderboards">查看全部 →</a></div>${leaderboardFeature()}<div class="board-card-grid">${extraList().map(extraBoardCard).join('')}</div></section>
      <section class="section container" id="directions"><div class="section-heading"><h2>分类</h2></div><div class="direction-grid">
        <a class="direction-card" href="#/leaderboards?category=training"><span class="direction-icon">01</span><h3>训练加速</h3><span class="direction-count">${1 + extraList().length} 个 Leaderboard <b>→</b></span></a>
        <a class="direction-card" href="#/leaderboards?category=inference"><span class="direction-icon">02</span><h3>推理加速</h3><span class="direction-count muted">暂无内容 <b>→</b></span></a>
        <a class="direction-card" href="#/leaderboards?category=kernel"><span class="direction-icon">03</span><h3>算子加速</h3><span class="direction-count muted">暂无内容 <b>→</b></span></a>
      </div></section>
    </div>`;
  }

  function benchmarksPage() {
    const categories = [['all', '全部'], ['training', '训练加速'], ['inference', '推理加速'], ['kernel', '算子加速']];
    return `<div class="page container"><div class="page-intro directory-intro"><div><span class="eyebrow">BENCHMARKS</span><h1>Benchmarks</h1><p>按固定任务、数据和评测程序进行的 NPU 评测。当前暂无已发布任务。</p></div><a class="button button-primary" href="#/create">创建 Benchmark ↗</a></div>
      <div class="catalog-toolbar"><div class="filter-group" role="group" aria-label="按加速方向筛选">${categories.map(([key, label]) => `<button class="filter-pill ${state.category === key ? 'active' : ''}" type="button" data-category="${key}">${label}</button>`).join('')}</div></div>
      <div class="empty-panel benchmark-empty"><h2>${state.category === 'all' ? '暂无 Benchmark' : `${categories.find(([key]) => key === state.category)?.[1]}暂无 Benchmark`}</h2><p>新任务可先保存为本机草稿。</p></div>
      ${benchmarkDraftsSection()}</div>`;
  }

  function leaderboardsPage() {
    const categories = [['all', '全部'], ['training', '训练加速'], ['inference', '推理加速'], ['kernel', '算子加速']];
    const visible = state.leaderboardCategory === 'all' || state.leaderboardCategory === 'training';
    return `<div class="page container"><div class="page-intro directory-intro"><div><span class="eyebrow">RESULTS & RANKINGS</span><h1>Leaderboards</h1><p>已有项目的成绩、硬件配置与运行记录。</p></div>${isAdmin() ? '<a class="button button-primary" href="#/leaderboards/new">创建 Leaderboard ↗</a>' : ''}</div>
      <div class="catalog-toolbar"><div class="filter-group" role="group" aria-label="按加速方向筛选榜单">${categories.map(([key, label]) => `<button class="filter-pill ${state.leaderboardCategory === key ? 'active' : ''}" type="button" data-leaderboard-category="${key}">${label}</button>`).join('')}</div><span class="catalog-count">${visible ? `${1 + extraList().length} 个 Leaderboard` : '暂无 Leaderboard'}</span></div>
      ${visible ? `${leaderboardFeature()}<div class="board-card-grid">${extraList().map(extraBoardCard).join('')}</div>` : '<div class="empty-panel"><h2>这个方向还没有榜单</h2></div>'}
      ${isAdmin() ? leaderboardDraftsSection() : ''}${isAdmin() ? '<div class="catalog-bottom"><div><h2>创建或接入榜单</h2><p>管理员可建立新榜单草稿，或记录已有榜单的接入方案。</p></div><div><a class="button button-primary" href="#/leaderboards/new">创建 Leaderboard</a><a class="button button-outline" href="#/import">接入已有榜单</a></div></div>' : ''}</div>`;
  }

  const detailTabs = [['overview', '概览'], ['data', '数据与模型'], ['evaluation', '评测规则'], ['submit', '提交'], ['leaderboard', '排行榜']];
  function detailPage(tab) {
    if (!detailTabs.some(([key]) => key === tab)) tab = 'overview';
    return `<div class="page container detail-page"><div class="breadcrumbs"><a href="#/leaderboards">Leaderboards</a><span>›</span><span>Modded NanoGPT · NPU</span></div>
      <div class="detail-hero"><div><span class="category-label">训练加速 · Leaderboard</span><h1>Modded NanoGPT · NPU</h1><p>在 8× Ascend 910C 上优化语言模型训练，比较达到目标验证损失所需的时间。</p><div class="detail-meta"><span>8× Ascend 910C · 16 die</span><span>FineWeb</span><span>GitHub PR 提交</span></div></div><a class="button button-primary" href="#/nanogpt/leaderboard">查看成绩榜 ↗</a></div>
      <nav class="detail-tabs" aria-label="Leaderboard 详情">${detailTabs.map(([key, label]) => `<a href="#/nanogpt/${key}" class="${tab === key ? 'active' : ''}" ${tab === key ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav><div class="detail-body">${detailContent(tab)}</div></div>`;
  }

  function fact(label, value) { return `<div class="fact"><span>${label}</span><strong>${value}</strong></div>`; }
  function externalLink(url, label) { try { const value = new URL(url); if (!['http:', 'https:'].includes(value.protocol)) return ''; return `<a class="resource-link" href="${esc(value.href)}" target="_blank" rel="noopener noreferrer">${label} <span>↗</span></a>`; } catch { return ''; } }
  function detailContent(tab) {
    if (tab === 'overview') return `<div class="detail-grid"><div class="content-card"><span class="eyebrow">ABOUT THIS LEADERBOARD</span><h2>榜单说明</h2><p>这个榜单收录 modded-nanogpt 在 NPU 上的训练记录。各版本在 FineWeb 验证集上达到 cross-entropy loss ≤ 3.28，以所需训练时间排序，越短越靠前。</p><h3>如何参与</h3><p>先阅读仓库说明和已有记录，再准备代码、启动命令和运行日志。新的方案通过 GitHub PR 提交到原仓库，由维护者收录。</p><div class="inline-actions"><a class="button button-primary" href="#/nanogpt/leaderboard">查看成绩</a><a class="button button-outline" href="#/nanogpt/evaluation">查看收录口径</a></div></div><aside class="content-card quick-card"><h2>榜单信息</h2>${fact('方向', '训练加速')}${fact('硬件', '8× Ascend 910C（16 die）')}${fact('数据', 'FineWeb')}${fact('质量门槛', 'val loss ≤ 3.28')}${fact('排名指标', '训练时间 ↓')}${fact('成绩来源', 'GitHub README')}<a class="text-link" href="${REPO}" target="_blank" rel="noopener noreferrer">打开项目仓库 ↗</a></aside></div><div class="overview-links"><a href="#/nanogpt/leaderboard"><strong>${state.records.length}</strong><span>查看已收录成绩 →</span></a><a href="#/nanogpt/submit"><strong>PR</strong><span>了解提交方式 →</span></a></div>`;
    if (tab === 'data') return `<div class="detail-grid"><div class="content-card"><span class="eyebrow">DATA & MODEL</span><h2>数据与模型</h2><div class="info-section"><h3>训练与验证数据</h3><p>本赛题使用 FineWeb。成绩以 FineWeb 验证集上的 cross-entropy loss 为质量门槛。具体的数据准备脚本、划分和版本以项目仓库中的说明及对应记录为准。</p></div><div class="info-section"><h3>模型与改动范围</h3><p>赛题来自 modded-nanogpt 的训练 speedrun。现有记录包含优化器、模型结构、训练策略及 NPU 实现层面的改动。提交前请对照仓库规则确认允许修改的范围。</p></div><div class="info-section"><h3>环境与复现材料</h3><p>提交时保留源码、启动脚本、环境信息和完整运行日志。站内成绩详情提供对应记录目录的链接。</p></div></div><aside class="content-card quick-card"><h2>相关资源</h2><a class="resource-link" href="${REPO}" target="_blank" rel="noopener noreferrer">NPU 项目仓库 <span>↗</span></a><a class="resource-link" href="${REPO}#npu-leaderboard" target="_blank" rel="noopener noreferrer">仓库规则与成绩 <span>↗</span></a><a class="resource-link" href="${UPSTREAM}" target="_blank" rel="noopener noreferrer">原始 GPU 项目 <span>↗</span></a><p>此页是任务说明入口。仓库里的脚本和记录目录是具体版本的依据。</p></aside></div>`;
    if (tab === 'evaluation') return `<div class="detail-grid"><div class="content-card"><span class="eyebrow">EVALUATION</span><h2>评测规则</h2><div class="rule-table">${fact('硬件', '8 张 Ascend 910C 物理卡 · 16 die · 16 个训练进程')}${fact('质量门槛', 'FineWeb 验证集 cross-entropy loss ≤ 3.28')}${fact('主排名指标', '达到目标质量所需的训练时间（分钟），越短越好')}${fact('成绩证据', '源码目录与成功运行日志')}${fact('提交入口', 'GitHub Pull Request')}${fact('规则来源', '项目仓库 README；暂无单独固定的协议版本')}</div><div class="notice">上游 8×H100 成绩仅用于追溯算法来源，不参与这个 NPU 榜单的名次。</div></div><aside class="content-card quick-card"><h2>关于硬件口径</h2><p>本站按 8 张 Ascend 910C 物理卡展示，对应 16 个 die。源仓库 README 目前写作 16×，这里按项目负责人确认的物理卡口径说明。</p><h2>成绩来源</h2><p>本站读取仓库 README 中的已收录记录。查看单条成绩时可打开源码与日志。</p><a class="text-link" href="${REPO}#npu-leaderboard" target="_blank" rel="noopener noreferrer">阅读原仓库规则 ↗</a></aside></div>`;
    if (tab === 'submit') return `<div class="detail-grid"><div class="content-card"><span class="eyebrow">SUBMISSION</span><h2>通过 GitHub PR 提交</h2><p>NanoGPT 的正式记录由原仓库维护。请把新方案提交为 Pull Request，仓库收录后本站再展示成绩。</p><div class="submission-steps"><div><b>01</b><span><strong>阅读规则</strong><small>确认硬件、数据、目标损失与记录格式。</small></span></div><div><b>02</b><span><strong>准备方案</strong><small>整理源码、启动命令、环境和完整运行日志。</small></span></div><div><b>03</b><span><strong>提交 PR</strong><small>在 GitHub 上讨论和审核；通过后由仓库维护者更新成绩。</small></span></div><div><b>04</b><span><strong>查看榜单</strong><small>README 更新后，本站刷新即可显示新记录。</small></span></div></div><a class="button button-primary" href="${REPO}/compare" target="_blank" rel="noopener noreferrer">前往 GitHub 创建 PR ↗</a></div><aside class="content-card quick-card"><h2>查询 PR 状态</h2><p>输入本仓库的 PR 编号或链接。这里只读取 GitHub 的公开状态；是否入榜以仓库 README 为准。</p><form id="prLookupForm" class="lookup-form"><label for="prLookup">PR 编号或链接</label><input id="prLookup" name="pr" required placeholder="例如：#12" /><button class="button button-outline" type="submit">查询 GitHub 状态</button></form><div id="prLookupResult" class="lookup-result" role="status"></div><a class="text-link" href="${REPO}/pulls" target="_blank" rel="noopener noreferrer">浏览仓库 PR ↗</a></aside></div>`;
    return `<div class="leaderboard-detail"><div class="leaderboard-heading"><div><span class="eyebrow">NANOGPT NPU</span><h2>排行榜</h2><p>同一硬件和质量门槛下，按训练时间从短到长排列。</p></div><div class="leaderboard-summary"><strong>${fmt(fastest().minutes)} <small>min</small></strong><span>已收录最快 · ${state.records.length} 条成绩</span></div></div><div id="resultTableMount">${resultsTable()}</div></div>`;
  }

  function extraBoardPage(board, tab) {
    if (!detailTabs.some(([key]) => key === tab)) tab = 'overview';
    const base = `#/${board.slug}`;
    return `<div class="page container detail-page"><div class="breadcrumbs"><a href="#/leaderboards">Leaderboards</a><span>›</span><span>${esc(board.title)}</span></div>
      <div class="detail-hero"><div><span class="category-label">训练加速 · Leaderboard</span><h1>${esc(board.title)}</h1><p>${esc(board.summary)}</p><div class="detail-meta"><span>${esc(board.hardware)}</span><span>${esc(board.dataset)}</span><span>GitHub 仓库成绩</span></div></div><a class="button button-primary" href="${base}/leaderboard">查看成绩榜 ↗</a></div>
      <nav class="detail-tabs" aria-label="Leaderboard 详情">${detailTabs.map(([key, label]) => `<a href="${base}/${key}" class="${tab === key ? 'active' : ''}" ${tab === key ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
      <div class="detail-body">${extraBoardContent(board, tab)}</div></div>`;
  }

  function extraBoardContent(board, tab) {
    const base = `#/${board.slug}`;
    const repoLink = boardReadmeUrl(board);
    if (tab === 'overview') return `<div class="detail-grid"><div class="content-card"><span class="eyebrow">ABOUT THIS LEADERBOARD</span><h2>榜单说明</h2><p>${esc(board.summary)} 同一榜单只比较仓库规则所规定的硬件、数据与质量门槛，按${esc(board.metric)}从短到长排序。</p><h3>如何参与</h3><p>阅读 NPU 仓库规则，提交源码、启动方式与完整运行日志。仓库收录后，本站可从 GitHub 更新展示。</p><div class="inline-actions"><a class="button button-primary" href="${base}/leaderboard">查看成绩</a><a class="button button-outline" href="${base}/evaluation">查看评测口径</a></div></div>
      <aside class="content-card quick-card"><h2>榜单信息</h2>${fact('方向', '训练加速')}${fact('硬件', esc(board.hardware))}${fact('数据', esc(board.dataset))}${fact('质量门槛', esc(board.target))}${fact('排名指标', `${esc(board.metric)} ↓`)}${fact('成绩来源', 'GitHub README')}<a class="text-link" href="${board.repo}" target="_blank" rel="noopener noreferrer">打开项目仓库 ↗</a></aside></div><div class="overview-links"><a href="${base}/leaderboard"><strong>${board.records.length}</strong><span>查看已收录成绩 →</span></a><a href="${base}/submit"><strong>PR</strong><span>了解提交方式 →</span></a></div>`;
    if (tab === 'data') return `<div class="detail-grid"><div class="content-card"><span class="eyebrow">DATA & MODEL</span><h2>数据与模型</h2><div class="info-section"><h3>任务与数据</h3><p>${esc(board.dataset)} · ${esc(board.model)}。具体数据准备、模型版本和训练脚本以 NPU 仓库及对应记录为准。</p></div><div class="info-section"><h3>训练和计时</h3><p>${esc(board.timing)}</p></div><div class="info-section"><h3>成绩材料</h3><p>每条成绩都可查看仓库中的实现目录和运行日志。</p></div></div><aside class="content-card quick-card"><h2>相关资源</h2><a class="resource-link" href="${board.repo}" target="_blank" rel="noopener noreferrer">NPU 项目仓库 <span>↗</span></a><a class="resource-link" href="${repoLink}" target="_blank" rel="noopener noreferrer">NPU 规则与成绩 <span>↗</span></a><a class="resource-link" href="${board.upstream}" target="_blank" rel="noopener noreferrer">原始项目 <span>↗</span></a></aside></div>`;
    if (tab === 'evaluation') return `<div class="detail-grid"><div class="content-card"><span class="eyebrow">EVALUATION</span><h2>评测规则</h2><div class="rule-table">${fact('硬件', esc(board.hardware))}${fact('质量门槛', esc(board.target))}${fact('主排名指标', `${esc(board.metric)}，越短越好`)}${fact('计时范围', esc(board.timing))}${fact('改动范围', esc(board.rules))}${fact('证据', '源码、启动命令和完整日志')}</div><div class="notice">不同硬件或训练任务的成绩不参与这个 NPU 榜单排名。</div></div><aside class="content-card quick-card"><h2>成绩来源</h2><p>当前记录来自 NPU 仓库 README。本站按耗时重新排序，并提供对应源码与日志链接。</p><p>${board.recordMode === 'tagged' ? '成绩从最新 GitHub README 读取，源码与日志按该 README 的记录链接打开。' : boardPinned(board) ? `当前数据固定在 Git commit <code>${esc(board.sha.slice(0, 12))}</code>。` : '当前从 GitHub 分支实时读取；链接会随分支更新。'}可在排行榜页面刷新。</p><a class="text-link" href="${repoLink}" target="_blank" rel="noopener noreferrer">阅读仓库规则 ↗</a></aside></div>`;
    if (tab === 'submit') return `<div class="detail-grid"><div class="content-card"><span class="eyebrow">SUBMISSION</span><h2>通过 GitHub PR 提交</h2><p>当前网站展示仓库已收录的成绩，尚无站内自动评测。新方案请按 NPU 仓库规则准备并交由仓库维护者审核。</p><div class="submission-steps"><div><b>01</b><span><strong>阅读规则</strong><small>确认硬件、数据、质量目标与计时范围。</small></span></div><div><b>02</b><span><strong>准备证据</strong><small>保留源码、启动命令、环境与完整日志。</small></span></div><div><b>03</b><span><strong>创建 PR</strong><small>向对应 NPU 仓库提交，等待维护者审核。</small></span></div><div><b>04</b><span><strong>更新榜单</strong><small>仓库 README 收录后，本站刷新即可读取新成绩。</small></span></div></div><a class="button button-primary" href="${board.repo}/compare" target="_blank" rel="noopener noreferrer">前往 GitHub 创建 PR ↗</a></div><aside class="content-card quick-card"><h2>提交前核对</h2><p>${esc(board.target)}。${esc(board.timing)}</p><a class="text-link" href="${repoLink}" target="_blank" rel="noopener noreferrer">阅读完整规则 ↗</a></aside></div>`;
    const best = extraRecords(board)[0];
    return `<div class="leaderboard-detail"><div class="leaderboard-heading"><div><span class="eyebrow">${esc(board.slug.toUpperCase())} NPU</span><h2>排行榜</h2><p>${esc(board.hardware)} · ${esc(board.target)} · 耗时越短越靠前。</p></div><div class="leaderboard-summary"><strong>${boardScore(board, best.seconds)} <small>${board.unit}</small></strong><span>已收录最快 · ${board.records.length} 条成绩</span></div></div><div class="results-panel"><div class="table-scroll"><table class="results-table"><thead><tr><th>排名</th><th>实现 / 记录</th><th>类型</th><th>耗时</th><th>${esc(board.qualityName)}</th>${board.secondaryQualityName ? `<th>${esc(board.secondaryQualityName)}</th>` : ""}<th>证据</th></tr></thead><tbody>${extraRecords(board).map((record, index) => `<tr data-extra-board="${board.slug}" data-extra-record="${esc(record.id)}" tabindex="0" aria-label="查看第 ${index + 1} 名的成绩详情"><td class="rank-cell">${String(index + 1).padStart(2, '0')}</td><td><strong class="record-title">${esc(record.description)}</strong><small class="record-id">${esc(record.label)}</small></td><td><span class="record-type">${record.type === 'optimized' ? 'NPU 优化' : '直接移植'}</span></td><td class="score-cell">${boardScore(board, record.seconds)} <small>${board.unit}</small></td><td>${esc(record.quality)}</td>${board.secondaryQualityName ? `<td>${esc(record.secondaryQuality || "—")}</td>` : ""}<td class="evidence-cell">源码与日志 ↗</td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>${esc(board.metric)} · ${esc(board.target)}</span><span>GitHub ${boardPinned(board) ? 'commit' : '分支'} ${esc(board.sha.slice(0, 12))}${board.syncedAt ? ` · 已更新 ${esc(board.syncedAt)}` : ''} <button type="button" data-sync-extra="${board.slug}">从 GitHub 刷新 ↻</button></span></div></div></div>`;
  }

  function rowHtml(record, rank) {
    return `<tr data-record="${esc(record.id)}" tabindex="0" aria-label="查看第 ${rank} 名的成绩详情"><td class="rank-cell">${String(rank).padStart(2, '0')}</td><td><strong class="record-title">${esc(record.description)}</strong><small class="record-id">${esc(record.id)}</small></td><td><span class="record-type">${record.optimized ? 'NPU 优化' : '直接移植'}</span></td><td class="score-cell">${fmt(record.minutes)} <small>min</small></td><td class="evidence-cell">源码与日志 ↗</td></tr>`;
  }
  function resultsTable() {
    let rows = leaders();
    if (state.recordFilter === 'optimized') rows = rows.filter(record => record.optimized);
    if (state.recordFilter === 'direct') rows = rows.filter(record => !record.optimized);
    const query = state.recordSearch.trim().toLowerCase();
    if (query) rows = rows.filter(record => `${record.description} ${record.id} ${record.gpuRecord}`.toLowerCase().includes(query));
    const all = leaders();
    return `<div class="results-panel"><div class="results-toolbar"><div class="results-filters"><button class="filter-pill ${state.recordFilter === 'all' ? 'active' : ''}" data-record-filter="all">全部</button><button class="filter-pill ${state.recordFilter === 'optimized' ? 'active' : ''}" data-record-filter="optimized">NPU 优化</button><button class="filter-pill ${state.recordFilter === 'direct' ? 'active' : ''}" data-record-filter="direct">直接移植</button></div><input class="search-field" id="recordSearch" type="search" value="${esc(state.recordSearch)}" placeholder="搜索技术或记录编号" aria-label="搜索成绩" /></div><div class="table-scroll"><table class="results-table"><thead><tr><th>排名</th><th>技术 / 记录</th><th>类型</th><th>训练时间</th><th>证据</th></tr></thead><tbody>${rows.map(record => rowHtml(record, all.findIndex(item => item.id === record.id) + 1)).join('') || '<tr><td colspan="5" class="table-empty">没有匹配的成绩。</td></tr>'}</tbody></table></div><div class="table-foot"><span>8× Ascend 910C（16 die） · FineWeb val loss ≤ 3.28</span><span>${state.source}${state.syncedAt ? ` · ${state.syncedAt}` : ''} <button id="syncButton" type="button">从 GitHub 刷新 ↻</button></span></div></div>`;
  }

  const templates = {
    training: { label: '训练加速', short: '训练', description: '达到目标质量的时间、吞吐与资源效率。' },
    inference: { label: '推理加速', short: '推理', description: '延迟、吞吐与质量要求下的性能。' },
    kernel: { label: '算子加速', short: '算子', description: '通过正确性门槛后比较算子性能。' }
  };
  function stored(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
  const drafts = () => stored('npu-bench-drafts');
  const imports = () => stored('npu-bench-imports');
  const leaderboardDrafts = () => state.leaderboardDrafts;
  function benchmarkDraftsSection() {
    const list = drafts(); if (!list.length) return '';
    return `<section class="local-drafts"><div class="section-heading"><h2>本机 Benchmark 草稿</h2><span class="draft-badge">仅当前浏览器可见</span></div><div class="draft-grid">${list.map((item, index) => ({ ...item, index })).reverse().map(item => `<div class="local-draft-card"><span class="category-label">${esc(templates[item.template]?.label || '未分类')}</span><h3>${esc(item.title)}</h3><p>${esc(item.summary || item.hardware || '')}</p><div><span>${esc(item.hardware || '')}</span><button type="button" data-delete-draft="${item.index}">删除</button></div></div>`).join('')}</div></section>`;
  }
  function leaderboardDraftsSection() {
    const list = leaderboardDrafts(); if (!list.length) return '';
    return `<section class="local-drafts"><div class="section-heading"><h2>Leaderboard 草稿</h2><span class="draft-badge">未发布 · 仅管理员可见</span></div><div class="draft-grid">${list.map(item => `<a class="local-draft-card" href="#/leaderboards/draft/${encodeURIComponent(item.id)}"><span class="category-label">${esc(item.category)}</span><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p><div><span>${esc(item.hardware)}</span><span>查看草稿 →</span></div></a>`).join('')}</div></section>`;
  }
  function draftItems() { const list = drafts(); return list.length ? list.map((item, index) => ({ ...item, index })).reverse().slice(0, 5).map(item => `<div class="draft-item"><div><strong>${esc(item.title)}</strong><span>${esc(templates[item.template]?.label || item.template)} · ${esc(item.hardware)}</span></div><button type="button" data-delete-draft="${item.index}">删除</button></div>`).join('') : '<p class="muted-copy">还没有保存的草稿。</p>'; }
  function importItems() { const list = imports(); return list.length ? list.map((item, index) => ({ ...item, index })).reverse().slice(0, 5).map(item => `<div class="draft-item"><div><strong>${esc(item.title)}</strong><span>${esc(item.format)} · ${esc(item.sourceUrl)}</span></div><button type="button" data-delete-import="${item.index}">删除</button></div>`).join('') : '<p class="muted-copy">还没有接入草稿。</p>'; }
  function updateDrafts() { const list = document.getElementById('draftItems'); if (list) list.innerHTML = draftItems(); const count = document.getElementById('draftCount'); if (count) count.textContent = drafts().length; }
  function updateImports() { const list = document.getElementById('importItems'); if (list) list.innerHTML = importItems(); const count = document.getElementById('importCount'); if (count) count.textContent = imports().length; }

  function createPage() {
    const template = templates[state.template];
    return `<div class="page container"><div class="page-intro"><span class="eyebrow">HOST A BENCHMARK</span><h1>创建 Benchmark</h1><p>按模板写清任务、数据、模型、评测和提交方式。当前仅保存本机草稿，发布和自动评测尚未接入。</p></div>
      <div class="template-grid">${Object.entries(templates).map(([key, value]) => `<button class="template-choice ${state.template === key ? 'active' : ''}" type="button" data-template="${key}" aria-pressed="${state.template === key}"><span>${value.short}</span><strong>${value.label}</strong><small>${value.description}</small></button>`).join('')}</div>
      <div class="editor-layout"><form class="editor-form" id="createForm"><div class="form-section"><div class="form-section-head"><span>01</span><div><h2>任务说明</h2><p>让参与者先看懂要优化什么。</p></div></div><div class="field-grid"><label class="field full">Benchmark 名称 *<input name="title" required maxlength="100" placeholder="例如：语言模型训练评测 · 8× Ascend 910C" /></label><label class="field full">一句话目标 *<input name="summary" required placeholder="例如：达到目标验证损失所需的训练时间" /></label><label class="field full">任务描述<textarea name="description" placeholder="背景、参与方式和希望解决的问题"></textarea></label></div></div>
        <div class="form-section"><div class="form-section-head"><span>02</span><div><h2>数据、模型与硬件</h2><p>把可比较的条件定清楚。</p></div></div><div class="field-grid"><label class="field">硬件配置 *<input name="hardware" required placeholder="例如：8× Ascend 910C（16 die）" /></label><label class="field">数据集及版本 *<input name="dataset" required placeholder="数据名称、版本或固定划分" /></label><label class="field full">模型、输入与可改动范围 *<input name="model" required placeholder="说明模型基线及允许修改的内容" /></label><label class="field full">质量 / 正确性门槛 *<input name="goal" required placeholder="例如：验证损失 ≤ 3.28" /></label></div></div>
        <div class="form-section"><div class="form-section-head"><span>03</span><div><h2>评测与排名</h2><p>让成绩计算和复现都有依据。</p></div></div><div class="field-grid"><label class="field">主排名指标 *<input name="metric" required placeholder="例如：训练时间（分钟）" /></label><label class="field">排序方向 *<select name="direction" required><option value="asc">越小越好</option><option value="desc">越大越好</option></select></label><label class="field">规则版本 *<input name="rulesVersion" required placeholder="例如：v1.0" /></label><label class="field">基线或评测程序链接<input name="baselineUrl" type="url" placeholder="https://..." /></label><label class="field full">复现方式<input name="reproduce" placeholder="环境、启动命令、日志与结果要求" /></label></div></div>
        <div class="form-section"><div class="form-section-head"><span>04</span><div><h2>提交方式</h2><p>每场任务可以有自己的入口。</p></div></div><div class="field-grid"><label class="field">提交方式 *<select name="submission" required><option value="github-pr">GitHub PR</option><option value="platform">站内运行（评测服务接入后）</option><option value="external">外部站点</option></select></label><label class="field">项目或提交入口<input name="url" type="url" placeholder="https://..." /></label><label class="field full">提交材料说明<textarea name="submissionRequirements" placeholder="需要哪些代码、日志、模型文件或运行说明"></textarea></label></div></div>
        <div class="form-actions"><button class="button button-primary" type="submit">保存本机草稿</button><span id="saveState" role="status"></span></div></form>
        <aside class="editor-aside"><div class="aside-card"><span class="eyebrow">PUBLISH CHECKLIST</span><h3>发布前核对</h3><ul><li>有清楚的任务与质量门槛</li><li>数据、模型和硬件版本明确</li><li>排名指标和排序方向固定</li><li>有可运行的基线或评测程序</li><li>提交方式与审核责任明确</li></ul><p>当前只是页面草稿，不会创建公开赛题。</p></div><div class="aside-card"><h3>本机草稿 <span id="draftCount">${drafts().length}</span></h3><div id="draftItems">${draftItems()}</div></div><a class="text-link" href="#/import">已有外部榜单？接入已有榜单 →</a></aside></div></div>`;
  }

  function importPage() {
    return `<div class="page container"><div class="page-intro"><span class="eyebrow">CONNECT AN EXISTING LEADERBOARD</span><h1>接入已有榜单</h1><p>记录来源网址、硬件口径和成绩字段。保存后仍需要编写读取规则并核对成绩；本站不会自动解析任意网页。</p></div><div class="editor-layout"><form class="editor-form" id="importForm"><div class="form-section"><div class="form-section-head"><span>01</span><div><h2>来源</h2><p>谁维护这个榜单，数据放在哪里？</p></div></div><div class="field-grid"><label class="field full">榜单名称 *<input name="title" required maxlength="100" placeholder="例如：某模型推理性能榜" /></label><label class="field">来源网址 *<input name="sourceUrl" type="url" required placeholder="https://..." /></label><label class="field">来源形式 *<select name="format" required><option>GitHub README</option><option>CSV 文件</option><option>JSON / API</option><option>网页榜单</option></select></label></div></div><div class="form-section"><div class="form-section-head"><span>02</span><div><h2>成绩口径</h2><p>映射字段之前先确认可比性。</p></div></div><div class="field-grid"><label class="field">方向 *<select name="taskType" required><option>训练加速</option><option>推理加速</option><option>算子加速</option></select></label><label class="field">硬件口径 *<input name="hardware" required placeholder="例如：8 张物理卡 / 16 die" /></label><label class="field">原榜单的成绩字段 *<input name="scoreField" required placeholder="例如：time_minutes" /></label><label class="field">本站展示的主指标 *<input name="metric" required placeholder="例如：训练时间（分钟）" /></label><label class="field">排序方向 *<select name="direction" required><option value="asc">越小越好</option><option value="desc">越大越好</option></select></label><label class="field">质量或正确性门槛<input name="goal" placeholder="例如：val loss ≤ 3.28" /></label><label class="field full">其他关键字段<input name="mapping" placeholder="例如：作者=author，代码=repo，日志=log_url" /></label></div></div><div class="form-section"><div class="form-section-head"><span>03</span><div><h2>提交与更新</h2><p>让参与者找到原来的入口。</p></div></div><div class="field-grid"><label class="field full">原站提交入口<input name="submissionUrl" type="url" placeholder="https://..." /></label><label class="field full">更新与审核说明<textarea name="notes" placeholder="谁维护？多久更新？如何确认成绩？"></textarea></label></div></div><div class="form-actions"><button class="button button-primary" type="submit">保存接入草稿</button><span id="importSaveState" role="status"></span></div></form><aside class="editor-aside"><div class="aside-card"><span class="eyebrow">BEFORE SYNCING</span><h3>接入前核对</h3><ul><li>任务与硬件版本能否对应</li><li>分数单位和排序方向是否一致</li><li>是否有代码、日志或评测证据</li><li>字段变化后如何处理</li></ul><p>填写网址只保存接入方案，不会导入成绩。</p></div><div class="aside-card"><h3>接入草稿 <span id="importCount">${imports().length}</span></h3><div id="importItems">${importItems()}</div></div><a class="text-link" href="#/create">需要新任务？创建 Benchmark →</a></aside></div></div>`;
  }

  function leaderboardFormPage(editId) {
    const existing = leaderboardDrafts().find(item => item.id === editId);
    const v = key => esc(existing?.[key] || '');
    const selected = (key, value) => existing?.[key] === value ? ' selected' : '';
    return `<div class="page container"><div class="breadcrumbs"><a href="#/leaderboards">Leaderboards</a><span>›</span><span>${existing ? '编辑草稿' : '创建 Leaderboard'}</span></div><div class="page-intro"><span class="eyebrow">NEW LEADERBOARD</span><h1>${existing ? '编辑 Leaderboard 草稿' : '创建 Leaderboard'}</h1><p>草稿保存在服务端，仅管理员可查看和修改。</p></div>
      <div class="editor-layout"><form class="editor-form" id="newLeaderboardForm"><input type="hidden" name="id" value="${v('id')}" />
        <div class="form-section"><div class="form-section-head"><span>01</span><div><h2>榜单信息</h2><p>名称和比较对象。</p></div></div><div class="field-grid"><label class="field full">Leaderboard 名称 *<input name="title" required maxlength="100" value="${v('title')}" placeholder="例如：LLM 推理吞吐排行榜" /></label><label class="field">方向 *<select name="category" required><option value="training"${selected('category','training')}>训练加速</option><option value="inference"${selected('category','inference')}>推理加速</option><option value="kernel"${selected('category','kernel')}>算子加速</option></select></label><label class="field">项目链接<input name="projectUrl" type="url" value="${v('projectUrl')}" placeholder="https://..." /></label><label class="field full">简要说明 *<textarea name="summary" required placeholder="比较什么结果，以及谁可以参与">${v('summary')}</textarea></label></div></div>
        <div class="form-section"><div class="form-section-head"><span>02</span><div><h2>比较口径</h2><p>成绩必须在同一条件下比较。</p></div></div><div class="field-grid"><label class="field">硬件配置 *<input name="hardware" required value="${v('hardware')}" placeholder="例如：8× Ascend 910C（16 die）" /></label><label class="field">数据集 / 输入负载 *<input name="workload" required value="${v('workload')}" placeholder="数据版本、输入形状或请求分布" /></label><label class="field full">模型 / 算子及改动范围 *<input name="model" required value="${v('model')}" placeholder="写清基线和允许修改的部分" /></label><label class="field full">质量 / 正确性门槛 *<input name="target" required value="${v('target')}" placeholder="例如：验证损失 ≤ 3.28" /></label><label class="field">主排名指标 *<input name="metric" required value="${v('metric')}" placeholder="例如：训练时间（分钟）" /></label><label class="field">排序方向 *<select name="direction" required><option value="asc"${selected('direction','asc')}>越小越好</option><option value="desc"${selected('direction','desc')}>越大越好</option></select></label><label class="field">规则版本 *<input name="rulesVersion" required value="${v('rulesVersion')}" placeholder="例如：v1.0" /></label></div></div>
        <div class="form-section"><div class="form-section-head"><span>03</span><div><h2>提交与核对</h2><p>写清参与者如何交成绩。</p></div></div><div class="field-grid"><label class="field">提交方式 *<select name="submission" required><option value="github-pr"${selected('submission','github-pr')}>GitHub PR</option><option value="external"${selected('submission','external')}>外部站点</option><option value="maintainer"${selected('submission','maintainer')}>维护者录入</option></select></label><label class="field">提交入口链接<input name="submissionUrl" type="url" value="${v('submissionUrl')}" placeholder="https://..." /></label><label class="field full">成绩证据要求 *<textarea name="evidence" required placeholder="例如：源码版本、运行日志和环境信息">${v('evidence')}</textarea></label><label class="field full">审核方式 *<textarea name="verification" required placeholder="例如：维护者检查日志并复跑基线">${v('verification')}</textarea></label></div></div>
        <div class="form-section"><div class="form-section-head"><span>04</span><div><h2>首条成绩</h2><p>可选；有基线成绩时可以一起记录。</p></div></div><div class="field-grid"><label class="field">方案名称<input name="baselineName" value="${v('baselineName')}" placeholder="例如：官方基线" /></label><label class="field">成绩<input name="baselineScore" value="${v('baselineScore')}" placeholder="例如：12.4 min" /></label><label class="field full">代码或日志链接<input name="baselineEvidence" type="url" value="${v('baselineEvidence')}" placeholder="https://..." /></label></div></div>
        <div class="form-actions"><button class="button button-primary" type="submit">${existing ? '保存修改' : '创建草稿'}</button><span id="leaderboardSaveState" role="status"></span></div></form>
        <aside class="editor-aside"><div class="aside-card"><h3>创建后的状态</h3><p>草稿保存在服务端，仅管理员可查看和编辑；公开发布和自动评测尚未接入。</p></div><div class="aside-card"><h3>创建前确认</h3><ul><li>硬件、数据和质量门槛一致</li><li>主指标与排序方向明确</li><li>提交方式及成绩证据要求明确</li><li>如填写首条成绩，附代码或日志</li></ul></div><a class="text-link" href="#/import">已有外部榜单？接入已有榜单 →</a></aside></div></div>`;
  }

  function leaderboardDraftPage(id) {
    const draft = leaderboardDrafts().find(item => item.id === id);
    if (!draft) return `<div class="page container"><div class="empty-panel"><h1>找不到这个草稿</h1><a class="button button-outline" href="#/leaderboards">返回 Leaderboards</a></div></div>`;
    const category = templates[draft.category]?.label || '未分类';
    const submission = { 'github-pr': 'GitHub PR', external: '外部站点', maintainer: '维护者录入' }[draft.submission] || draft.submission;
    return `<div class="page container detail-page"><div class="breadcrumbs"><a href="#/leaderboards">Leaderboards</a><span>›</span><span>管理员草稿</span></div><div class="detail-hero"><div><span class="category-label">${esc(category)} · 管理员草稿</span><h1>${esc(draft.title)}</h1><p>${esc(draft.summary)}</p><div class="detail-meta"><span>${esc(draft.hardware)}</span><span>${esc(draft.workload)}</span><span>规则 ${esc(draft.rulesVersion)}</span></div></div><a class="button button-primary" href="#/leaderboards/new?edit=${encodeURIComponent(draft.id)}">编辑草稿</a></div><div class="notice">此榜单尚未公开发布，仅管理员可查看和修改。</div><div class="detail-grid draft-detail"><div class="content-card"><h2>比较口径</h2>${fact('模型 / 算子', esc(draft.model))}${fact('质量 / 正确性门槛', esc(draft.target))}${fact('排名指标', `${esc(draft.metric)} · ${draft.direction === 'desc' ? '越大越好' : '越小越好'}`)}<h2>提交与核对</h2>${fact('提交方式', esc(submission))}<p><strong>成绩证据：</strong>${esc(draft.evidence)}</p><p><strong>审核方式：</strong>${esc(draft.verification)}</p>${draft.baselineName ? `<h2>首条成绩</h2>${fact(esc(draft.baselineName), esc(draft.baselineScore))}${externalLink(draft.baselineEvidence, '首条成绩证据')}` : '<p class="muted-copy">尚未添加成绩。</p>'}</div><aside class="content-card quick-card">${draft.projectUrl || draft.submissionUrl ? `<h2>相关链接</h2>${externalLink(draft.projectUrl, '项目地址')}${externalLink(draft.submissionUrl, '提交入口')}` : ''}<h2>草稿操作</h2><a class="resource-link" href="#/leaderboards/new?edit=${encodeURIComponent(draft.id)}">编辑规则 <span>→</span></a><button class="resource-link delete-link" type="button" data-delete-leaderboard-draft="${esc(draft.id)}">删除草稿 <span>×</span></button><p id="leaderboardDraftError" role="status"></p><a class="resource-link" href="#/leaderboards">返回 Leaderboards <span>→</span></a><p>公开发布和成绩提交服务尚未接入。</p></aside></div></div>`;
  }

  function accountPage() {
    if (state.user) return `<div class="page container account-page"><div class="account-card"><span class="eyebrow">MY ACCOUNT</span><h1>你好，${esc(state.user.displayName)}</h1><p>已登录 NPUArena。账号信息保存在服务端数据库中。</p><div class="account-identity"><span>邮箱</span><strong>${esc(state.user.email)}</strong></div><div class="account-identity"><span>权限</span><strong>${isAdmin() ? '管理员' : '普通用户'}</strong></div><div class="account-actions"><a class="button button-primary" href="#/leaderboards">浏览 Leaderboards</a><button class="button button-outline" type="button" data-logout>退出登录</button></div><div class="account-future"><strong>当前功能</strong><span>${isAdmin() ? '可在服务端创建和修改 Leaderboard 草稿。' : 'Leaderboard 创建和修改仅限管理员。'}Benchmark 与接入草稿仍只保存在当前浏览器。</span></div></div></div>`;
    return `<div class="page container account-page"><div class="account-card"><span class="eyebrow">ADMIN ACCOUNT</span><h1>管理员登录</h1><p>管理员登录后可创建和修改 Leaderboard。</p><form id="authForm" class="auth-form"><label>邮箱<input name="email" type="email" autocomplete="username" maxlength="254" required placeholder="admin@example.com" /></label><label>密码<input name="password" type="password" autocomplete="current-password" required placeholder="管理员密码" /></label><button class="button button-primary" type="submit">登录</button><span class="auth-status" id="authStatus" role="status">${esc(state.authError)}</span></form><div class="account-future"><strong>账号数据</strong><span>管理员账号在服务器创建；密码只以哈希形式存储。</span></div></div></div>`;
  }

  function updateNavAccount() {
    const nav = document.getElementById('navActions');
    if (state.user) nav.innerHTML = `<a class="nav-user" href="#/account" title="${esc(state.user.email)}">${esc(state.user.displayName)}</a><button class="nav-logout" type="button" data-logout>退出</button>`;
    else nav.innerHTML = '<a class="button button-primary button-small" href="#/account/login">管理员登录</a>';
  }

  async function loadLeaderboardDrafts() {
    state.leaderboardDrafts = [];
    if (!isAdmin()) return;
    const response = await fetch('/api/leaderboards/drafts', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '无法读取 Leaderboard 草稿。');
    state.leaderboardDrafts = data.drafts;
  }

  async function loadSession() {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('账号服务不可用');
      state.user = (await response.json()).user || null;
      await loadLeaderboardDrafts();
      state.authError = '';
    } catch (error) {
      state.authError = error.message || '账号服务不可用。';
    }
    state.authChecked = true;
    updateNavAccount();
    if (location.hash.startsWith('#/account') || location.hash.startsWith('#/leaderboards') || location.hash.startsWith('#/import')) render();
  }

  async function submitAuth(form) {
    const status = form.querySelector('#authStatus');
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    button.disabled = true;
    status.textContent = '正在登录…';
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: values.email, password: values.password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '登录服务暂时不可用。');
      state.user = data.user;
      await loadLeaderboardDrafts();
      state.authError = '';
      updateNavAccount();
      location.hash = '#/account';
    } catch (error) {
      status.textContent = error.message || '登录服务暂时不可用。';
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (!response.ok) throw new Error('退出失败');
      state.user = null;
      state.leaderboardDrafts = [];
      updateNavAccount();
      if (location.hash === '#/account/login') render();
      else location.hash = '#/account/login';
    } catch {
      const status = document.getElementById('authStatus');
      if (status) status.textContent = '退出失败，请稍后再试。';
    }
  }

  function render() {
    const raw = location.hash.slice(1) || '/';
    const [path, query] = raw.split('?');
    if (path === '/account/register' || path === '/account/verify') {
      location.hash = '#/account/login';
      return;
    }
    const params = new URLSearchParams(query || '');
    stopAnimation(); closeDrawer();
    if (path === '/benchmarks') {
      const category = params.get('category');
      state.category = category && ['training', 'inference', 'kernel'].includes(category) ? category : 'all';
      app.innerHTML = benchmarksPage();
    } else if (path === '/leaderboards') {
      const category = params.get('category');
      state.leaderboardCategory = category && ['training', 'inference', 'kernel'].includes(category) ? category : 'all';
      app.innerHTML = leaderboardsPage();
    }
    else if (path === '/leaderboards/new') app.innerHTML = isAdmin() ? leaderboardFormPage(params.get('edit')) : adminGate();
    else if (path.startsWith('/leaderboards/draft/')) app.innerHTML = isAdmin() ? leaderboardDraftPage(decodeURIComponent(path.split('/')[3] || '')) : adminGate();
    else if (path.startsWith('/nanogpt')) app.innerHTML = detailPage(path.split('/')[2] || 'overview');
    else if (extraBoards[path.split('/')[1]]) app.innerHTML = extraBoardPage(extraBoards[path.split('/')[1]], path.split('/')[2] || 'overview');
    else if (path === '/create') app.innerHTML = createPage();
    else if (path === '/import') app.innerHTML = isAdmin() ? importPage() : adminGate();
    else if (path.startsWith('/account')) {
      app.innerHTML = accountPage();
    }
    else { app.innerHTML = homePage(); animateCircuit(); }
    const extraBoard = extraBoards[path.split('/')[1]];
    const active = path.startsWith('/leaderboards') || path.startsWith('/nanogpt') || extraBoard || path === '/import' ? 'leaderboards' : path === '/benchmarks' || path === '/create' ? 'benchmarks' : '';
    document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === active));
    document.title = `${path === '/' ? '首页' : path === '/benchmarks' ? 'Benchmarks' : path === '/leaderboards' ? 'Leaderboards' : path === '/leaderboards/new' ? '创建 Leaderboard' : path.startsWith('/leaderboards/draft/') ? 'Leaderboard 草稿' : path.startsWith('/nanogpt') ? 'NanoGPT NPU' : extraBoard ? extraBoard.title : path === '/create' ? '创建 Benchmark' : path === '/import' ? '接入已有榜单' : '账号'} · NPUArena`;
    document.getElementById('siteNav').classList.remove('open');
    document.getElementById('menuButton').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, 0);
  }

  function openDrawer(id) {
    const record = state.records.find(item => item.id === id); if (!record) return;
    const rank = leaders().findIndex(item => item.id === id) + 1;
    drawerRoot.innerHTML = `<div class="drawer-backdrop" id="drawerBackdrop"><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle"><div class="drawer-header"><button type="button" id="drawerClose" aria-label="关闭详情">×</button><span class="eyebrow">RANK ${String(rank).padStart(2, '0')} · TRAINING ACCELERATION</span><h2 id="drawerTitle">${esc(record.description)}</h2><p>${esc(record.id)}</p></div><div class="drawer-content"><div class="drawer-score"><strong>${fmt(record.minutes)} <small>min</small></strong><span>8× Ascend 910C · 16 die</span></div><div class="evidence-status">仓库榜单已收录</div><div class="drawer-section"><h3>成绩信息</h3>${fact('类型', record.optimized ? 'NPU 优化' : '直接移植')}${fact('GPU 原记录', `#${record.gpuRecord}`)}${fact('仓库历史序号', `#${record.historyIndex}`)}${fact('质量门槛', 'FineWeb val loss ≤ 3.28')}${fact('数据快照', state.snapshotSha ? esc(state.snapshotSha.slice(0, 12)) : '本机快照 · 未固定提交')}</div><div class="drawer-section"><h3>代码与证据</h3><p>${state.snapshotSha ? '链接已固定到本次读取的 Git commit。' : '离线快照中的链接指向 master；仓库更新后内容可能变化。'} 仓库 README 未提供这条记录对应的 PR 编号。</p><a class="resource-link" href="${versionedUrl(record.sourceUrl)}" target="_blank" rel="noopener noreferrer">对应源码 <span>↗</span></a><a class="resource-link" href="${versionedUrl(record.logUrl)}" target="_blank" rel="noopener noreferrer">运行日志 <span>↗</span></a><a class="resource-link" href="${versionedUrl(record.recordUrl)}" target="_blank" rel="noopener noreferrer">完整记录目录 <span>↗</span></a></div></div></aside></div>`;
    document.body.classList.add('drawer-open'); document.getElementById('drawerClose').focus();
  }
  function openExtraDrawer(slug, id) {
    const board = extraBoards[slug];
    const record = board?.records.find(item => item.id === id); if (!record) return;
    const rank = extraRecords(board).findIndex(item => item.id === id) + 1;
    drawerRoot.innerHTML = `<div class="drawer-backdrop" id="drawerBackdrop"><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
      <div class="drawer-header"><button type="button" id="drawerClose" aria-label="关闭详情">×</button><span class="eyebrow">RANK ${String(rank).padStart(2, '0')} · ${esc(board.title)}</span><h2 id="drawerTitle">${esc(record.description)}</h2><p>${esc(record.label)}</p></div>
      <div class="drawer-content"><div class="drawer-score"><strong>${boardScore(board, record.seconds)} <small>${board.unit}</small></strong><span>${esc(board.hardware)}</span></div><div class="evidence-status">仓库榜单已收录</div>
      <div class="drawer-section"><h3>成绩信息</h3>${fact('类型', record.type === 'optimized' ? 'NPU 专项优化' : '原算法移植')}${fact(board.qualityName, esc(record.quality))}${board.secondaryQualityName ? fact(board.secondaryQualityName, esc(record.secondaryQuality || '—')) : ''}${fact('质量门槛', esc(board.target))}${fact('排名指标', esc(board.metric))}${fact('记录版本', esc((record.ref || board.sha).slice(0, 12)))}</div>
      <div class="drawer-section"><h3>代码与证据</h3><p>${record.ref ? '源码与日志按这条记录在 README 中列出的版本打开。' : boardPinned(board) ? '源码与日志固定到同一个 Git commit。' : '源码与日志指向 GitHub 分支，内容可能随分支更新。'}具体复现口径请查看仓库 README。</p><a class="resource-link" href="${boardUrl(board, record.folder, "tree", record.ref || board.sha)}" target="_blank" rel="noopener noreferrer">实现目录 <span>↗</span></a><a class="resource-link" href="${boardUrl(board, record.log, 'blob', record.ref || board.sha)}" target="_blank" rel="noopener noreferrer">运行日志 <span>↗</span></a><a class="resource-link" href="${boardReadmeUrl(board)}" target="_blank" rel="noopener noreferrer">仓库榜单 <span>↗</span></a></div></div></aside></div>`;
    document.body.classList.add('drawer-open'); document.getElementById('drawerClose').focus();
  }
  function closeDrawer() { drawerRoot.innerHTML = ''; document.body.classList.remove('drawer-open'); }

  function parseTaggedReadme(board, text) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex(line => line.trim() === `## ${board.sectionHeading}`);
    if (start < 0) throw new Error('找不到仓库成绩章节');
    const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
    const section = lines.slice(start + 1, end < 0 ? undefined : end);
    const rows = [];
    let recordCount = 0;
    for (const line of section) {
      if (!line.trim().startsWith('|')) continue;
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
      if (!/^\d+$/.test(cells[0])) continue;
      recordCount += 1;
      if (cells.length !== (board.secondaryQualityName ? 7 : 6)) continue;
      const link = cells[1].match(/^\[([\w-]+)\]\(\.\.\/\.\.\/tree\/([\w-]+)\)$/);
      if (!link || link[1] !== link[2] || !/^record\d+_[\w-]+$/.test(link[1])) continue;
      const recordName = link[1];
      const seconds = Number(cells[2].replace(/\*/g, '').match(/\d+(?:\.\d+)?/)?.[0]);
      const quality = cells[3].replace(/\*/g, '');
      const secondaryQuality = board.secondaryQualityName ? cells[4].replace(/\*/g, '') : undefined;
      const log = cells.at(-1).match(/\[log\]\(([^)]+)\)/i)?.[1];
      if (!Number.isFinite(seconds) || !Number.isFinite(Number(quality)) || (secondaryQuality && !Number.isFinite(Number(secondaryQuality.replace('%', '')))) || !log || !/^logs\/[\w.-]+\.log$/.test(log) || !log.startsWith(`logs/${recordName}`)) continue;
      const description = cells[board.secondaryQualityName ? 5 : 4].replace(/\*\*/g, '').replace(/^\[(?:baseline|optimized)\]\s*/i, '').trim();
      if (!description) continue;
      const optimized = !/^record01_/.test(recordName);
      rows.push({ id: `${board.slug}-${recordName}`, label: optimized ? 'NPU 专项优化' : '原算法移植', description, seconds, quality, secondaryQuality, type: optimized ? 'optimized' : 'baseline', folder: 'source', log, ref: recordName });
    }
    if (!rows.length || rows.length !== recordCount) throw new Error('README 成绩格式已变化，无法完整读取');
    return rows;
  }

  function parseExtraReadme(board, text) {
    if (board.recordMode === 'tagged') return parseTaggedReadme(board, text);
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex(line => /^## NPU leaderboard(?: record history)?\s*$/i.test(line.trim()));
    if (start < 0) throw new Error('找不到 NPU 榜单章节');
    const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
    const section = lines.slice(start + 1, end < 0 ? undefined : end);
    const rows = [];
    let recordCount = 0;
    const root = board.slug === 'airbench' ? 'airbench_npu' : 'nanoVLM_npu';
    const logPattern = new RegExp(`^${root}/(?:record[\\w-]+|baseline|optimized)/logs/[\\w.-]+\\.log$`);
    for (const line of section) {
      if (!line.trim().startsWith('|')) continue;
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
      if (cells.length !== 6 || !/^\d+$/.test(cells[0])) continue;
      recordCount += 1;
      const seconds = Number(cells[2].replace(/\*/g, '').match(/\d+(?:\.\d+)?/)?.[0]);
      const qualityText = cells[3].replace(/\*/g, '');
      const quality = Number(qualityText.replace('%', ''));
      const log = cells[5].match(/\[log\]\(([^)]+)\)/i)?.[1];
      if (!Number.isFinite(seconds) || !Number.isFinite(quality) || !log || !logPattern.test(log)) continue;
      const folder = log.split('/logs/')[0];
      const listedRecord = cells[1].replace(/`/g, '');
      if (listedRecord !== folder && listedRecord !== folder.split('/').at(-1)) continue;
      const description = cells[4].replace(/\*\*/g, '').replace(/\\([\[\]])/g, '$1').trim();
      const tag = description.match(/^\[(baseline|optimized(?:_v\d+)?)\]\s*/i);
      if (!tag) continue;
      const optimized = tag[1].toLowerCase().startsWith('optimized');
      rows.push({ id: `${board.slug}-${folder.split('/').at(-1)}`, label: optimized ? 'NPU 专项优化' : '原算法移植', description: description.slice(tag[0].length).trim(), seconds, quality: qualityText, type: optimized ? 'optimized' : 'baseline', folder, log });
    }
    if (!rows.length || rows.length !== recordCount) throw new Error('README 榜单格式已变化，无法完整读取成绩');
    return rows;
  }

  async function syncExtra(slug) {
    const board = extraBoards[slug]; if (!board) return;
    const button = document.querySelector(`[data-sync-extra="${slug}"]`);
    if (button) { button.disabled = true; button.textContent = '正在读取…'; }
    try {
      const ownerRepo = new URL(board.repo).pathname.slice(1);
      let ref = board.branch;
      try {
        const head = await fetch(`https://api.github.com/repos/${ownerRepo}/commits/${board.branch}`, { cache: 'no-store' });
        if (head.ok) { const commit = await head.json(); if (/^[a-f0-9]{40}$/.test(commit.sha)) ref = commit.sha; }
      } catch {}
      const response = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${ref}/README.md`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`README HTTP ${response.status}`);
      const records = parseExtraReadme(board, await response.text());
      board.records = records; board.sha = ref;
      board.syncedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const scrollY = window.scrollY; render(); window.scrollTo(0, scrollY);
    } catch (error) { if (button) { button.disabled = false; button.textContent = '重试刷新 ↻'; button.title = `暂时无法更新成绩，当前成绩未改变：${String(error.message)}`; } }
  }

  async function sync() {
    const button = document.getElementById('syncButton'); if (button) { button.disabled = true; button.textContent = '正在读取…'; }
    try {
      let sha = null;
      try { const head = await fetch('https://api.github.com/repos/zhaoyiyidan/modded-nanogpt-npu/commits/master', { cache: 'no-store' }); if (head.ok) { const commit = await head.json(); if (/^[a-f0-9]{40}$/.test(commit.sha)) sha = commit.sha; } } catch {}
      const readmeUrl = sha ? RAW_README.replace('/master/', `/${sha}/`) : RAW_README;
      const response = await fetch(`${readmeUrl}?t=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const records = parseReadme(await response.text()); state.records = records; state.snapshotSha = sha;
      state.source = sha ? 'GitHub 固定提交' : 'GitHub 实时读取'; state.syncedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const scrollY = window.scrollY; render(); window.scrollTo(0, scrollY);
    } catch (error) { if (button) { button.disabled = false; button.textContent = '刷新失败，重试 ↻'; button.title = String(error.message); } }
  }

  async function lookupPr(value) {
    const result = document.getElementById('prLookupResult'); if (!result) return;
    const input = String(value || '').trim();
    const match = input.match(/^#?(\d+)$/) || input.match(/^https:\/\/github\.com\/zhaoyiyidan\/modded-nanogpt-npu\/pull\/(\d+)\/?(?:[?#].*)?$/i);
    if (!match) { result.textContent = '请输入本仓库的 PR 编号或完整链接。'; return; }
    const number = Number(match[1]); if (!Number.isSafeInteger(number) || number < 1) { result.textContent = 'PR 编号无效。'; return; }
    result.textContent = `正在查询 PR #${number}…`;
    try {
      const response = await fetch(`https://api.github.com/repos/zhaoyiyidan/modded-nanogpt-npu/pulls/${number}`, { cache: 'no-store' });
      if (response.status === 404) { result.textContent = `没有找到 PR #${number}。`; return; }
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const pr = await response.json(); const status = pr.merged_at ? '已合并' : pr.state === 'open' ? (pr.draft ? '草稿' : '开放中') : '已关闭';
      result.innerHTML = `<strong>PR #${number} · ${status}</strong><span>${esc(pr.title)}</span><small>${esc(pr.user?.login || '未知作者')} · 更新于 ${esc(new Date(pr.updated_at).toLocaleDateString('zh-CN'))}</small><a href="${REPO}/pull/${number}" target="_blank" rel="noopener noreferrer">在 GitHub 查看 ↗</a><em>入榜状态仍以仓库 README 为准。</em>`;
    } catch (error) {
      result.innerHTML = `<strong>暂时无法读取 PR #${number}</strong><span>${String(error.message).includes('403') ? 'GitHub 公共 API 已达到访问限制。' : 'GitHub API 暂时不可用。'}</span><a href="${REPO}/pull/${number}" target="_blank" rel="noopener noreferrer">直接在 GitHub 打开 ↗</a>`;
    }
  }

  function saveDraft(input) {
    const required = ['title', 'summary', 'hardware', 'dataset', 'model', 'goal', 'metric', 'direction', 'rulesVersion', 'submission'];
    for (const key of required) if (!String(input[key] || '').trim()) throw new Error(`缺少必填字段：${key}`);
    const list = drafts(); list.push({ ...input, template: input.template || state.template, createdAt: new Date().toISOString() });
    localStorage.setItem('npu-bench-drafts', JSON.stringify(list)); updateDrafts(); return { title: input.title, count: list.length, storage: '当前浏览器' };
  }
  function saveImport(input) {
    if (!isAdmin()) throw new Error('仅管理员可接入 Leaderboard。');
    const required = ['title', 'sourceUrl', 'format', 'taskType', 'hardware', 'scoreField', 'metric', 'direction'];
    for (const key of required) if (!String(input[key] || '').trim()) throw new Error(`缺少必填字段：${key}`);
    const list = imports(); list.push({ ...input, createdAt: new Date().toISOString() });
    localStorage.setItem('npu-bench-imports', JSON.stringify(list)); updateImports(); return list.length;
  }
  async function saveLeaderboard(input) {
    if (!isAdmin()) throw new Error('仅管理员可创建或修改 Leaderboard。');
    const required = ['title', 'category', 'summary', 'hardware', 'workload', 'model', 'target', 'metric', 'direction', 'rulesVersion', 'submission', 'evidence', 'verification'];
    for (const key of required) if (!String(input[key] || '').trim()) throw new Error('请填写所有必填字段。');
    const baseline = ['baselineName', 'baselineScore', 'baselineEvidence'];
    if (baseline.some(key => String(input[key] || '').trim()) && baseline.some(key => !String(input[key] || '').trim())) throw new Error('首条成绩需要方案名称、成绩和证据链接。');
    const id = input.id;
    const response = await fetch(id ? `/api/leaderboards/drafts/${encodeURIComponent(id)}` : '/api/leaderboards/drafts', {
      method: id ? 'PUT' : 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '保存失败，请稍后再试。');
    const item = data.draft;
    const list = leaderboardDrafts();
    const previous = list.findIndex(draft => draft.id === item.id);
    if (previous >= 0) list[previous] = item; else list.unshift(item);
    return item;
  }

  async function deleteLeaderboardDraft(id) {
    if (!isAdmin()) throw new Error('仅管理员可删除 Leaderboard 草稿。');
    const response = await fetch(`/api/leaderboards/drafts/${encodeURIComponent(id)}`, {
      method: 'DELETE', credentials: 'same-origin'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '删除失败，请稍后再试。');
    state.leaderboardDrafts = leaderboardDrafts().filter(item => item.id !== id);
    location.hash = '#/leaderboards';
  }

  function animateCircuit() {
    const canvas = document.getElementById('circuitCanvas'); if (!canvas) return;
    const context = canvas.getContext('2d'); if (!context) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0, height = 0, paths = [], frame = 0, seed = 1327;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    function setup() {
      cancelAnimationFrame(frame);
      const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
      const ratio = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio)); context.setTransform(ratio, 0, 0, ratio, 0, 0);
      seed = 1327; paths = [];
      const count = width < 420 ? 18 : 28;
      for (let i = 0; i < count; i++) {
        const side = i % 4; const edge = side < 2 ? random() * height : random() * width;
        const compact = width < 760;
        const targetX = width * (compact ? .43 + random() * .14 : .19 + random() * .18), targetY = height * (compact ? .27 + random() * .24 : .34 + random() * .32);
        const bend = 35 + random() * 95;
        let points;
        if (side === 0) points = [[0, edge], [bend, edge], [bend, targetY], [targetX, targetY]];
        else if (side === 1) points = [[width, edge], [width - bend, edge], [width - bend, targetY], [targetX, targetY]];
        else if (side === 2) points = [[edge, 0], [edge, bend], [targetX, bend], [targetX, targetY]];
        else points = [[edge, height], [edge, height - bend], [targetX, height - bend], [targetX, targetY]];
        const lengths = [0]; for (let n = 1; n < points.length; n++) lengths.push(lengths[n - 1] + Math.hypot(points[n][0] - points[n - 1][0], points[n][1] - points[n - 1][1]));
        paths.push({ points, lengths, total: lengths.at(-1), phase: random(), speed: .000035 + random() * .000045, alpha: .16 + random() * .22 });
      }
      draw(0);
    }
    function pointAt(path, distance) {
      for (let i = 1; i < path.points.length; i++) if (distance <= path.lengths[i]) { const fraction = (distance - path.lengths[i - 1]) / (path.lengths[i] - path.lengths[i - 1] || 1); return [path.points[i - 1][0] + (path.points[i][0] - path.points[i - 1][0]) * fraction, path.points[i - 1][1] + (path.points[i][1] - path.points[i - 1][1]) * fraction]; }
      return path.points.at(-1);
    }
    function draw(time) {
      context.clearRect(0, 0, width, height);
      for (const path of paths) {
        context.beginPath(); path.points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y)); context.lineWidth = 1; context.strokeStyle = `rgba(10, 145, 135, ${path.alpha})`; context.stroke();
        const end = path.points.at(-1); context.beginPath(); context.arc(end[0], end[1], 2, 0, Math.PI * 2); context.fillStyle = 'rgba(9, 133, 125, .33)'; context.fill();
        const position = pointAt(path, ((time * path.speed + path.phase) % 1) * path.total);
        context.beginPath(); context.arc(position[0], position[1], 2.6, 0, Math.PI * 2); context.fillStyle = 'rgba(9, 137, 129, .88)'; context.shadowColor = 'rgba(15, 167, 155, .52)'; context.shadowBlur = 10; context.fill(); context.shadowBlur = 0;
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    }
    const observer = new ResizeObserver(setup); observer.observe(canvas); setup();
    stopAnimation = () => { cancelAnimationFrame(frame); observer.disconnect(); stopAnimation = () => {}; };
  }

  app.addEventListener('click', event => {
    if (event.target.closest('[data-logout]')) { void logout(); return; }
    const extraRecord = event.target.closest('[data-extra-record]'); if (extraRecord) { openExtraDrawer(extraRecord.dataset.extraBoard, extraRecord.dataset.extraRecord); return; }
    const record = event.target.closest('[data-record]'); if (record) { openDrawer(record.dataset.record); return; }
    const syncBoard = event.target.closest('[data-sync-extra]'); if (syncBoard) { syncExtra(syncBoard.dataset.syncExtra); return; }
    const filter = event.target.closest('[data-record-filter]'); if (filter) { state.recordFilter = filter.dataset.recordFilter; document.getElementById('resultTableMount').innerHTML = resultsTable(); return; }
    const category = event.target.closest('[data-category]'); if (category) { const selected = category.dataset.category; const next = selected === 'all' ? '#/benchmarks' : `#/benchmarks?category=${selected}`; if (location.hash === next) { state.category = selected; app.innerHTML = benchmarksPage(); } else location.hash = next; return; }
    const leaderboardCategory = event.target.closest('[data-leaderboard-category]'); if (leaderboardCategory) { const selected = leaderboardCategory.dataset.leaderboardCategory; const next = selected === 'all' ? '#/leaderboards' : `#/leaderboards?category=${selected}`; if (location.hash === next) { state.leaderboardCategory = selected; app.innerHTML = leaderboardsPage(); } else location.hash = next; return; }
    const template = event.target.closest('[data-template]'); if (template) { const current = document.getElementById('createForm'); const values = current ? Object.fromEntries(new FormData(current)) : {}; state.template = template.dataset.template; app.innerHTML = createPage(); for (const [name, value] of Object.entries(values)) { const field = document.getElementById('createForm').elements.namedItem(name); if (field) field.value = value; } return; }
    const removeDraft = event.target.closest('[data-delete-draft]'); if (removeDraft) { const list = drafts(); list.splice(Number(removeDraft.dataset.deleteDraft), 1); localStorage.setItem('npu-bench-drafts', JSON.stringify(list)); if (location.hash.startsWith('#/benchmarks')) render(); else updateDrafts(); return; }
    const removeLeaderboardDraft = event.target.closest('[data-delete-leaderboard-draft]'); if (removeLeaderboardDraft) { void deleteLeaderboardDraft(removeLeaderboardDraft.dataset.deleteLeaderboardDraft).catch(error => { const status = document.getElementById('leaderboardDraftError'); if (status) status.textContent = error.message; }); return; }
    const removeImport = event.target.closest('[data-delete-import]'); if (removeImport) { const list = imports(); list.splice(Number(removeImport.dataset.deleteImport), 1); localStorage.setItem('npu-bench-imports', JSON.stringify(list)); updateImports(); return; }
    if (event.target.closest('#syncButton')) sync();
  });
  app.addEventListener('keydown', event => { const extraRow = event.target.closest('[data-extra-record]'); if (extraRow && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openExtraDrawer(extraRow.dataset.extraBoard, extraRow.dataset.extraRecord); return; } const row = event.target.closest('[data-record]'); if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDrawer(row.dataset.record); } });
  app.addEventListener('input', event => {
    if (event.target.id === 'recordSearch') { state.recordSearch = event.target.value; const start = event.target.selectionStart; document.getElementById('resultTableMount').innerHTML = resultsTable(); const input = document.getElementById('recordSearch'); input.focus(); input.setSelectionRange(start, start); }
  });
  app.addEventListener('submit', event => {
    const formId = event.target.getAttribute('id');
    if (formId === 'authForm') { event.preventDefault(); void submitAuth(event.target); return; }
    if (formId === 'prLookupForm') { event.preventDefault(); lookupPr(new FormData(event.target).get('pr')); return; }
    if (formId === 'createForm') { event.preventDefault(); saveDraft({ ...Object.fromEntries(new FormData(event.target)), template: state.template }); document.getElementById('saveState').textContent = '草稿已保存在当前浏览器'; event.target.reset(); return; }
    if (formId === 'importForm') { event.preventDefault(); try { saveImport(Object.fromEntries(new FormData(event.target))); document.getElementById('importSaveState').textContent = '接入草稿已保存，尚未同步成绩'; event.target.reset(); } catch (error) { document.getElementById('importSaveState').textContent = error.message; } return; }
    if (formId === 'newLeaderboardForm') { event.preventDefault(); const form = event.target; const button = form.querySelector('button[type="submit"]'); button.disabled = true; const status = document.getElementById('leaderboardSaveState'); status.textContent = '正在保存…'; void saveLeaderboard(Object.fromEntries(new FormData(form))).then(item => { location.hash = `#/leaderboards/draft/${encodeURIComponent(item.id)}`; }).catch(error => { status.textContent = error.message; }).finally(() => { button.disabled = false; }); }
  });
  drawerRoot.addEventListener('click', event => { if (event.target.id === 'drawerBackdrop' || event.target.id === 'drawerClose') closeDrawer(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });
  document.getElementById('menuButton').addEventListener('click', () => { const nav = document.getElementById('siteNav'); const open = nav.classList.toggle('open'); document.getElementById('menuButton').setAttribute('aria-expanded', String(open)); });
  document.getElementById('navActions').addEventListener('click', event => { if (event.target.closest('[data-logout]')) void logout(); });
  if (document.modelContext?.registerTool) { try { void Promise.resolve(document.modelContext.registerTool({ name: 'save_benchmark_draft', title: '保存 Benchmark 草稿', description: '在当前浏览器保存训练、推理或算子赛题草稿，不会发布。', inputSchema: { type: 'object', properties: { template: { type: 'string', enum: ['training', 'inference', 'kernel'] }, title: { type: 'string' }, summary: { type: 'string' }, hardware: { type: 'string' }, dataset: { type: 'string' }, model: { type: 'string' }, goal: { type: 'string' }, metric: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] }, rulesVersion: { type: 'string' }, submission: { type: 'string', enum: ['github-pr', 'platform', 'external'] } }, required: ['template', 'title', 'summary', 'hardware', 'dataset', 'model', 'goal', 'metric', 'direction', 'rulesVersion', 'submission'], additionalProperties: true }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { if (!templates[input?.template]) throw new Error('不支持的赛题类型'); return saveDraft(input); } })).catch(() => {}); } catch {} }
  window.addEventListener('hashchange', render);
  render();
  void loadSession();
})();

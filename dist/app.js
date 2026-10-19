(() => {
  'use strict';
  const REPO = 'https://github.com/zhaoyiyidan/modded-nanogpt-npu';
  const RAW_README = 'https://raw.githubusercontent.com/zhaoyiyidan/modded-nanogpt-npu/master/README.md';
  const app = document.getElementById('app');
  const drawerRoot = document.getElementById('drawerRoot');
  const state = { records: window.NPU_SNAPSHOT || [], source: '离线快照', syncedAt: null, snapshotSha: null, filter: 'all', search: '', tab: 'leaderboard', template: 'training' };
  let stopCoverAnimation = () => {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = url => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:blob|tree)\/(?:master|[a-f0-9]{40})\/[\w./-]+$/.test(url) ? url : REPO;
  const versionedUrl = url => safeUrl(state.snapshotSha ? url.replace('/master/', `/${state.snapshotSha}/`) : url);
  const best = () => Math.min(...state.records.map(r => r.minutes));
  const fmt = num => Number(num).toFixed(2);
  const leaders = () => [...state.records].sort((a,b) => a.minutes - b.minutes);
  const bestRecord = () => leaders()[0];
  const countOptimized = () => state.records.filter(r => r.optimized).length;

  function parseReadme(text) {
    const section = text.split('## NPU leaderboard')[1]?.split('## Below is the original')[0];
    if (!section) throw new Error('找不到 NPU 榜单章节');
    const rows = [];
    for (const line of section.split('\n')) {
      const m = line.match(/^(\d+)\s*\|\s*([\d.]+) minutes\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*\[log\]\((.*?)\)/);
      if (!m) continue;
      const folder = m[5].split('/logs/')[0];
      const id = folder.split('/').at(-1);
      const description = m[4].replace(/\*\*\[optimized\]\*\*\s*/,'').trim().replace(/\.$/,'');
      rows.push({id,historyIndex:Number(m[1]),minutes:Number(m[2]),gpuRecord:Number(m[3]),description,optimized:m[4].includes('[optimized]'),logUrl:`${REPO}/blob/master/${m[5]}`,sourceUrl:`${REPO}/tree/master/${folder}/source`,recordUrl:`${REPO}/tree/master/${folder}`});
    }
    if (!rows.length) throw new Error('找不到可解析的成绩');
    return rows;
  }

  function rowHtml(r, rank) {
    return `<tr data-record="${esc(r.id)}" tabindex="0" aria-label="查看第 ${rank} 名 ${esc(r.description)} 的详情"><td><span class="rank ${rank <= 3 ? 'top':''}">#${String(rank).padStart(2,'0')}</span></td><td><div class="record-name">${esc(r.description)}<span class="record-id">${esc(r.id)}</span></div></td><td><span class="tag ${r.optimized?'opt':'port'}">${r.optimized?'NPU 优化':'直接移植'}</span></td><td><span class="time">${fmt(r.minutes)} <span>min</span></span></td><td><span class="mono" style="font-size:11px;color:#7e897f">#${r.gpuRecord}</span></td><td><span class="evidence-link">源码 · 日志 ↗</span></td></tr>`;
  }
  function resultsTable({preview=false}={}) {
    let rows = leaders();
    if (!preview) {
      if (state.filter === 'optimized') rows = rows.filter(r=>r.optimized);
      if (state.filter === 'direct') rows = rows.filter(r=>!r.optimized);
      const query = state.search.trim().toLowerCase();
      if (query) rows = rows.filter(r => `${r.description} ${r.id} ${r.gpuRecord}`.toLowerCase().includes(query));
    } else rows = rows.slice(0,5);
    const all = leaders();
    const tr = rows.map(r => rowHtml(r, all.findIndex(x=>x.id===r.id)+1)).join('');
    return `<div class="table-panel"><div class="panel-toolbar"><div><div class="toolbar-title"><span class="live-dot"></span>${preview?'最快的 5 条成绩':'仓库已收录成绩'}<span class="toolbar-meta">${preview?'TOP 5':`/ ${rows.length} RESULTS`}</span></div></div>${preview?`<a href="#/nanogpt" class="button small outline">查看完整榜单</a>`:`<div class="toolbar-actions"><input class="search" id="recordSearch" type="search" placeholder="搜索技术、记录编号或 GPU 来源" value="${esc(state.search)}" aria-label="搜索成绩"/><button class="filter-button ${state.filter==='all'?'active':''}" data-filter="all">全部</button><button class="filter-button ${state.filter==='optimized'?'active':''}" data-filter="optimized">NPU 优化</button><button class="filter-button ${state.filter==='direct'?'active':''}" data-filter="direct">直接移植</button></div>`}</div><div class="table-scroll"><table class="results-table"><thead><tr><th style="width:7%">排名</th><th>技术 / 记录</th><th style="width:16%">类型</th><th style="width:15%">训练时间</th><th style="width:11%">GPU 原记录</th><th style="width:13%">证据</th></tr></thead><tbody>${tr || `<tr><td colspan="6"><div class="empty-state">没有找到匹配的成绩。试试其他关键词或筛选条件。</div></td></tr>`}</tbody></table></div><div class="data-note"><span>8× Ascend 910C（16 die）· FineWeb 验证损失 ≤ 3.28 · 时间越短越好</span><span>${state.source}${state.syncedAt?' · '+state.syncedAt:''}　<button id="syncButton">从 GitHub 刷新 ↻</button></span></div></div>`;
  }
  function home() {
    const fastest = bestRecord();
    return `<div class="home-page"><section class="cover" aria-label="NPU Bench"><canvas id="coverCanvas" class="cover-canvas" aria-hidden="true"></canvas><div class="cover-grid" aria-hidden="true"></div><div class="cover-center"><div class="cover-overline">TRAINING <span>/</span> INFERENCE <span>/</span> KERNELS</div><h1>NPU<span>BENCH</span></h1><p>NPU 训练、推理和算子评测</p><a class="cover-scroll" href="#benchmarks">查看 Benchmarks <span aria-hidden="true">↓</span></a></div><div class="cover-corner cover-corner-tl" aria-hidden="true">01 / BENCHMARKS</div><div class="cover-corner cover-corner-br" aria-hidden="true">ASCEND NPU · OPEN RECORDS</div></section><div class="home-content" id="benchmarks"><div class="benchmark-heading"><div><div class="section-kicker">BENCHMARKS <span>/ 01</span></div><h2>现有 Benchmark</h2><p>目前接入了 NanoGPT NPU。成绩和运行日志来自 GitHub 仓库。</p></div><div class="heading-actions"><a href="#/import" class="button outline">接入已有榜单</a><a href="#/create" class="button dark">创建新赛题</a></div></div><article class="benchmark-card"><div class="benchmark-main"><div class="benchmark-type"><span class="benchmark-live"></span> 训练 Speedrun <span class="benchmark-divider">/</span> GitHub PR 提交</div><h3>Modded NanoGPT <span>· NPU</span></h3><p>在 8 张 Ascend 910C 物理卡上训练，比较达到 FineWeb 验证损失目标所需的时间。</p><div class="benchmark-facts"><div><span>硬件</span><strong>8× Ascend 910C <small>16 die</small></strong></div><div><span>质量门槛</span><strong>val loss ≤ 3.28</strong></div><div><span>排名指标</span><strong>训练时间 · 越短越好</strong></div><div><span>规则来源</span><strong>GitHub README</strong></div></div><div class="benchmark-links"><a href="#/nanogpt" class="button primary">查看赛题与榜单</a><a href="#/nanogpt/submit" class="button outline">通过 GitHub PR 提交 ↗</a></div></div><div class="benchmark-score"><div class="score-topline">当前最快</div><div class="score-value">${fmt(fastest.minutes)}<span>min</span></div><div class="score-rule"></div><div class="score-meta"><span>仓库成绩</span><strong>${state.records.length} 条</strong></div><div class="score-meta"><span>NPU 专项优化</span><strong>${countOptimized()} 条</strong></div></div></article><div class="benchmark-footnote">本赛题按仓库 README 展示。规则尚无单独的固定版本号；新赛题可在创建时填写规则版本。</div></div></div>`;
  }
  function animateCover() {
    const canvas = document.getElementById('coverCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0, height = 0, paths = [], frame = 0;
    let seed = 4219;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    function resize() {
      cancelAnimationFrame(frame);
      const box = canvas.getBoundingClientRect();
      width = box.width; height = box.height;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      seed = 4219; paths = [];
      const count = width < 600 ? 20 : 36;
      for (let i = 0; i < count; i++) {
        const side = i % 4;
        const edge = side < 2 ? random() * height : random() * width;
        const inset = 35 + random() * Math.min(width, height) * .33;
        let points;
        if (side === 0) points = [[0, edge], [inset * .55, edge], [inset * .55, edge + (random()-.5)*90], [inset, edge + (random()-.5)*90]];
        else if (side === 1) points = [[width, edge], [width-inset*.55, edge], [width-inset*.55, edge + (random()-.5)*90], [width-inset, edge + (random()-.5)*90]];
        else if (side === 2) points = [[edge, 0], [edge, inset*.55], [edge + (random()-.5)*90, inset*.55], [edge + (random()-.5)*90, inset]];
        else points = [[edge, height], [edge, height-inset*.55], [edge + (random()-.5)*90, height-inset*.55], [edge + (random()-.5)*90, height-inset]];
        const lengths = [0];
        for (let n=1;n<points.length;n++) lengths.push(lengths[n-1]+Math.hypot(points[n][0]-points[n-1][0],points[n][1]-points[n-1][1]));
        paths.push({points,lengths,total:lengths.at(-1),phase:random(),speed:.00008+random()*.00009,color:i%5===0?'119,166,174':'245,112,57',alpha:.13+random()*.16});
      }
      draw(0);
    }
    function pointAt(path, distance) {
      const {points,lengths}=path;
      for(let i=1;i<points.length;i++) if(distance<=lengths[i]) {const t=(distance-lengths[i-1])/(lengths[i]-lengths[i-1]||1);return [points[i-1][0]+(points[i][0]-points[i-1][0])*t,points[i-1][1]+(points[i][1]-points[i-1][1])*t]}
      return points.at(-1);
    }
    function draw(time) {
      ctx.clearRect(0,0,width,height);
      for(const path of paths){
        ctx.beginPath();path.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
        ctx.lineWidth=1;ctx.strokeStyle=`rgba(${path.color},${path.alpha})`;ctx.stroke();
        const end=path.points.at(-1);ctx.fillStyle=`rgba(${path.color},${path.alpha*1.8})`;ctx.fillRect(end[0]-2,end[1]-2,4,4);
        const distance=((time*path.speed+path.phase)%1)*path.total;
        const [x,y]=pointAt(path,distance);
        ctx.beginPath();ctx.arc(x,y,2.6,0,Math.PI*2);ctx.fillStyle=`rgba(${path.color},.85)`;ctx.shadowColor=`rgba(${path.color},.9)`;ctx.shadowBlur=13;ctx.fill();ctx.shadowBlur=0;
      }
      if(!reduced) frame=requestAnimationFrame(draw);
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    stopCoverAnimation=()=>{cancelAnimationFrame(frame);observer.disconnect();stopCoverAnimation=()=>{}};
  }
  function nano(tab) {
    state.tab = tab;
    return `<div class="content"><section class="nano-hero"><div class="nano-hero-top"><div><div class="eyebrow">BENCHMARK / 001 · TRAINING SPEEDRUN</div><h1>Modded NanoGPT · NPU</h1><p>在 8× Ascend 910C（16 die）上，比较达到 FineWeb 验证损失 3.28 所需的训练时间。成绩可追溯到仓库中的源码和日志。</p></div><a href="#/nanogpt/submit" class="button ghost">通过 GitHub PR 提交 ↗</a></div><div class="meta-row"><span class="meta-chip"><b>HARDWARE</b> 8× Ascend 910C · 16 die</span><span class="meta-chip"><b>DATA</b> FineWeb</span><span class="meta-chip"><b>TARGET</b> val loss ≤ 3.28</span><span class="meta-chip"><b>METRIC</b> 训练时间 ↓</span><span class="meta-chip"><b>RULES</b> GitHub README</span></div><div class="nano-tabs" role="tablist" aria-label="NanoGPT 赛题内容"><button class="${tab==='leaderboard'?'active':''}" data-tab="leaderboard" role="tab" aria-selected="${tab==='leaderboard'}">排行榜</button><button class="${tab==='rules'?'active':''}" data-tab="rules" role="tab" aria-selected="${tab==='rules'}">赛题规则</button><button class="${tab==='submit'?'active':''}" data-tab="submit" role="tab" aria-selected="${tab==='submit'}">提交与 PR 状态</button></div></section><div class="nano-body" id="nanoBody">${nanoBody(tab)}</div></div>`;
  }
  function nanoBody(tab) {
    if(tab==='rules') return `<div class="rule-grid"><section class="rule-block"><h2>评测规则</h2><div class="rule-list"><div class="rule-item"><strong>目标</strong><span>训练语言模型，达到 FineWeb 验证集 cross-entropy loss ≤ 3.28。</span></div><div class="rule-item"><strong>硬件</strong><span>8× Ascend 910C 物理卡（16 个 die），16 个分布式训练进程。</span></div><div class="rule-item"><strong>参考运行环境</strong><span>仓库指定 Docker 镜像；Python 3.10.19、torch_npu 2.7.1.post2。完整版本以仓库 README 为准。</span></div><div class="rule-item"><strong>排名指标</strong><span>达到质量目标的训练时间，分钟；越短越好。多次成功运行的记录按仓库所述平均值展示。</span></div><div class="rule-item"><strong>记录来源</strong><span>榜单从仓库 README 读取；每条记录附源码和日志。</span></div><div class="rule-item"><strong>规则版本</strong><span>仓库尚无单独的固定评测协议版本。本站展示 README 当前口径；若规则变化，应单独标识新赛道或版本。</span></div><div class="rule-item"><strong>比较边界</strong><span>上游 8×H100 记录仅作为算法来源，不与 NPU 时间混合排名。</span></div></div></section><aside class="rule-block"><h2>原始资料</h2><p>这一赛题继承 KellerJordan/modded-nanogpt 的研究成果与贡献者署名。NPU 榜单记录在分叉仓库顶部，原始 GPU 榜单保留在 README 下方。</p><p>硬件口径：本站按 8 张 Ascend 910C 物理卡展示；仓库 README 目前仍写作 16×，对应 16 个 die。</p><a href="${REPO}#npu-leaderboard" target="_blank" rel="noopener noreferrer" class="drawer-link">NPU 规则与榜单 <span>↗</span></a><a href="https://github.com/KellerJordan/modded-nanogpt" target="_blank" rel="noopener noreferrer" class="drawer-link">原始 GPU 项目 <span>↗</span></a></aside></div>`;
    if(tab==='submit') return `<div class="submission-card"><section class="rule-block"><div class="eyebrow">SUBMISSION / GITHUB PR</div><h2>通过 GitHub PR 提交</h2><div class="steps"><div class="step"><div><h3>核对赛题规则</h3><p>确认硬件、数据、质量门槛和榜单记录格式。</p></div></div><div class="step"><div><h3>整理代码与运行证据</h3><p>在 fork 中附上源码、启动命令、环境信息和完整日志。</p></div></div><div class="step"><div><h3>创建 Pull Request</h3><p>向 NanoGPT NPU 仓库提交 PR，后续审核在 GitHub 上进行。</p></div></div><div class="step"><div><h3>仓库收录后入榜</h3><p>维护者更新 README 后，本站刷新榜单即可展示新成绩。</p></div></div></div><a href="${REPO}/compare" target="_blank" rel="noopener noreferrer" class="button primary">前往 GitHub 创建 PR ↗</a></section><aside class="callout"><h3>查询 PR 状态</h3><p>输入这个仓库的 PR 编号或链接，读取 GitHub 上公开的状态。合并 PR 不等于成绩已经进入榜单；正式成绩以 README 为准。</p><form id="prLookupForm" class="pr-lookup"><label for="prLookup">PR 编号或链接</label><div><input id="prLookup" name="pr" required placeholder="例如：#12 或 GitHub PR 链接" /><button class="button primary" type="submit">查询</button></div></form><div id="prLookupResult" class="pr-result" role="status"></div><a href="${REPO}/pulls" target="_blank" rel="noopener noreferrer" class="button ghost">查看仓库 PR ↗</a></aside></div>`;
    return `<div class="notice">本榜单仅比较 8×Ascend 910C 的 NPU 成绩。原始 8×H100 时间属于上游 GPU 赛道，不参与这里的名次。</div><div class="stats-strip"><div><div class="stat-label">FASTEST / 最快</div><div class="stat-value">${fmt(best())} <small>MIN</small></div></div><div><div class="stat-label">RECORDS / 成绩</div><div class="stat-value">${state.records.length}</div></div><div><div class="stat-label">NPU OPTIMIZED / 专项优化</div><div class="stat-value">${countOptimized()}</div></div><div><div class="stat-label">TARGET LOSS / 目标</div><div class="stat-value">≤ 3.28</div></div></div>${resultsTable()}`;
  }
  const templates = {
    training:{label:'训练 Speedrun',glyph:'T',desc:'以达到目标质量所需时间排序。',fields:['目标验证指标与门槛','训练数据集及版本','模型与可改动范围']},
    inference:{label:'推理性能',glyph:'I',desc:'比较延迟、吞吐与服务质量。',fields:['输入分布与并发设置','模型及精度要求','延迟或吞吐主指标']},
    kernel:{label:'算子优化',glyph:'K',desc:'在正确性门槛内比较算子性能。',fields:['输入形状、数据类型','数值误差容忍度','延迟或吞吐主指标']}
  };
  function drafts() { try {return JSON.parse(localStorage.getItem('npu-bench-drafts')||'[]')} catch{return []} }
  function create() {
    const t = templates[state.template];
    return `<div class="content"><div class="page-heading"><div><div class="eyebrow">CREATE / BENCHMARK TEMPLATE</div><h1>创建新赛题</h1></div><a href="#/import" class="button outline">接入已有榜单 ↗</a></div><p class="create-intro">先定义硬件、数据、质量门槛和排名方式。这里保存的是当前浏览器中的草稿，尚不能发布或接受站内提交。</p><div class="template-grid">${Object.entries(templates).map(([key,v])=>`<button class="template-card ${state.template===key?'selected':''}" data-template="${key}" aria-pressed="${state.template===key}"><div class="glyph">${v.glyph} / 0${Object.keys(templates).indexOf(key)+1}</div><h3>${v.label}</h3><p>${v.desc}</p></button>`).join('')}</div><div class="form-shell"><form class="form-panel" id="createForm"><h2>${t.label} · 赛题草稿</h2><div class="field-grid"><label class="field full"><span class="form-label">赛题名称 *</span><input name="title" required maxlength="100" placeholder="例如：NanoGPT · 8× Ascend 910C" /></label><label class="field"><span class="form-label">硬件配置 *</span><input name="hardware" required placeholder="例如：8× Ascend 910C（16 die）" /></label><label class="field"><span class="form-label">提交方式 *</span><select name="submission" required><option value="github-pr">GitHub PR</option><option value="platform">站内提交（待接入评测服务）</option><option value="external">外部网站</option></select></label><label class="field"><span class="form-label">${t.fields[0]} *</span><input name="goal" required placeholder="写出可判定的标准" /></label><label class="field"><span class="form-label">${t.fields[1]} *</span><input name="dataset" required placeholder="填写名称与版本" /></label><label class="field full"><span class="form-label">${t.fields[2]} *</span><input name="model" required placeholder="说明模型、输入及允许修改的范围" /></label><label class="field"><span class="form-label">主排名指标 *</span><input name="metric" required placeholder="例如：达到目标验证损失的时间（分钟）" /></label><label class="field"><span class="form-label">规则版本 *</span><input name="rulesVersion" required placeholder="例如：v1.0" /></label><label class="field"><span class="form-label">评测或项目链接</span><input name="url" type="url" placeholder="https://github.com/..." /></label><label class="field"><span class="form-label">复现方式</span><input name="reproduce" placeholder="代码版本、启动命令、日志要求" /></label><label class="field full"><span class="form-label">补充规则</span><textarea name="notes" placeholder="软件环境、资源限制、审核方式等"></textarea></label></div><div class="form-actions"><button class="button primary" type="submit">保存本机草稿</button><span id="saveState" class="save-state" role="status"></span></div></form><aside class="form-aside"><h3>发布前检查</h3><p>赛题发布前，需要有明确的：</p><ul><li>硬件、环境与评测规则版本</li><li>数据、模型和允许修改的范围</li><li>质量或正确性门槛</li><li>排名指标、证据与复现方法</li><li>实际可用的提交与审核入口</li></ul><div class="draft-list"><h3>本机草稿 <span id="draftCount">${drafts().length}</span></h3><div id="draftItems">${renderDrafts()}</div></div></aside></div></div>`;
  }
  function imports() { try {return JSON.parse(localStorage.getItem('npu-bench-imports')||'[]')} catch{return []} }
  function renderImports() {const list=imports();return list.length?list.map((d,i)=>({...d,index:i})).reverse().slice(0,5).map(d=>`<div class="draft-item"><strong>${esc(d.title)}</strong><span>${esc(d.format)} · ${esc(d.sourceUrl)}</span><button type="button" class="draft-delete" data-delete-import="${d.index}" aria-label="删除接入草稿 ${esc(d.title)}">删除</button></div>`).join(''):'<p>还没有接入草稿。</p>'}
  function updateImportView() {const items=document.getElementById('importItems');if(items)items.innerHTML=renderImports();const count=document.getElementById('importCount');if(count)count.textContent=imports().length}
  function importPage() {
    return `<div class="content"><div class="page-heading"><div><div class="eyebrow">CONNECT / EXISTING LEADERBOARD</div><h1>接入已有榜单</h1></div><a href="#/create" class="button outline">创建新赛题 ↗</a></div><p class="create-intro">已有成绩由其他仓库或网站维护时，在这里记录来源和字段对应关系。当前版本只保存接入方案，不会自动抓取网址或把成绩加入本站排名。</p><div class="import-flow"><div><b>01</b><strong>确定来源</strong><span>仓库、页面或数据文件</span></div><div><b>02</b><strong>对齐字段</strong><span>硬件、成绩、质量门槛</span></div><div><b>03</b><strong>确认同步</strong><span>适配后再展示排行</span></div></div><div class="form-shell"><form class="form-panel" id="importForm"><h2>已有榜单 · 接入草稿</h2><div class="field-grid"><label class="field full"><span class="form-label">榜单名称 *</span><input name="title" required maxlength="100" placeholder="例如：某模型推理性能榜" /></label><label class="field"><span class="form-label">来源网址 *</span><input name="sourceUrl" type="url" required placeholder="https://..." /></label><label class="field"><span class="form-label">来源形式 *</span><select name="format" required><option value="GitHub README">GitHub README</option><option value="CSV 文件">CSV 文件</option><option value="JSON / API">JSON / API</option><option value="网页榜单">网页榜单</option></select></label><label class="field"><span class="form-label">任务类型 *</span><select name="taskType" required><option value="训练 Speedrun">训练 Speedrun</option><option value="推理性能">推理性能</option><option value="算子优化">算子优化</option></select></label><label class="field"><span class="form-label">硬件口径 *</span><input name="hardware" required placeholder="例如：8 张物理卡 / 16 die" /></label><label class="field"><span class="form-label">原榜单的成绩字段 *</span><input name="scoreField" required placeholder="例如：time_minutes" /></label><label class="field"><span class="form-label">本站展示的主指标 *</span><input name="metric" required placeholder="例如：训练时间（分钟）" /></label><label class="field"><span class="form-label">排序方向 *</span><select name="direction" required><option value="asc">越小越好</option><option value="desc">越大越好</option></select></label><label class="field"><span class="form-label">质量或正确性门槛</span><input name="goal" placeholder="例如：val loss ≤ 3.28" /></label><label class="field"><span class="form-label">原站提交入口</span><input name="submissionUrl" type="url" placeholder="https://..." /></label><label class="field full"><span class="form-label">来源中的其他关键字段</span><input name="mapping" placeholder="例如：姓名=author，代码=repo，日志=log_url" /></label><label class="field full"><span class="form-label">更新与审核说明</span><textarea name="notes" placeholder="谁维护原榜单？多久更新？如何确认成绩可信？"></textarea></label></div><div class="form-actions"><button class="button primary" type="submit">保存接入草稿</button><span id="importSaveState" class="save-state" role="status"></span></div></form><aside class="form-aside"><h3>接入前要核对</h3><p>榜单链接提供入口；实际展示成绩还需要针对来源编写读取规则，并检查：</p><ul><li>每条成绩对应的硬件与任务版本</li><li>单位、排序方向和质量门槛</li><li>作者、代码、日志或评测证据</li><li>数据更新时字段是否变化</li></ul><div class="draft-list"><h3>接入草稿 <span id="importCount">${imports().length}</span></h3><div id="importItems">${renderImports()}</div></div></aside></div></div>`;
  }
  function renderDrafts() {const list=drafts();return list.length?list.map((d,i)=>({...d,index:i})).reverse().slice(0,5).map(d=>`<div class="draft-item"><strong>${esc(d.title)}</strong><span>${esc(templates[d.template]?.label||d.template)} · ${esc(d.hardware)}</span><button type="button" class="draft-delete" data-delete-draft="${d.index}" aria-label="删除草稿 ${esc(d.title)}">删除</button></div>`).join(''):'<p>还没有保存的草稿。</p>'}
  function updateDraftView() {const items=document.getElementById('draftItems');if(items)items.innerHTML=renderDrafts();const count=document.getElementById('draftCount');if(count)count.textContent=drafts().length}
  function saveDraft(input) {const required=['title','hardware','submission','goal','dataset','model','metric','rulesVersion'];for(const key of required){if(!String(input[key]||'').trim())throw new Error(`缺少必填字段：${key}`)}const item={...input,template:input.template||state.template,createdAt:new Date().toISOString()};const list=drafts();list.push(item);localStorage.setItem('npu-bench-drafts',JSON.stringify(list));updateDraftView();return {title:item.title,template:item.template,draftCount:list.length,storage:'当前浏览器'} }
  function saveImport(input) {const required=['title','sourceUrl','format','taskType','hardware','scoreField','metric','direction'];for(const key of required){if(!String(input[key]||'').trim())throw new Error(`缺少必填字段：${key}`)}const list=imports();list.push({...input,createdAt:new Date().toISOString()});localStorage.setItem('npu-bench-imports',JSON.stringify(list));updateImportView();return list.length}
  function setNav(route) {document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===route));document.getElementById('breadcrumb').innerHTML={home:'NPU BENCH <span>/</span> 首页',nanogpt:'BENCHMARKS <span>/</span> NANO GPT NPU',create:'NPU BENCH <span>/</span> 创建赛题',import:'NPU BENCH <span>/</span> 接入榜单'}[route];}
  function route() {
    const hash = location.hash.slice(1) || '/';
    stopCoverAnimation();
    closeDrawer();
    if(hash.startsWith('/nanogpt')) {setNav('nanogpt');app.innerHTML=nano(hash.split('/')[2]||'leaderboard')}
    else if(hash.startsWith('/create')) {setNav('create');app.innerHTML=create()}
    else if(hash.startsWith('/import')) {setNav('import');app.innerHTML=importPage()}
    else {setNav('home');app.innerHTML=home();animateCover()}
    document.title=hash.startsWith('/nanogpt')?'NanoGPT NPU · NPU Bench':hash.startsWith('/create')?'创建 Benchmark · NPU Bench':hash.startsWith('/import')?'接入已有榜单 · NPU Bench':'NPU Bench · NPU 性能评测';
    document.querySelector('.sidebar').classList.remove('open');document.querySelector('.mobile-scrim')?.classList.remove('show');
    window.scrollTo(0,0);
  }
  function openDrawer(id) {
    const r=state.records.find(x=>x.id===id);if(!r)return;
    const rank=leaders().findIndex(x=>x.id===id)+1;
    drawerRoot.innerHTML=`<div class="drawer-backdrop" id="drawerBackdrop"><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle"><div class="drawer-head"><button class="drawer-close" id="drawerClose" aria-label="关闭详情">×</button><div class="eyebrow">NPU RECORD / #${String(rank).padStart(2,'0')}</div><h2 id="drawerTitle">${esc(r.description)}</h2><p>${esc(r.id)}</p></div><div class="drawer-main"><div class="drawer-score"><strong>${fmt(r.minutes)}</strong><span>MIN · 8× ASCEND 910C · 16 DIE</span></div><div class="evidence-status">仓库榜单已收录</div><div class="drawer-section"><h3>记录信息</h3><div class="drawer-kv"><span>成绩类型</span><span>${r.optimized?'NPU 专项优化':'GPU 方法直接移植'}</span></div><div class="drawer-kv"><span>GPU 原记录</span><span>#${r.gpuRecord}</span></div><div class="drawer-kv"><span>仓库历史序号</span><span>#${r.historyIndex}</span></div><div class="drawer-kv"><span>质量门槛</span><span>FineWeb loss ≤ 3.28</span></div><div class="drawer-kv"><span>规则来源</span><span>GitHub README · 无固定版本</span></div><div class="drawer-kv"><span>数据快照</span><span>${state.snapshotSha?esc(state.snapshotSha.slice(0,12)):'本机快照 · 未固定提交'}</span></div></div><div class="drawer-section"><h3>代码与运行证据</h3><p>源码和日志来自仓库中的记录目录。${state.snapshotSha?'链接已固定到本次读取的 Git commit。':'离线快照中的链接指向 master，仓库更新后内容可能变化。'} README 没有提供这条记录对应的 PR 编号。</p><a class="drawer-link" href="${versionedUrl(r.logUrl)}" target="_blank" rel="noopener noreferrer">运行日志 <span>↗</span></a><a class="drawer-link" href="${versionedUrl(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">对应源码 <span>↗</span></a><a class="drawer-link" href="${versionedUrl(r.recordUrl)}" target="_blank" rel="noopener noreferrer">记录目录 <span>↗</span></a><a class="drawer-link" href="${state.snapshotSha?`${REPO}/blob/${state.snapshotSha}/README.md#npu-leaderboard`:`${REPO}#npu-leaderboard`}" target="_blank" rel="noopener noreferrer">仓库榜单 <span>↗</span></a></div></div></aside></div>`;
    document.body.style.overflow='hidden';document.getElementById('drawerClose').focus();
  }
  function closeDrawer(){drawerRoot.innerHTML='';document.body.style.overflow=''}
  async function sync() {
    const btn=document.getElementById('syncButton');if(btn){btn.disabled=true;btn.textContent='正在读取…'}
    try {let sha=null;try{const head=await fetch('https://api.github.com/repos/zhaoyiyidan/modded-nanogpt-npu/commits/master',{cache:'no-store'});if(head.ok){const commit=await head.json();if(/^[a-f0-9]{40}$/.test(commit.sha))sha=commit.sha}}catch{}const readmeUrl=sha?RAW_README.replace('/master/',`/${sha}/`):RAW_README;const response=await fetch(readmeUrl+'?t='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const records=parseReadme(await response.text());state.records=records;state.snapshotSha=sha;state.source=sha?'GitHub 固定提交':'GitHub 实时读取';state.syncedAt=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});const scroll=window.scrollY;const focused=document.activeElement?.id;route();window.scrollTo(0,scroll);if(focused==='syncButton')document.getElementById('syncButton')?.focus()}
    catch(e){if(btn){btn.disabled=false;btn.textContent='刷新失败，重试 ↻';btn.title=String(e.message)}const note=document.querySelector('.data-note');if(note){const message=document.createElement('span');message.className='sync-error';message.textContent='GitHub 暂时无法读取，仍显示离线快照。';note.appendChild(message)}}
  }
  async function lookupPr(value) {
    const result=document.getElementById('prLookupResult');if(!result)return;
    const cleaned=value.trim();const match=cleaned.match(/^#?(\d+)$/)||cleaned.match(/^https:\/\/github\.com\/zhaoyiyidan\/modded-nanogpt-npu\/pull\/(\d+)\/?(?:[?#].*)?$/i);
    if(!match){result.textContent='请输入本仓库的 PR 编号或完整 GitHub PR 链接。';return}
    const number=Number(match[1]);if(!Number.isSafeInteger(number)||number<1){result.textContent='PR 编号无效。';return}
    result.textContent=`正在查询 PR #${number}…`;
    try{const response=await fetch(`https://api.github.com/repos/zhaoyiyidan/modded-nanogpt-npu/pulls/${number}`,{cache:'no-store'});if(response.status===404){result.textContent=`没有找到 PR #${number}。请检查仓库和编号。`;return}if(!response.ok)throw new Error(`GitHub HTTP ${response.status}`);const pr=await response.json();const status=pr.merged_at?'已合并':pr.state==='open'?(pr.draft?'草稿':'开放中'):'已关闭';result.innerHTML=`<strong>PR #${number} · ${status}</strong><span>${esc(pr.title)}</span><small>由 ${esc(pr.user?.login||'未知作者')} 提交 · 更新于 ${esc(new Date(pr.updated_at).toLocaleDateString('zh-CN'))}</small><a href="${REPO}/pull/${number}" target="_blank" rel="noopener noreferrer">在 GitHub 查看讨论与检查结果 ↗</a><em>入榜状态仍以仓库 README 为准。</em>`}
    catch(e){result.innerHTML=`<strong>暂时无法读取 PR #${number} 的状态</strong><span>${String(e.message).includes('403')?'GitHub 公共 API 已达到访问限制。':'GitHub API 暂时不可用。'}</span><a href="${REPO}/pull/${number}" target="_blank" rel="noopener noreferrer">直接在 GitHub 打开这条 PR ↗</a>`}
  }
  app.addEventListener('click',e=>{
    const scroll=e.target.closest('[href="#benchmarks"]');if(scroll){e.preventDefault();document.getElementById('benchmarks')?.scrollIntoView({behavior:'smooth'});return}
    const row=e.target.closest('[data-record]');if(row){openDrawer(row.dataset.record);return}
    const filter=e.target.closest('[data-filter]');if(filter){state.filter=filter.dataset.filter;document.getElementById('nanoBody').innerHTML=nanoBody('leaderboard');return}
    const tab=e.target.closest('[data-tab]');if(tab){location.hash='/nanogpt/'+tab.dataset.tab;return}
    const template=e.target.closest('[data-template]');if(template){state.template=template.dataset.template;app.innerHTML=create();return}
    const remove=e.target.closest('[data-delete-draft]');if(remove){const list=drafts();list.splice(Number(remove.dataset.deleteDraft),1);localStorage.setItem('npu-bench-drafts',JSON.stringify(list));updateDraftView();return}
    const removeImport=e.target.closest('[data-delete-import]');if(removeImport){const list=imports();list.splice(Number(removeImport.dataset.deleteImport),1);localStorage.setItem('npu-bench-imports',JSON.stringify(list));updateImportView();return}
    if(e.target.closest('#syncButton'))sync();
  });
  app.addEventListener('keydown',e=>{const row=e.target.closest('[data-record]');if(row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDrawer(row.dataset.record)}});
  app.addEventListener('input',e=>{if(e.target.id==='recordSearch'){state.search=e.target.value;const start=e.target.selectionStart;document.getElementById('nanoBody').innerHTML=nanoBody('leaderboard');const input=document.getElementById('recordSearch');input.focus();input.setSelectionRange(start,start)}});
  app.addEventListener('submit',e=>{if(e.target.id==='prLookupForm'){e.preventDefault();lookupPr(new FormData(e.target).get('pr'));return}if(e.target.id==='createForm'){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));saveDraft({...data,template:state.template});document.getElementById('saveState').textContent='草稿已保存在当前浏览器';e.target.reset();return}if(e.target.id==='importForm'){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));saveImport(data);document.getElementById('importSaveState').textContent='接入方案已保存在当前浏览器，尚未同步数据';e.target.reset()}});
  drawerRoot.addEventListener('click',e=>{if(e.target.id==='drawerBackdrop'||e.target.id==='drawerClose')closeDrawer()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});
  document.getElementById('menuButton').addEventListener('click',()=>{document.querySelector('.sidebar').classList.toggle('open');document.querySelector('.mobile-scrim')?.classList.toggle('show')});
  const scrim=document.createElement('div');scrim.className='mobile-scrim';scrim.addEventListener('click',()=>{document.querySelector('.sidebar').classList.remove('open');scrim.classList.remove('show')});document.body.appendChild(scrim);
  if(document.modelContext?.registerTool){try{void Promise.resolve(document.modelContext.registerTool({name:'save_benchmark_draft',title:'保存 Benchmark 草稿',description:'在当前浏览器保存一个训练、推理或算子评测赛题草稿。不会发布赛题。',inputSchema:{type:'object',properties:{template:{type:'string',enum:['training','inference','kernel']},title:{type:'string'},hardware:{type:'string'},submission:{type:'string',enum:['github-pr','platform','external']},goal:{type:'string'},dataset:{type:'string'},model:{type:'string'},metric:{type:'string'},rulesVersion:{type:'string'},url:{type:'string'},reproduce:{type:'string'},notes:{type:'string'}},required:['template','title','hardware','submission','goal','dataset','model','metric','rulesVersion'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!templates[input?.template])throw new Error('不支持的赛题类型');return saveDraft(input)}})).catch(()=>{})}catch{}}
  window.addEventListener('hashchange',route);
  route();
})();

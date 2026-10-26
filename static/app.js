/**
 * CiteGuard AI — Frontend Application
 */

const state = {
  documentText: '', documentTitle: '', verifyResults: null,
  selectedClaimId: null, activeFilter: 'all', viewMode: 'standard',
  isMockMode: false, history: []
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  tabBtns: () => $$('.tab-btn'), tabContents: () => $$('.tab-content'),
  btnLoadDemo: $('#btn-load-demo'), btnVerify: $('#btn-verify'),
  fileInput: $('#file-input'), urlInput: $('#url-input'), btnFetchUrl: $('#btn-fetch-url'),
  docTitle: $('#doc-title'), docIndicator: $('#doc-indicator'), btnClearDoc: $('#btn-clear-doc'),
  searchClaims: $('#search-claims'), filterPills: () => $$('.filter-pill'),
  claimsList: $('#claims-list'), claimsEmpty: $('#claims-empty'), heatmapTrack: $('#heatmap-track'),
  evidenceContent: $('#evidence-content'), evidenceEmpty: $('#evidence-empty'),
  toggleStandard: $('#toggle-view-standard'), toggleDiff: $('#toggle-view-diff'),
  healthRing: $('#health-ring'), healthVal: $('#health-score-val'), healthGrade: $('#health-score-grade'),
  historyDrawer: $('#history-drawer'), btnToggleHistory: $('#btn-toggle-history'), btnCloseHistory: $('#btn-close-history'), historyList: $('#history-list'),
  loadingOverlay: $('#loading-overlay'), toastContainer: $('#toast-container'),
  apiStatus: $('#api-status'), apiStatusDot: $('#api-status-dot'), mockBadge: $('#mock-badge')
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  loadHistoryFromStorage();
  bindEvents();
  checkHealth();
});

function bindEvents() {
  // Tabs & Nav
  dom.tabBtns().forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  dom.btnToggleHistory.addEventListener('click', () => dom.historyDrawer.classList.add('open'));
  dom.btnCloseHistory.addEventListener('click', () => dom.historyDrawer.classList.remove('open'));
  
  // Document Loading
  dom.btnLoadDemo.addEventListener('click', loadDemoPaper);
  dom.btnVerify.addEventListener('click', verifyCitations);
  dom.fileInput.addEventListener('change', handleFileUpload);
  dom.btnClearDoc.addEventListener('click', clearDocument);
  dom.btnFetchUrl.addEventListener('click', fetchFromUrl);

  // Filters & Toggles
  dom.filterPills().forEach(p => p.addEventListener('click', () => { state.activeFilter = p.dataset.filter; $$('.filter-pill').forEach(x => x.classList.remove('active', 'border-opacity-100')); p.classList.add('active'); renderClaimsList(); }));
  dom.searchClaims.addEventListener('input', renderClaimsList);
  
  dom.toggleStandard.addEventListener('click', () => { setViewMode('standard'); });
  dom.toggleDiff.addEventListener('click', () => { setViewMode('diff'); });

  // Exports
  $('#btn-export-json').addEventListener('click', () => exportReport('json'));
  $('#btn-export-md').addEventListener('click', () => exportReport('md'));
  $('#btn-run-benchmark').addEventListener('click', runBenchmark);

  // Global Keybinds
  document.addEventListener('keydown', handleKeyboardShortcuts);
}

function handleKeyboardShortcuts(e) {
  // Global '/' to search
  if (e.key === '/' && document.activeElement !== dom.searchClaims) {
    e.preventDefault(); dom.searchClaims.focus(); return;
  }
  // Escape to reset/close
  if (e.key === 'Escape') {
    if (document.activeElement === dom.searchClaims) dom.searchClaims.blur();
    dom.historyDrawer.classList.remove('open');
    dom.searchClaims.value = '';
    dom.filterPills()[0].click(); 
    return;
  }
  // J/K or Up/Down for claims navigation
  if ((e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement !== dom.searchClaims && document.activeElement !== dom.urlInput) {
    if (!state.verifyResults) return;
    e.preventDefault();
    const items = Array.from(dom.claimsList.querySelectorAll('.claim-card'));
    if (!items.length) return;
    const currIdx = items.findIndex(el => parseInt(el.dataset.claimId) === state.selectedClaimId);
    
    let nextItem;
    if (e.key === 'j' || e.key === 'ArrowDown') nextItem = items[currIdx + 1] || items[0];
    if (e.key === 'k' || e.key === 'ArrowUp') nextItem = items[currIdx - 1] || items[items.length - 1];
    
    if (nextItem) {
      selectClaim(parseInt(nextItem.dataset.claimId));
      nextItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function switchTab(tabId) {
  dom.tabBtns().forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  dom.tabContents().forEach(content => content.classList.toggle('active', content.id.replace('tab-', '') === tabId));
}

function setViewMode(mode) {
  state.viewMode = mode;
  dom.toggleStandard.className = mode === 'standard' ? 'px-2 py-1 text-[10px] font-bold uppercase rounded bg-indigo-600 text-white' : 'px-2 py-1 text-[10px] font-bold uppercase rounded text-slate-400 hover:text-slate-200';
  dom.toggleDiff.className = mode === 'diff' ? 'px-2 py-1 text-[10px] font-bold uppercase rounded bg-indigo-600 text-white' : 'px-2 py-1 text-[10px] font-bold uppercase rounded text-slate-400 hover:text-slate-200';
  if (state.selectedClaimId) selectClaim(state.selectedClaimId);
}

/* ==========================================================================
   API & Core Logic
   ========================================================================== */

async function apiFetch(url, options = {}) {
  if (state.isMockMode) return getMockData(url, options);
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    enableMockMode();
    return getMockData(url, options);
  }
}

function enableMockMode() {
  if (state.isMockMode) return;
  state.isMockMode = true;
  dom.mockBadge.classList.replace('hidden', 'flex');
  dom.apiStatus.textContent = 'Offline';
  dom.apiStatusDot.classList.replace('bg-emerald-500', 'bg-rose-500');
}

async function checkHealth() {
  try { await fetch('/api/health', { signal: AbortSignal.timeout(1500) }); dom.apiStatus.textContent = 'Connected'; }
  catch { enableMockMode(); }
}

function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `flex items-center gap-3 px-4 py-3 rounded-xl border bg-slate-900/90 text-white shadow-xl animate-slide-up z-[300]`;
  t.innerHTML = `<span class="text-sm">${escapeHtml(msg)}</span>`;
  dom.toastContainer.appendChild(t);
  setTimeout(() => { t.style.opacity=0; setTimeout(()=>t.remove(),300); }, 3000);
}

/* Document Uploads */
async function loadDemoPaper() {
  dom.loadingOverlay.classList.remove('hidden');
  try {
    const data = await apiFetch('/api/sample');
    setDoc(data.document_text, data.title || 'Attention Is All You Need');
  } finally { dom.loadingOverlay.classList.add('hidden'); }
}

async function handleFileUpload(e) {
  const f = e.target.files[0]; if(!f) return;
  const name = f.name;
  if(name.endsWith('.pdf') && !state.isMockMode) {
    dom.loadingOverlay.classList.remove('hidden');
    try {
      const fd = new FormData(); fd.append('file', f);
      const data = await apiFetch('/api/extract-pdf', {method:'POST', body:fd});
      setDoc(data.document_text, name);
    } finally { dom.loadingOverlay.classList.add('hidden'); }
  } else {
    const r = new FileReader();
    r.onload = ev => setDoc(ev.target.result, name);
    name.endsWith('.pdf') ? r.onload({target:{result:"Mock PDF Extracted."}}) : r.readAsText(f);
  }
}

async function fetchFromUrl() {
  const url = dom.urlInput.value.trim(); if(!url) return;
  dom.loadingOverlay.classList.remove('hidden');
  try {
    const data = await apiFetch('/api/fetch-url', {method:'POST', body:JSON.stringify({url})});
    setDoc(data.document_text, data.title || url);
  } finally { dom.loadingOverlay.classList.add('hidden'); }
}

function setDoc(txt, title) {
  state.documentText = txt; state.documentTitle = title;
  dom.docIndicator.classList.remove('hidden'); dom.docTitle.textContent = title;
  dom.btnVerify.disabled = false; dom.urlInput.value = ''; dom.fileInput.value='';
}

function clearDocument() {
  state.documentText = ''; state.verifyResults = null; state.selectedClaimId = null;
  dom.docIndicator.classList.add('hidden'); dom.btnVerify.disabled = true;
  dom.claimsList.innerHTML = ''; dom.heatmapTrack.innerHTML = ''; dom.evidenceContent.innerHTML = '';
  updateKPIs({supported:0, weakly_supported:0, mismatched:0, unverifiable:0});
}

/* Verification */
async function verifyCitations() {
  if (!state.documentText) return;
  dom.loadingOverlay.classList.remove('hidden');
  try {
    const data = await apiFetch('/api/verify', {method:'POST', body:JSON.stringify({document_text:state.documentText})});
    state.verifyResults = data;
    state.selectedClaimId = null;
    
    updateKPIs(data.summary);
    renderClaimsList();
    resetEvidencePanel();
    saveToHistory(data);
    showToast('Verification Complete', 'success');
  } finally { dom.loadingOverlay.classList.add('hidden'); }
}

/* ==========================================================================
   UI Features (Health Gauge, Heatmap, Diff View)
   ========================================================================== */

function updateKPIs(s) {
  ['supported','weak','mismatched','unverifiable'].forEach(k => {
    const el = $(`#count-${k}`); if(el) el.textContent = s[k==="weak"?"weakly_supported":k] || 0;
  });
  
  // Calculate Document Health Score
  const total = s.total_claims || 1;
  if(total === 1 && !s.supported) {
    dom.healthVal.textContent = '—'; dom.healthGrade.textContent = 'Grade: N/A';
    dom.healthRing.style.strokeDashoffset = 226; // reset
    return;
  }
  
  // Scoring formula: Supported=1, Weak=0.5, Mismatched/Unverified=0
  const score = Math.round(((s.supported + (s.weakly_supported * 0.5)) / total) * 100);
  dom.healthVal.textContent = score;
  
  const circ = 226; // 2 * PI * 36
  dom.healthRing.style.strokeDashoffset = circ - (score/100)*circ;
  
  let grade = 'F', color = '#f43f5e';
  if(score>=90){grade='A'; color='#4ade80';} else if(score>=80){grade='B'; color='#818cf8';} else if(score>=70){grade='C'; color='#fbbf24';}
  
  dom.healthGrade.textContent = `Grade: ${grade}`;
  dom.healthRing.style.stroke = color;
  dom.healthVal.style.color = color;
}

function getVC(v) {
  const c = { 
    supported: {c:'emerald', e:'🟢'}, weakly_supported: {c:'amber', e:'🟡'},
    mismatched: {c:'rose', e:'🔴'}, unverifiable: {c:'indigo', e:'⚪'}
  }[v.toLowerCase().replace(' ','_')] || {c:'slate', e:'⚪'};
  return c;
}

function renderClaimsList() {
  if(!state.verifyResults) return;
  const sq = dom.searchClaims.value.toLowerCase();
  const res = state.verifyResults.results;
  
  const filtered = res.filter(c => 
    (state.activeFilter==='all' || c.verdict === state.activeFilter) &&
    (c.claim_text.toLowerCase().includes(sq) || (c.cited_reference||'').toLowerCase().includes(sq))
  );

  dom.claimsList.innerHTML = filtered.length ? '' : '<div class="text-center text-slate-500 py-10 text-xs">No claims match filters.</div>';
  dom.heatmapTrack.innerHTML = ''; // Reset Heatmap

  filtered.forEach((claim, i) => {
    const vc = getVC(claim.verdict);
    const sel = state.selectedClaimId === claim.claim_id ? `border-l-4 border-${vc.c}-500 bg-slate-800/60` : `border-l-2 border-${vc.c}-500/50 bg-slate-900/40`;
    
    // Build Card
    const card = document.createElement('div');
    card.className = `claim-card rounded-xl p-3 border border-slate-700/50 ${sel} mb-2`;
    card.dataset.claimId = claim.claim_id;
    card.tabIndex = 0;
    
    card.innerHTML = `
      <div class="flex justify-between items-start mb-1">
        <span class="text-[10px] font-bold text-${vc.c}-400 uppercase tracking-wider">${vc.e} ${claim.verdict}</span>
        <span class="text-[10px] text-${vc.c}-400 font-mono">${Math.round(claim.confidence*100)}%</span>
      </div>
      <p class="text-xs text-slate-300 line-clamp-2">${escapeHtml(claim.claim_text)}</p>
    `;
    card.addEventListener('click', () => selectClaim(claim.claim_id));
    dom.claimsList.appendChild(card);

    // Build Heatmap Tick (Relative position based on original array index to map document position)
    const originalIndex = res.findIndex(r => r.claim_id === claim.claim_id);
    const topPct = (originalIndex / Math.max(res.length - 1, 1)) * 95; // 0 to 95% down the bar
    
    const tick = document.createElement('div');
    tick.className = `heatmap-tick bg-${vc.c}-500 shadow-[0_0_8px_rgba(var(--tw-colors-${vc.c}-500),0.8)]`;
    tick.style.top = `${topPct}%`;
    tick.title = `Jump to Claim #${claim.claim_id}`;
    tick.addEventListener('click', () => { selectClaim(claim.claim_id); card.scrollIntoView({behavior:'smooth', block:'center'}); });
    dom.heatmapTrack.appendChild(tick);
  });
}

function selectClaim(id) {
  state.selectedClaimId = id;
  $$('.claim-card').forEach(c => {
    const isSel = parseInt(c.dataset.claimId) === id;
    c.classList.toggle('border-l-4', isSel); c.classList.toggle('bg-slate-800/60', isSel);
    c.classList.toggle('border-l-2', !isSel); c.classList.toggle('bg-slate-900/40', !isSel);
  });
  const claim = state.verifyResults.results.find(r => r.claim_id === id);
  if(claim) renderEvidence(claim);
}

// Side-by-Side Diff Logic (Heuristic matching for numbers/keywords)
function generateDiffHtml(claimTxt, sourceTxt) {
  if (!sourceTxt) return { c: escapeHtml(claimTxt), s: '<i>No source available</i>' };
  
  // Very crude hackathon diff: Highlight numbers or capitalized words in Claim missing in Source
  const sNorm = sourceTxt.toLowerCase();
  const cNorm = claimTxt.toLowerCase();
  
  const cWords = claimTxt.split(/(\s+)/);
  const sWords = sourceTxt.split(/(\s+)/);

  const cHtml = cWords.map(w => {
    if (w.trim().match(/\d+/) && !sNorm.includes(w.trim().toLowerCase())) 
      return `<span class="diff-removed">${escapeHtml(w)}</span>`;
    return escapeHtml(w);
  }).join('');

  const sHtml = sWords.map(w => {
    if (w.trim().match(/\d+/) && !cNorm.includes(w.trim().toLowerCase()))
      return `<span class="diff-added">${escapeHtml(w)}</span>`;
    return escapeHtml(w);
  }).join('');

  return { c: cHtml, s: sHtml };
}

function renderEvidence(claim) {
  const vc = getVC(claim.verdict);
  
  let rewriteHtml = '';
  if ((claim.verdict === 'Mismatched' || claim.verdict === 'Weakly Supported') && claim.suggested_rewrite) {
    rewriteHtml = `
      <div class="mt-4 p-3 rounded-xl bg-${vc.c}-950/40 border border-${vc.c}-500/30">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold text-${vc.c}-400 uppercase"><i data-lucide="sparkles" class="w-3 h-3 inline mr-1"></i> AI Rewrite Suggestion</span>
          <button onclick="navigator.clipboard.writeText('${escapeHtml(claim.suggested_rewrite.replace(/'/g,"\\'"))}'); this.innerText='Copied!'" class="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 hover:text-white transition">Copy Fix</button>
        </div>
        <p class="text-sm text-${vc.c}-200 italic font-medium">"${escapeHtml(claim.suggested_rewrite)}"</p>
      </div>`;
  }

  // Handle Standard vs Diff View
  let contentHtml = '';
  if (state.viewMode === 'diff') {
    const diffs = generateDiffHtml(claim.claim_text, claim.evidence_snippet);
    contentHtml = `
      <div class="grid grid-cols-2 gap-4">
        <div class="p-3 bg-slate-900/60 rounded-xl border border-slate-700/50">
          <h4 class="text-[10px] font-bold text-slate-400 uppercase mb-2 text-center">Author Claim</h4>
          <p class="text-xs text-slate-200 leading-relaxed">${diffs.c}</p>
        </div>
        <div class="p-3 bg-slate-900/60 rounded-xl border border-slate-700/50">
          <h4 class="text-[10px] font-bold text-slate-400 uppercase mb-2 text-center">Source Text</h4>
          <p class="text-xs text-slate-200 leading-relaxed">${diffs.s}</p>
        </div>
      </div>
    `;
  } else {
    contentHtml = `
      <div class="mb-4">
        <h4 class="text-[10px] font-bold text-indigo-400 uppercase mb-1">Document Claim</h4>
        <div class="p-3 bg-slate-800/40 border-l-2 border-indigo-500 rounded-r-lg text-sm text-slate-200">${escapeHtml(claim.claim_text)}</div>
      </div>
      <div>
        <h4 class="text-[10px] font-bold text-amber-400 uppercase mb-1">Source Passage</h4>
        <div class="p-3 bg-slate-800/40 border-l-2 border-amber-500 rounded-r-lg text-sm text-slate-300">${claim.evidence_snippet ? escapeHtml(claim.evidence_snippet) : '<i class="text-slate-500">Not available</i>'}</div>
      </div>
    `;
  }

  dom.evidenceContent.innerHTML = `
    <div class="animate-fade-in pb-8">
      <div class="flex items-center gap-3 mb-4 p-3 rounded-xl bg-slate-900 border border-slate-700">
        <span class="px-2 py-1 rounded bg-${vc.c}-950/60 text-${vc.c}-400 text-xs font-bold border border-${vc.c}-700/50 uppercase">${vc.e} ${claim.verdict}</span>
        <span class="text-xs text-slate-400">Score: <span class="font-mono text-white">${Math.round(claim.confidence*100)}%</span></span>
        <span class="ml-auto text-xs text-slate-500 flex items-center gap-1"><i data-lucide="book" class="w-3 h-3"></i> ${escapeHtml(claim.cited_reference)}</span>
      </div>
      
      ${contentHtml}

      <div class="mt-4 p-3 rounded-xl bg-purple-950/20 border border-purple-800/20">
        <h4 class="text-[10px] font-bold text-purple-400 uppercase mb-1 flex items-center gap-1"><i data-lucide="brain" class="w-3 h-3"></i> AI Diagnostic</h4>
        <p class="text-sm text-slate-300 leading-relaxed">${escapeHtml(claim.explanation)}</p>
      </div>

      ${rewriteHtml}
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function resetEvidencePanel() {
  dom.evidenceContent.innerHTML = `<div class="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-sm">Select a claim to inspect</div>`;
}

/* ==========================================================================
   Saved Sessions (History Drawer)
   ========================================================================== */

function saveToHistory(data) {
  const record = {
    id: Date.now(),
    title: state.documentTitle || 'Untitled Verification',
    date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
    data: data
  };
  state.history.unshift(record);
  if(state.history.length > 5) state.history.pop();
  localStorage.setItem('citeguard_history', JSON.stringify(state.history));
  renderHistory();
}

function loadHistoryFromStorage() {
  try {
    const raw = localStorage.getItem('citeguard_history');
    if(raw) state.history = JSON.parse(raw);
    renderHistory();
  } catch(e){ console.warn("Failed to load history"); }
}

function renderHistory() {
  if(!state.history.length) return;
  dom.historyList.innerHTML = '';
  state.history.forEach(item => {
    const s = item.data.summary;
    const score = Math.round(((s.supported + (s.weakly_supported * 0.5)) / (s.total_claims||1)) * 100);
    const div = document.createElement('div');
    div.className = 'p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 cursor-pointer transition-colors';
    div.innerHTML = `
      <div class="flex justify-between items-start mb-1">
        <h4 class="text-xs font-bold text-slate-200 truncate pr-2">${escapeHtml(item.title)}</h4>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-emerald-400 font-mono border border-slate-700">${score}%</span>
      </div>
      <p class="text-[10px] text-slate-500 mb-2">${item.date}</p>
      <div class="flex gap-2 text-[10px]">
        <span class="text-emerald-400">🟢 ${s.supported}</span>
        <span class="text-amber-400">🟡 ${s.weakly_supported}</span>
        <span class="text-rose-400">🔴 ${s.mismatched}</span>
      </div>
    `;
    div.addEventListener('click', () => {
      dom.historyDrawer.classList.remove('open');
      state.verifyResults = item.data;
      state.documentTitle = item.title;
      state.documentText = 'Loaded from history';
      dom.docIndicator.classList.remove('hidden'); dom.docTitle.textContent = item.title;
      updateKPIs(item.data.summary);
      renderClaimsList();
      resetEvidencePanel();
      showToast('Session loaded', 'success');
    });
    dom.historyList.appendChild(div);
  });
}

/* ==========================================================================
   Exports & Benchmarks
   ========================================================================== */

function exportReport(format) {
  if (!state.verifyResults) return showToast('No data', 'error');
  const d = state.verifyResults, s = d.summary;
  let content = '', mime = '', ext = '';
  if (format === 'json') {
    content = JSON.stringify(d, null, 2); mime = 'application/json'; ext = '.json';
  } else {
    content = `# Audit Report\nTotal Claims: ${s.total_claims} | Supported: ${s.supported} | Weak: ${s.weakly_supported} | Mismatch: ${s.mismatched}\n\n`;
    d.results.forEach(r => content += `## Claim: ${r.claim_text}\n**Verdict:** ${r.verdict}\n**Ref:** ${r.cited_reference}\n**AI:** ${r.explanation}\n\n`);
    mime = 'text/markdown'; ext = '.md';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type: mime}));
  a.download = `citeguard_audit${ext}`; a.click();
}

async function runBenchmark() {
  dom.benchmarkResults.innerHTML = '<div class="glass rounded-2xl p-12 text-center text-slate-400">Running suite...</div>';
  const data = await apiFetch('/api/benchmark');
  dom.benchmarkResults.innerHTML = `
    <div class="glass rounded-2xl p-6 text-center">
      <h3 class="text-2xl font-bold text-emerald-400 mb-2">${Math.round(data.overall_accuracy*100)}% Accuracy</h3>
      <p class="text-slate-300">${data.correct_predictions} of ${data.total_cases} passed.</p>
    </div>
  `;
}

function escapeHtml(str) { const d = document.createElement('div'); d.innerText = str||''; return d.innerHTML; }

/* Mock Data Fallback */
function getMockData(url) {
  return new Promise(res => setTimeout(() => {
    if(url === '/api/sample' || url === '/api/fetch-url') res({ document_text: "Mock text.", title: "Attention Is All You Need" });
    if(url === '/api/verify') res({
      summary: { total_claims: 2, supported: 1, weakly_supported: 0, mismatched: 1, unverifiable: 0 },
      results: [
        { claim_id: 1, verdict: "Supported", confidence: 0.94, claim_text: "Transformers dispense with recurrence.", citation_marker: "[1]", cited_reference: "Vaswani 2017", source_found: true, evidence_snippet: "We propose the Transformer, dispensing with recurrence.", explanation: "Source confirms claim." },
        { claim_id: 2, verdict: "Mismatched", confidence: 0.88, claim_text: "LLMs require 85% less data.", citation_marker: "[2]", cited_reference: "Kaplan 2020", source_found: true, evidence_snippet: "Model performance necessitates 58% more corpora.", explanation: "Contradiction.", suggested_rewrite: "LLMs require significantly larger training datasets." }
      ]
    });
    if(url === '/api/benchmark') res({ overall_accuracy: 0.85, total_cases: 10, correct_predictions: 8 });
  }, 800));
}

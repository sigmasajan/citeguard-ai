/**
 * CiteGuard AI — Frontend Application
 */

const state = {
  documentText: '', documentTitle: '', verifyResults: null,
  selectedClaimId: null, activeFilter: 'all', viewMode: 'standard',
  isMockMode: false, history: [],
  isPaletteOpen: false, isKeymapOpen: false,
  paletteSelectedIndex: 0, paletteCommands: []
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // Tabs & Triggers
  tabBtns: () => $$('.tab-btn'), tabContents: () => $$('.tab-content'),
  btnLoadDemo: $('#btn-load-demo'), btnVerify: $('#btn-verify'),
  fileInput: $('#file-input'), urlInput: $('#url-input'), btnFetchUrl: $('#btn-fetch-url'),
  docTitle: $('#doc-title'), docIndicator: $('#doc-indicator'), btnClearDoc: $('#btn-clear-doc'),
  
  // Panels & Data
  searchClaims: $('#search-claims'), filterPills: () => $$('.filter-pill'),
  claimsList: $('#claims-list'), claimsEmpty: $('#claims-empty'), heatmapTrack: $('#heatmap-track'),
  evidenceContent: $('#evidence-content'), evidenceEmpty: $('#evidence-empty'),
  toggleStandard: $('#toggle-view-standard'), toggleDiff: $('#toggle-view-diff'),
  healthRing: $('#health-ring'), healthVal: $('#health-score-val'), healthGrade: $('#health-score-grade'),
  
  // Modals & Drawers
  historyDrawer: $('#history-drawer'), btnToggleHistory: $('#btn-toggle-history'), btnCloseHistory: $('#btn-close-history'), historyList: $('#history-list'),
  cmdPaletteModal: $('#cmd-palette-modal'), cmdPaletteInput: $('#cmd-palette-input'), cmdPaletteList: $('#cmd-palette-list'), btnOpenPaletteNav: $('#btn-open-palette-nav'),
  keymapModal: $('#keymap-modal'), btnCloseKeymap: $('#btn-close-keymap'), floatingHotkeys: $('#floating-hotkeys'),
  
  // Utils
  loadingOverlay: $('#loading-overlay'), loadingText: $('#loading-text'), toastContainer: $('#toast-container'),
  apiStatus: $('#api-status'), apiStatusDot: $('#api-status-dot'), mockBadge: $('#mock-badge')
};

// Available Commands for the Palette
const allCommands = [
  { id: 'load_demo', icon: 'flask-conical', text: 'Load Sample Paper', action: () => loadDemoPaper() },
  { id: 'verify', icon: 'search-check', text: 'Verify Citations', action: () => verifyCitations() },
  { id: 'clear_doc', icon: 'x-circle', text: 'Clear Document', action: () => clearDocument() },
  { id: 'filter_mismatch', icon: 'filter', text: 'Filter: Mismatched Claims', action: () => { state.activeFilter = 'Mismatched'; updateFilterPills(); renderClaimsList(); } },
  { id: 'filter_support', icon: 'filter', text: 'Filter: Supported Claims', action: () => { state.activeFilter = 'Supported'; updateFilterPills(); renderClaimsList(); } },
  { id: 'filter_all', icon: 'filter', text: 'Clear Filters', action: () => { state.activeFilter = 'all'; updateFilterPills(); renderClaimsList(); } },
  { id: 'export_json', icon: 'braces', text: 'Download Audit (.json)', action: () => exportReport('json') },
  { id: 'export_md', icon: 'file-text', text: 'Download Audit (.md)', action: () => exportReport('md') },
  { id: 'history', icon: 'history', text: 'Toggle History Sessions', action: () => dom.historyDrawer.classList.toggle('open') }
];

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  loadHistoryFromStorage();
  bindEvents();
  checkHealth();
});

function bindEvents() {
  // Document Operations
  dom.btnLoadDemo.addEventListener('click', loadDemoPaper);
  dom.btnVerify.addEventListener('click', verifyCitations);
  dom.fileInput.addEventListener('change', handleFileUpload);
  dom.btnClearDoc.addEventListener('click', clearDocument);
  dom.btnFetchUrl.addEventListener('click', fetchFromUrl);

  // Filters & Toggles
  dom.filterPills().forEach(p => p.addEventListener('click', () => { state.activeFilter = p.dataset.filter; updateFilterPills(); renderClaimsList(); }));
  dom.searchClaims.addEventListener('input', renderClaimsList);
  dom.toggleStandard.addEventListener('click', () => setViewMode('standard'));
  dom.toggleDiff.addEventListener('click', () => setViewMode('diff'));

  // Modals & Drawers
  dom.btnToggleHistory.addEventListener('click', () => dom.historyDrawer.classList.add('open'));
  dom.btnCloseHistory.addEventListener('click', () => dom.historyDrawer.classList.remove('open'));
  dom.floatingHotkeys.addEventListener('click', () => openKeymapModal());
  dom.btnCloseKeymap.addEventListener('click', () => closeModals());
  $('#keymap-backdrop').addEventListener('click', closeModals);
  $('#cmd-palette-backdrop').addEventListener('click', closeModals);
  dom.btnOpenPaletteNav.addEventListener('click', openCommandPalette);

  // Command Palette Input
  dom.cmdPaletteInput.addEventListener('input', () => renderCommandPalette());

  // Global Keybinds
  document.addEventListener('keydown', handleKeyboardShortcuts);
}

/* ==========================================================================
   Global Keyboard Shortcuts (J/K, Cmd+K, Esc, /)
   ========================================================================== */

function handleKeyboardShortcuts(e) {
  // Cmd+K or Ctrl+K -> Command Palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    state.isPaletteOpen ? closeModals() : openCommandPalette();
    return;
  }

  // Escape -> Close Modals or Reset Filters
  if (e.key === 'Escape') {
    if (state.isPaletteOpen || state.isKeymapOpen) { closeModals(); return; }
    if (document.activeElement === dom.searchClaims) dom.searchClaims.blur();
    dom.historyDrawer.classList.remove('open');
    dom.searchClaims.value = '';
    dom.filterPills()[0].click(); 
    return;
  }

  // '/' -> Focus Search Claims (only if modals are closed and not already in input)
  if (e.key === '/' && !state.isPaletteOpen && !state.isKeymapOpen && document.activeElement !== dom.searchClaims && document.activeElement !== dom.urlInput) {
    e.preventDefault(); dom.searchClaims.focus(); return;
  }

  // Command Palette Arrow Navigation
  if (state.isPaletteOpen) {
    if (e.key === 'ArrowDown') { e.preventDefault(); navigatePalette(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); navigatePalette(-1); return; }
    if (e.key === 'Enter') { e.preventDefault(); executeSelectedCommand(); return; }
    return;
  }

  // J/K or Up/Down -> Navigate Claims (Smooth scroll + Ring Focus)
  if ((e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
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

/* ==========================================================================
   Command Palette Logic
   ========================================================================== */

function openCommandPalette() {
  state.isPaletteOpen = true;
  dom.cmdPaletteModal.classList.remove('hidden');
  dom.cmdPaletteInput.value = '';
  renderCommandPalette();
  setTimeout(() => dom.cmdPaletteInput.focus(), 50);
}

function openKeymapModal() {
  state.isKeymapOpen = true;
  dom.keymapModal.classList.remove('hidden');
}

function closeModals() {
  state.isPaletteOpen = false; state.isKeymapOpen = false;
  dom.cmdPaletteModal.classList.add('hidden');
  dom.keymapModal.classList.add('hidden');
}

function renderCommandPalette() {
  const query = dom.cmdPaletteInput.value.toLowerCase();
  state.paletteCommands = allCommands.filter(c => c.text.toLowerCase().includes(query));
  state.paletteSelectedIndex = 0;
  
  dom.cmdPaletteList.innerHTML = '';
  if (state.paletteCommands.length === 0) {
    dom.cmdPaletteList.innerHTML = `<div class="p-4 text-center text-sm text-slate-500">No matching commands found.</div>`;
    return;
  }
  
  state.paletteCommands.forEach((cmd, idx) => {
    const div = document.createElement('div');
    div.className = `cmd-item flex items-center gap-3 p-3 rounded-xl cursor-pointer text-slate-300 hover:bg-slate-800/80 ${idx === 0 ? 'active' : ''}`;
    div.innerHTML = `<i data-lucide="${cmd.icon}" class="w-4 h-4 text-slate-400"></i><span class="text-sm font-medium">${cmd.text}</span>`;
    div.addEventListener('click', () => { state.paletteSelectedIndex = idx; executeSelectedCommand(); });
    dom.cmdPaletteList.appendChild(div);
  });
  if (window.lucide) lucide.createIcons();
}

function navigatePalette(dir) {
  const items = dom.cmdPaletteList.querySelectorAll('.cmd-item');
  if (!items.length) return;
  items[state.paletteSelectedIndex].classList.remove('active');
  state.paletteSelectedIndex = (state.paletteSelectedIndex + dir + items.length) % items.length;
  items[state.paletteSelectedIndex].classList.add('active');
  items[state.paletteSelectedIndex].scrollIntoView({ block: 'nearest' });
}

function executeSelectedCommand() {
  const cmd = state.paletteCommands[state.paletteSelectedIndex];
  if (cmd) { closeModals(); cmd.action(); }
}

/* ==========================================================================
   UI Helpers & Render Logic
   ========================================================================== */

function updateFilterPills() {
  dom.filterPills().forEach(p => {
    p.classList.toggle('active', p.dataset.filter === state.activeFilter);
    p.classList.toggle('border-opacity-100', p.dataset.filter === state.activeFilter);
  });
}

function setViewMode(mode) {
  state.viewMode = mode;
  dom.toggleStandard.className = mode === 'standard' ? 'px-2 py-1 text-[10px] font-bold uppercase rounded bg-indigo-600 text-white' : 'px-2 py-1 text-[10px] font-bold uppercase rounded text-slate-400 hover:text-slate-200';
  dom.toggleDiff.className = mode === 'diff' ? 'px-2 py-1 text-[10px] font-bold uppercase rounded bg-indigo-600 text-white' : 'px-2 py-1 text-[10px] font-bold uppercase rounded text-slate-400 hover:text-slate-200';
  if (state.selectedClaimId) selectClaim(state.selectedClaimId);
}

function getVC(v) {
  const c = { supported: {c:'emerald', e:'🟢'}, weakly_supported: {c:'amber', e:'🟡'}, mismatched: {c:'rose', e:'🔴'}, unverifiable: {c:'indigo', e:'⚪'} }[v.toLowerCase().replace(' ','_')] || {c:'slate', e:'⚪'};
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

  dom.claimsList.innerHTML = filtered.length ? '' : '<div class="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs p-6"><i data-lucide="search-x" class="w-6 h-6 mb-2"></i>No claims match search.</div>';
  dom.heatmapTrack.innerHTML = ''; 

  filtered.forEach((claim, i) => {
    const vc = getVC(claim.verdict);
    // Smooth Scale & Ring applied if selected
    const isSelected = state.selectedClaimId === claim.claim_id;
    const selClasses = isSelected ? `ring-2 ring-indigo-500 scale-[1.01] bg-slate-800/80 shadow-lg border-${vc.c}-500` : `bg-slate-900/40 border-slate-700/50 hover:bg-slate-800/40 scale-100`;
    
    const card = document.createElement('div');
    card.className = `claim-card rounded-xl p-3 border-l-4 transition-all duration-200 ${selClasses} mb-2`;
    card.dataset.claimId = claim.claim_id;
    
    card.innerHTML = `
      <div class="flex justify-between items-start mb-1">
        <span class="text-[10px] font-bold text-${vc.c}-400 uppercase tracking-wider">${vc.e} ${claim.verdict}</span>
        <span class="text-[10px] text-${vc.c}-400 font-mono">${Math.round(claim.confidence*100)}%</span>
      </div>
      <p class="text-xs text-slate-300 line-clamp-2">${escapeHtml(claim.claim_text)}</p>
    `;
    card.addEventListener('click', () => selectClaim(claim.claim_id));
    dom.claimsList.appendChild(card);

    // Document Heatmap Tick
    const originalIndex = res.findIndex(r => r.claim_id === claim.claim_id);
    const topPct = (originalIndex / Math.max(res.length - 1, 1)) * 95; 
    const tick = document.createElement('div');
    tick.className = `heatmap-tick bg-${vc.c}-500 shadow-[0_0_8px_rgba(var(--tw-colors-${vc.c}-500),0.8)]`;
    tick.style.top = `${topPct}%`;
    tick.title = `Jump to Claim #${claim.claim_id}`;
    tick.addEventListener('click', () => { selectClaim(claim.claim_id); card.scrollIntoView({behavior:'smooth', block:'center'}); });
    dom.heatmapTrack.appendChild(tick);
  });
  if (window.lucide) lucide.createIcons();
}

function selectClaim(id) {
  state.selectedClaimId = id;
  // Re-render claims list purely to apply the scale/ring logic easily without complex DOM class-swapping
  renderClaimsList();
  const claim = state.verifyResults.results.find(r => r.claim_id === id);
  if(claim) renderEvidence(claim);
}

// Side-by-Side Diff Logic
function generateDiffHtml(claimTxt, sourceTxt) {
  if (!sourceTxt) return { c: escapeHtml(claimTxt), s: '<i>No source available</i>' };
  const sNorm = sourceTxt.toLowerCase(), cNorm = claimTxt.toLowerCase();
  const cWords = claimTxt.split(/(\s+)/), sWords = sourceTxt.split(/(\s+)/);

  const cHtml = cWords.map(w => {
    if (w.trim().match(/\d+/) && !sNorm.includes(w.trim().toLowerCase())) return `<span class="diff-removed">${escapeHtml(w)}</span>`;
    return escapeHtml(w);
  }).join('');

  const sHtml = sWords.map(w => {
    if (w.trim().match(/\d+/) && !cNorm.includes(w.trim().toLowerCase())) return `<span class="diff-added">${escapeHtml(w)}</span>`;
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
          <button onclick="navigator.clipboard.writeText('${escapeHtml(claim.suggested_rewrite.replace(/'/g,"\\'"))}'); this.innerText='Copied!'" class="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 hover:text-white transition shadow-sm border border-slate-700">Copy Fix</button>
        </div>
        <p class="text-sm text-${vc.c}-200 italic font-medium">"${escapeHtml(claim.suggested_rewrite)}"</p>
      </div>`;
  }

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
        <div class="p-3 bg-slate-800/40 border-l-2 border-indigo-500 rounded-r-lg text-sm text-slate-200 shadow-inner">${escapeHtml(claim.claim_text)}</div>
      </div>
      <div>
        <h4 class="text-[10px] font-bold text-amber-400 uppercase mb-1">Source Passage</h4>
        <div class="p-3 bg-slate-800/40 border-l-2 border-amber-500 rounded-r-lg text-sm text-slate-300 shadow-inner">${claim.evidence_snippet ? escapeHtml(claim.evidence_snippet) : '<i class="text-slate-500">Not available</i>'}</div>
      </div>
    `;
  }

  dom.evidenceContent.innerHTML = `
    <div class="animate-fade-in pb-8">
      <div class="flex items-center gap-3 mb-4 p-3 rounded-xl bg-slate-900/80 border border-slate-700/80 shadow-md">
        <span class="px-2 py-1 rounded bg-${vc.c}-950/60 text-${vc.c}-400 text-xs font-bold border border-${vc.c}-700/50 uppercase">${vc.e} ${claim.verdict}</span>
        <span class="text-xs text-slate-400">Score: <span class="font-mono text-white">${Math.round(claim.confidence*100)}%</span></span>
        <span class="ml-auto text-xs text-slate-400 flex items-center gap-1.5 px-2 py-1 bg-slate-800 rounded-lg"><i data-lucide="book" class="w-3.5 h-3.5 text-indigo-400"></i> ${escapeHtml(claim.cited_reference)}</span>
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
  dom.evidenceContent.innerHTML = `<div class="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs"><i data-lucide="mouse-pointer-click" class="w-8 h-8 mb-2 opacity-50"></i>Select a claim to inspect</div>`;
  if (window.lucide) lucide.createIcons();
}

/* ==========================================================================
   History Storage & KPIs
   ========================================================================== */

function saveToHistory(data) {
  const record = { id: Date.now(), title: state.documentTitle || 'Untitled', date: new Date().toLocaleString(), data: data };
  state.history.unshift(record);
  if(state.history.length > 5) state.history.pop();
  localStorage.setItem('citeguard_history', JSON.stringify(state.history));
  renderHistory();
}

function loadHistoryFromStorage() {
  try { const raw = localStorage.getItem('citeguard_history'); if(raw) { state.history = JSON.parse(raw); renderHistory(); } } catch(e){}
}

function renderHistory() {
  if(!state.history.length) return;
  dom.historyList.innerHTML = '';
  state.history.forEach(item => {
    const s = item.data.summary;
    const score = Math.round(((s.supported + (s.weakly_supported * 0.5)) / (s.total_claims||1)) * 100);
    const div = document.createElement('div');
    div.className = 'p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 cursor-pointer transition-colors shadow-sm';
    div.innerHTML = `
      <div class="flex justify-between items-start mb-1">
        <h4 class="text-xs font-bold text-slate-200 truncate pr-2">${escapeHtml(item.title)}</h4>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-emerald-400 font-mono border border-slate-700">${score}%</span>
      </div>
      <p class="text-[10px] text-slate-500 mb-2">${item.date}</p>
      <div class="flex gap-2 text-[10px] font-mono">
        <span class="text-emerald-400">S:${s.supported}</span>
        <span class="text-amber-400">W:${s.weakly_supported}</span>
        <span class="text-rose-400">M:${s.mismatched}</span>
      </div>
    `;
    div.addEventListener('click', () => {
      dom.historyDrawer.classList.remove('open');
      state.verifyResults = item.data; state.documentTitle = item.title; state.documentText = 'Loaded from history';
      dom.docIndicator.classList.remove('hidden'); dom.docTitle.textContent = item.title;
      updateKPIs(item.data.summary); renderClaimsList(); resetEvidencePanel();
      showToast('Session loaded', 'success');
    });
    dom.historyList.appendChild(div);
  });
}

function updateKPIs(s) {
  ['supported','weak','mismatched','unverifiable'].forEach(k => { const el = $(`#count-${k}`); if(el) el.textContent = s[k==="weak"?"weakly_supported":k] || 0; });
  const total = s.total_claims || 1;
  if(total === 1 && !s.supported) {
    dom.healthVal.textContent = '—'; dom.healthGrade.textContent = 'Grade: N/A';
    dom.healthRing.style.strokeDashoffset = 226; return;
  }
  const score = Math.round(((s.supported + (s.weakly_supported * 0.5)) / total) * 100);
  dom.healthVal.textContent = score;
  dom.healthRing.style.strokeDashoffset = 226 - (score/100)*226;
  let grade = 'F', color = '#f43f5e';
  if(score>=90){grade='A'; color='#4ade80';} else if(score>=80){grade='B'; color='#818cf8';} else if(score>=70){grade='C'; color='#fbbf24';}
  dom.healthGrade.textContent = `Grade: ${grade}`; dom.healthRing.style.stroke = color; dom.healthVal.style.color = color;
}

/* ==========================================================================
   Action Implementations (Load, Verify, Export)
   ========================================================================== */

async function loadDemoPaper() {
  showLoading('Loading demo...');
  try {
    const data = await apiFetch('/api/sample');
    setDoc(data.document_text, data.title || 'Attention Is All You Need.pdf');
    showToast('Demo loaded', 'success');
  } finally { hideLoading(); }
}

async function handleFileUpload(e) {
  const f = e.target.files[0]; if(!f) return;
  const name = f.name;
  if(name.endsWith('.pdf') && !state.isMockMode) {
    showLoading('Extracting PDF...');
    try {
      const fd = new FormData(); fd.append('file', f);
      const data = await apiFetch('/api/extract-pdf', {method:'POST', body:fd});
      setDoc(data.document_text, name);
      showToast('PDF extracted', 'success');
    } finally { hideLoading(); }
  } else {
    const r = new FileReader(); r.onload = ev => { setDoc(ev.target.result, name); showToast('Loaded', 'success'); };
    name.endsWith('.pdf') ? r.onload({target:{result:"Mock PDF Extracted."}}) : r.readAsText(f);
  }
}

async function fetchFromUrl() {
  const url = dom.urlInput.value.trim(); if(!url) return showToast('Enter valid URL', 'warn');
  showLoading('Fetching URL...');
  try {
    const data = await apiFetch('/api/fetch-url', {method:'POST', body:JSON.stringify({url})});
    setDoc(data.document_text, data.title || url);
    showToast('Fetched successfully', 'success');
  } finally { hideLoading(); }
}

function setDoc(txt, title) {
  state.documentText = txt; state.documentTitle = title;
  dom.docIndicator.classList.remove('hidden'); dom.docTitle.textContent = title;
  dom.btnVerify.disabled = false; dom.urlInput.value = ''; dom.fileInput.value='';
}

function clearDocument() {
  state.documentText = ''; state.verifyResults = null; state.selectedClaimId = null;
  dom.docIndicator.classList.add('hidden'); dom.btnVerify.disabled = true;
  dom.claimsList.innerHTML = '<div class="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs p-6"><i data-lucide="file-search" class="w-8 h-8 mb-2"></i>No claims extracted yet</div>'; 
  dom.heatmapTrack.innerHTML = ''; resetEvidencePanel();
  updateKPIs({supported:0, weakly_supported:0, mismatched:0, unverifiable:0});
  if(window.lucide) lucide.createIcons();
  showToast('Document cleared', 'info');
}

async function verifyCitations() {
  if (!state.documentText) return showToast('Please load a document', 'warn');
  showLoading('Verifying citations...');
  try {
    const data = await apiFetch('/api/verify', {method:'POST', body:JSON.stringify({document_text:state.documentText})});
    state.verifyResults = data; state.selectedClaimId = null; state.activeFilter = 'all';
    updateFilterPills(); updateKPIs(data.summary); renderClaimsList(); resetEvidencePanel(); saveToHistory(data);
    showToast('Verification Complete', 'success');
  } finally { hideLoading(); }
}

function exportReport(format) {
  if (!state.verifyResults) return showToast('No data to export', 'error');
  const d = state.verifyResults, s = d.summary;
  let content = '', mime = '', ext = '';
  if (format === 'json') {
    content = JSON.stringify(d, null, 2); mime = 'application/json'; ext = '.json';
  } else {
    content = `# Audit Report\nTotal Claims: ${s.total_claims} | Supported: ${s.supported} | Weak: ${s.weakly_supported} | Mismatch: ${s.mismatched}\n\n`;
    d.results.forEach(r => content += `## Claim: ${r.claim_text}\n**Verdict:** ${r.verdict}\n**Ref:** ${r.cited_reference}\n**AI:** ${r.explanation}\n\n`);
    mime = 'text/markdown'; ext = '.md';
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], {type: mime}));
  a.download = `citeguard_audit${ext}`; a.click();
  showToast(`Exported ${ext}`, 'success');
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
  }, 800));
}

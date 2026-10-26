/**
 * CiteGuard AI — Complete Production Frontend Application
 * Includes: Full API integration, Auto-Mock Fallback, Live Diff Viewer,
 * Document Heatmap, Health Score Ring, LocalStorage Sessions, and ⌘K Command Palette.
 */

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const state = {
  documentText: '',
  sourceTexts: {},
  documentTitle: '',
  verifyResults: null,
  benchmarkData: null,
  selectedClaimId: null,
  activeFilter: 'all',
  activeTab: 'inspector',
  viewMode: 'standard',
  isLoading: false,
  isMockMode: false,
  history: [],
  isPaletteOpen: false,
  isKeymapOpen: false,
  paletteSelectedIndex: 0,
  paletteCommands: []
};

// ═══════════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  tabBtns: () => $$('.tab-btn'),
  tabContents: () => $$('.tab-content'),

  btnLoadDemo: $('#btn-load-demo'),
  btnVerify: $('#btn-verify'),
  fileInput: $('#file-input'),
  fileLabel: $('#file-label'),
  urlInput: $('#url-input'),
  btnFetchUrl: $('#btn-fetch-url'),
  docIndicator: $('#doc-indicator'),
  docTitle: $('#doc-title'),
  btnClearDoc: $('#btn-clear-doc'),

  healthRing: $('#health-ring'),
  healthVal: $('#health-score-val'),
  healthGrade: $('#health-score-grade'),
  healthDesc: $('#health-score-desc'),

  countSupported: $('#count-supported'),
  countWeak: $('#count-weak'),
  countMismatched: $('#count-mismatched'),
  countUnverifiable: $('#count-unverifiable'),
  barSupported: $('#bar-supported'),
  barWeak: $('#bar-weak'),
  barMismatched: $('#bar-mismatched'),
  barUnverifiable: $('#bar-unverifiable'),

  searchClaims: $('#search-claims'),
  filterPills: () => $$('.filter-pill'),
  claimsList: $('#claims-list'),
  claimsEmpty: $('#claims-empty'),
  claimsCountBadge: $('#claims-count-badge'),
  heatmapTrack: $('#heatmap-track'),

  evidenceContent: $('#evidence-content'),
  evidenceEmpty: $('#evidence-empty'),
  toggleStandard: $('#toggle-view-standard'),
  toggleDiff: $('#toggle-view-diff'),

  btnRunBenchmark: $('#btn-run-benchmark'),
  benchmarkResults: $('#benchmark-results'),
  benchmarkEmpty: $('#benchmark-empty'),

  exportEmpty: $('#export-empty'),
  exportOptions: $('#export-options'),
  exportPreview: $('#export-preview'),
  exportPreviewContent: $('#export-preview-content'),
  exportStats: $('#export-stats'),
  btnExportJson: $('#btn-export-json'),
  btnExportMd: $('#btn-export-md'),
  btnCopyExport: $('#btn-copy-export'),

  historyDrawer: $('#history-drawer'),
  btnToggleHistory: $('#btn-toggle-history'),
  btnCloseHistory: $('#btn-close-history'),
  historyList: $('#history-list'),
  historyCountBadge: $('#history-count-badge'),

  cmdPaletteModal: $('#cmd-palette-modal'),
  cmdPaletteInput: $('#cmd-palette-input'),
  cmdPaletteList: $('#cmd-palette-list'),
  btnOpenPaletteNav: $('#btn-open-palette-nav'),

  keymapModal: $('#keymap-modal'),
  btnCloseKeymap: $('#btn-close-keymap'),
  floatingHotkeys: $('#floating-hotkeys'),

  loadingOverlay: $('#loading-overlay'),
  loadingText: $('#loading-text'),
  toastContainer: $('#toast-container'),
  apiStatus: $('#api-status'),
  apiStatusDot: $('#api-status-dot'),
  mockBadge: $('#mock-badge')
};

// Command Palette Actions
const allCommands = [
  { id: 'demo', icon: 'flask-conical', text: 'Load Demo Research Paper & Auto-Verify', shortcut: 'Demo', action: () => loadDemoPaper(true) },
  { id: 'verify', icon: 'zap', text: 'Run Deep Citation Verification', shortcut: 'Verify', action: () => verifyCitations() },
  { id: 'diff', icon: 'diff', text: 'Toggle Text Diff Comparison View', shortcut: 'D', action: () => setViewMode(state.viewMode === 'diff' ? 'standard' : 'diff') },
  { id: 'filter_mis', icon: 'x-circle', text: 'Filter: Show Mismatched Claims Only', shortcut: 'Filter', action: () => applyFilter('Mismatched') },
  { id: 'filter_sup', icon: 'check-circle-2', text: 'Filter: Show Supported Claims Only', shortcut: 'Filter', action: () => applyFilter('Supported') },
  { id: 'filter_all', icon: 'layers', text: 'Reset All Claim Filters', shortcut: 'Esc', action: () => applyFilter('all') },
  { id: 'bench', icon: 'award', text: 'Switch to Benchmark Suite & Run Evaluation', shortcut: 'Tab 2', action: () => { switchTab('benchmark'); runBenchmark(); } },
  { id: 'export_md', icon: 'file-text', text: 'Download Markdown Audit Report (.md)', shortcut: 'Export', action: () => exportReport('md') },
  { id: 'export_json', icon: 'braces', text: 'Download JSON Audit Report (.json)', shortcut: 'Export', action: () => exportReport('json') },
  { id: 'clear', icon: 'trash-2', text: 'Clear Current Document & Reset Workspace', shortcut: 'Clear', action: () => clearDocument() }
];

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION & EVENT BINDINGS
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initLucide();
  loadHistoryFromStorage();
  bindEvents();
  checkHealth();
  // Auto-load demo preview on first visit so the screen looks rich and bold immediately
  loadDemoPaper(true);
});

function initLucide() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

function bindEvents() {
  dom.tabBtns().forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  dom.btnLoadDemo.addEventListener('click', () => loadDemoPaper(true));
  dom.btnVerify.addEventListener('click', verifyCitations);
  dom.fileInput.addEventListener('change', handleFileUpload);
  dom.btnClearDoc.addEventListener('click', clearDocument);
  dom.btnFetchUrl.addEventListener('click', fetchFromUrl);

  dom.filterPills().forEach(pill => {
    pill.addEventListener('click', () => applyFilter(pill.dataset.filter));
  });

  dom.searchClaims.addEventListener('input', renderClaimsList);
  dom.toggleStandard.addEventListener('click', () => setViewMode('standard'));
  dom.toggleDiff.addEventListener('click', () => setViewMode('diff'));

  dom.btnRunBenchmark.addEventListener('click', runBenchmark);
  dom.btnExportJson.addEventListener('click', () => exportReport('json'));
  dom.btnExportMd.addEventListener('click', () => exportReport('md'));
  dom.btnCopyExport.addEventListener('click', copyExportToClipboard);

  // History Drawer
  dom.btnToggleHistory.addEventListener('click', () => dom.historyDrawer.classList.toggle('open'));
  dom.btnCloseHistory.addEventListener('click', () => dom.historyDrawer.classList.remove('open'));

  // Modals
  dom.btnOpenPaletteNav?.addEventListener('click', openCommandPalette);
  dom.floatingHotkeys.addEventListener('click', openKeymapModal);
  dom.btnCloseKeymap.addEventListener('click', closeModals);
  $('#keymap-backdrop').addEventListener('click', closeModals);
  $('#cmd-palette-backdrop').addEventListener('click', closeModals);
  dom.cmdPaletteInput.addEventListener('input', renderCommandPalette);

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION, LOADING & HELPERS (COMPLETE)
// ═══════════════════════════════════════════════════════════════

function switchTab(tabId) {
  state.activeTab = tabId;
  dom.tabBtns().forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  dom.tabContents().forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabId}`);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  initLucide();
}

function showLoading(text = 'Processing…') {
  state.isLoading = true;
  if (dom.loadingText) dom.loadingText.textContent = text;
  dom.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  state.isLoading = false;
  dom.loadingOverlay.classList.add('hidden');
}

function showToast(message, type = 'info', duration = 3500) {
  const styles = {
    success: 'border-emerald-500/60 bg-emerald-950/90 text-emerald-200',
    error:   'border-rose-500/60 bg-rose-950/90 text-rose-200',
    info:    'border-indigo-500/60 bg-indigo-950/90 text-indigo-200',
    warn:    'border-amber-500/60 bg-amber-950/90 text-amber-200'
  };
  const icons = {
    success: 'check-circle-2',
    error:   'alert-circle',
    info:    'sparkles',
    warn:    'alert-triangle'
  };

  const toast = document.createElement('div');
  toast.className = `flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-xl shadow-2xl animate-slide-up ${styles[type] || styles.info}`;
  toast.innerHTML = `
    <i data-lucide="${icons[type] || icons.info}" class="w-4 h-4 shrink-0"></i>
    <span class="text-xs sm:text-sm font-bold">${escapeHtml(message)}</span>
  `;
  dom.toastContainer.appendChild(toast);
  initLucide();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ═══════════════════════════════════════════════════════════════
// API FETCH & AUTOMATIC MOCK FALLBACK
// ═══════════════════════════════════════════════════════════════

async function apiFetch(url, options = {}) {
  if (state.isMockMode) return getMockData(url, options);

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${response.status}`); } return await response.json(); } catch (err) { enableMockMode(); return getMockData(url, options); } }  function enableMockMode() { if (state.isMockMode) return; state.isMockMode = true; dom.mockBadge.classList.remove('hidden'); dom.mockBadge.classList.add('flex'); dom.apiStatus.textContent = 'Interactive Demo'; dom.apiStatusDot.classList.replace('bg-emerald-500', 'bg-indigo-400'); }  async function checkHealth() { try { await fetch('/api/health', { method: 'GET', signal: AbortSignal.timeout(1500) }); dom.apiStatus.textContent = 'FastAPI Online'; } catch { enableMockMode(); } }  // ═══════════════════════════════════════════════════════════════ // DOCUMENT INGESTION & VERIFICATION // ═══════════════════════════════════════════════════════════════  async function loadDemoPaper(autoVerify = false) { showLoading('Loading sample manuscript…'); try { const data = await apiFetch('/api/sample'); setDocumentLoaded( data.document_text, data.title \vert{}\vert{} 'Scaling Laws & Transformer Architectures (Demo Paper.pdf)', data.source_texts \vert{}\vert{} {} ); hideLoading(); if (autoVerify) { await verifyCitations(); } else { showToast('Demo paper loaded! Click Verify to analyze.', 'success'); } } catch (err) { hideLoading(); showToast(err.message, 'error'); } }  async function handleFileUpload(e) { const file = e.target.files[0]; if (!file) return;  dom.fileLabel.textContent = truncateText(file.name, 22);  if (file.name.toLowerCase().endsWith('.pdf') && !state.isMockMode) { showLoading('Extracting text from PDF…'); try { const formData = new FormData(); formData.append('file', file); const data = await apiFetch('/api/extract-pdf', { method: 'POST', body: formData }); setDocumentLoaded(data.document_text, file.name); hideLoading(); showToast('PDF extracted! Running verification…', 'success'); verifyCitations(); } catch (err) { hideLoading(); showToast(err.message, 'error'); } } else { const reader = new FileReader(); reader.onload = (ev) => { setDocumentLoaded(ev.target.result \vert{}\vert{} 'Extracted manuscript content.', file.name); showToast(`Loaded ${file.name}`, 'success');
      verifyCitations();
    };
    if (file.name.toLowerCase().endsWith('.pdf')) {
      reader.onload({ target: { result: 'Mock PDF extracted text with citations [1], [2], [3].' } });
    } else {
      reader.readAsText(file);
    }
  }
}

async function fetchFromUrl() {
  const url = dom.urlInput.value.trim();
  if (!url) return showToast('Paste a valid arXiv URL or DOI first', 'warn');

  showLoading(`Fetching manuscript from ${truncateText(url, 35)}…`);
  try {
    const data = await apiFetch('/api/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    setDocumentLoaded(data.document_text, data.title || `DOI/arXiv: ${url}`); hideLoading(); showToast('Source fetched! Verifying claims…', 'success'); await verifyCitations(); } catch (err) { hideLoading(); showToast(err.message, 'error'); } }  function setDocumentLoaded(text, title, sourceTexts = {}) { state.documentText = text; state.documentTitle = title; state.sourceTexts = sourceTexts; dom.docIndicator.classList.remove('hidden'); dom.docTitle.textContent = title; dom.btnVerify.disabled = false; dom.urlInput.value = ''; }  function clearDocument() { state.documentText = ''; state.documentTitle = ''; state.sourceTexts = {}; state.verifyResults = null; state.selectedClaimId = null;  dom.docIndicator.classList.add('hidden'); dom.btnVerify.disabled = true; dom.fileLabel.textContent = 'Upload PDF / TXT'; dom.fileInput.value = ''; dom.urlInput.value = ''; dom.searchClaims.value = '';  resetKPIs(); updateFilterCounts({ supported: 0, weakly_supported: 0, mismatched: 0, unverifiable: 0 }, 0); dom.claimsList.querySelectorAll('.claim-card').forEach(c => c.remove()); dom.claimsEmpty.classList.remove('hidden'); dom.claimsCountBadge.textContent = '0 claims'; dom.heatmapTrack.innerHTML = ''; resetEvidencePanel(); updateExportTab();  showToast('Workspace cleared', 'info'); }  async function verifyCitations() { if (!state.documentText) { return showToast('Load a demo paper or upload a file first', 'warn'); }  showLoading('Cross-examining claims against cited sources…'); try { const data = await apiFetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document_text: state.documentText, source_texts: state.sourceTexts, fetch_external: true }) });  state.verifyResults = data; state.activeFilter = 'all'; updateFilterPills(); updateKPIs(data.summary); updateFilterCounts(data.summary, data.results.length); renderClaimsList(); updateExportTab(); saveToHistory(data);  // Auto-select the first claim so the right-hand inspector is immediately populated & bold! if (data.results.length > 0) { selectClaim(data.results[0].claim_id); } else { resetEvidencePanel(); }  hideLoading(); showToast(`Verified ${data.results.length} claims across manuscript`, 'success');
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// KPI & HEALTH SCORE GAUGE
// ═══════════════════════════════════════════════════════════════

function updateKPIs(s) {
  const total = s.total_claims || 1;
  const pct = (v) => Math.round(((v || 0) / total) * 100);

  animateCount(dom.countSupported, s.supported || 0);
  animateCount(dom.countWeak, s.weakly_supported || 0);
  animateCount(dom.countMismatched, s.mismatched || 0);
  animateCount(dom.countUnverifiable, s.unverifiable || 0);

  dom.barSupported.style.width = `${pct(s.supported)}\%`; dom.barWeak.style.width = `${pct(s.weakly_supported)}%`;
  dom.barMismatched.style.width = `${pct(s.mismatched)}\%`; dom.barUnverifiable.style.width = `${pct(s.unverifiable)}%`;

  // Health Score Formula
  const rawScore = ((s.supported * 1.0) + (s.weakly_supported * 0.55) + (s.unverifiable * 0.25)) / total;
  const score = Math.round(rawScore * 100);
  animateCount(dom.healthVal, score);

  const circumference = 264; // 2 * PI * 42
  dom.healthRing.style.strokeDashoffset = circumference - (score / 100) * circumference;

  let grade = 'A — High Integrity', color = '#34d399', desc = 'Strong empirical alignment with cited literature.';
  if (score < 85 && score >= 70) {
    grade = 'B — Minor Issues'; color = '#818cf8'; desc = 'Most citations hold; review flagged weak/mismatch claims.';
  } else if (score < 70 && score >= 50) {
    grade = 'C — Revision Needed'; color = '#fbbf24'; desc = 'Multiple quantitative or contextual discrepancies found.';
  } else if (score < 50) {
    grade = 'D — High Risk'; color = '#f43f5e'; desc = 'Significant citation contradictions require immediate rewrite.';
  }

  dom.healthRing.style.stroke = color;
  dom.healthGrade.textContent = `Grade: ${grade}`; dom.healthGrade.style.color = color; dom.healthDesc.textContent = desc; }  function resetKPIs() { ['count-supported', 'count-weak', 'count-mismatched', 'count-unverifiable'].forEach(id => $(`#${id}`).textContent = '—');
  ['bar-supported', 'bar-weak', 'bar-mismatched', 'bar-unverifiable'].forEach(id => $(`#${id}`).style.width = '0\%'); dom.healthVal.textContent = '—'; dom.healthRing.style.strokeDashoffset = 264; dom.healthGrade.textContent = 'Grade: N/A'; dom.healthGrade.style.color = '#cbd5e1'; dom.healthDesc.textContent = 'Load & verify a paper to compute risk'; }  function animateCount(el, target) { if (!el) return; const duration = 550; const start = performance.now(); function step(now) { const p = Math.min((now - start) / duration, 1); const eased = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(target * eased); if (p < 1) requestAnimationFrame(step); } requestAnimationFrame(step); }  // ═══════════════════════════════════════════════════════════════ // CLAIMS FEED, FILTERS & HEATMAP // ═══════════════════════════════════════════════════════════════  function applyFilter(filterName) { state.activeFilter = filterName; updateFilterPills(); renderClaimsList(); }  function updateFilterCounts(s, total) { $('#filter-count-all').textContent = `(${total})`;
  $('#filter-count-supported').textContent = `(${s.supported \vert{}\vert{} 0})`; $('#filter-count-weak').textContent = `(${s.weakly_supported || 0})`;
  $('#filter-count-mismatched').textContent = `(${s.mismatched \vert{}\vert{} 0})`; $('#filter-count-unverifiable').textContent = `(${s.unverifiable || 0})`;
}

function updateFilterPills() {
  dom.filterPills().forEach(pill => {
    pill.classList.toggle('active', pill.dataset.filter === state.activeFilter);
  });
}

function getVerdictConfig(verdict = '') {
  const key = verdict.toLowerCase().replace(/\s+/g, '_');
  const map = {
    supported: {
      color: 'emerald', emoji: '🟢',
      badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      borderLeft: 'border-l-emerald-400', bar: 'bg-emerald-400', tick: 'bg-emerald-400'
    },
    weakly_supported: {
      color: 'amber', emoji: '🟡',
      badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      borderLeft: 'border-l-amber-400', bar: 'bg-amber-400', tick: 'bg-amber-400'
    },
    mismatched: {
      color: 'rose', emoji: '🔴',
      badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
      borderLeft: 'border-l-rose-500', bar: 'bg-rose-500', tick: 'bg-rose-500'
    },
    unverifiable: {
      color: 'indigo', emoji: '⚪',
      badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
      borderLeft: 'border-l-indigo-400', bar: 'bg-indigo-400', tick: 'bg-indigo-400'
    }
  };
  return map[key] || map.unverifiable;
}

function renderClaimsList() {
  if (!state.verifyResults) return;

  const query = dom.searchClaims.value.toLowerCase().trim();
  const allResults = state.verifyResults.results;

  const filtered = allResults.filter(c => {
    const matchFilter = state.activeFilter === 'all' || c.verdict === state.activeFilter;
    const matchSearch = !query ||
      c.claim_text.toLowerCase().includes(query) ||
      (c.cited_reference || '').toLowerCase().includes(query) ||
      (c.citation_marker || '').toLowerCase().includes(query);
    return matchFilter && matchSearch;
  });

  dom.claimsList.querySelectorAll('.claim-card').forEach(c => c.remove());
  dom.heatmapTrack.innerHTML = '';

  if (filtered.length === 0) {
    dom.claimsEmpty.classList.remove('hidden');
    dom.claimsCountBadge.textContent = '0 claims';
    return;
  }

  dom.claimsEmpty.classList.add('hidden');
  dom.claimsCountBadge.textContent = `${filtered.length} claim${filtered.length !== 1 ? 's' : ''}`;

  filtered.forEach((claim, idx) => {
    const vc = getVerdictConfig(claim.verdict);
    const confPct = Math.round((claim.confidence || 0) * 100);
    const isSelected = state.selectedClaimId === claim.claim_id;

    const card = document.createElement('div');
    card.className = `claim-card rounded-2xl p-4 border border-slate-800 border-l-4 ${vc.borderLeft} bg-slate-900/70 ${isSelected ? 'selected' : ''}`; card.dataset.claimId = claim.claim_id; card.style.animationDelay = `${idx * 35}ms`;
    card.classList.add('animate-slide-right');

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2 mb-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono font-bold text-slate-400">#${claim.claim_id}</span>
          <span class="px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold uppercase tracking-wider border ${vc.badge}">
            ${vc.emoji}${escapeHtml(claim.verdict)}
          </span>
        </div>
        <div class="flex flex-col items-end w-20">
          <span class="text-[11px] font-mono font-bold text-slate-200">${confPct}% Conf</span>
          <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
            <div class="h-full ${vc.bar} rounded-full" style="width: ${confPct}%"></div>
          </div>
        </div>
      </div>

      <p class="text-xs sm:text-sm text-slate-200 font-medium leading-relaxed line-clamp-2">${escapeHtml(claim.claim_text)}</p>

      <div class="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-800/80 text-[11px]">
        <span class="font-mono text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-800/50">
          ${escapeHtml(claim.citation_marker)} ${escapeHtml(truncateText(claim.cited_reference, 28))} </span>${claim.suggested_rewrite ? '<span class="text-amber-300 font-bold flex items-center gap-1"><i data-lucide="sparkles" class="w-3 h-3"></i> Auto-Fix Ready</span>' : ''}
      </div>
    `;

    card.addEventListener('click', () => selectClaim(claim.claim_id));
    dom.claimsList.appendChild(card);

    // Heatmap Tick
    const origIdx = allResults.findIndex(r => r.claim_id === claim.claim_id);
    const topPct = 4 + (origIdx / Math.max(allResults.length - 1, 1)) * 90;
    const tick = document.createElement('div');
    tick.className = `heatmap-tick ${vc.tick}`; tick.style.top = `${topPct}%`;
    tick.title = `Claim #${claim.claim_id}:${claim.verdict}`;
    tick.addEventListener('click', () => {
      selectClaim(claim.claim_id);
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    dom.heatmapTrack.appendChild(tick);
  });

  initLucide();
}

// ═══════════════════════════════════════════════════════════════
// DEEP EVIDENCE INSPECTOR (DIFF VIEW + AI AUTO-REWRITE)
// ═══════════════════════════════════════════════════════════════

function setViewMode(mode) {
  state.viewMode = mode;
  dom.toggleStandard.className = mode === 'standard'
    ? 'px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white transition-all'
    : 'px-3 py-1.5 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition-all';
  dom.toggleDiff.className = mode === 'diff'
    ? 'px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white transition-all flex items-center gap-1.5'
    : 'px-3 py-1.5 text-xs font-bold rounded-lg text-slate-400 hover:text-white transition-all flex items-center gap-1.5';

  if (state.selectedClaimId) selectClaim(state.selectedClaimId);
}

function selectClaim(claimId) {
  state.selectedClaimId = claimId;
  dom.claimsList.querySelectorAll('.claim-card').forEach(card => {
    card.classList.toggle('selected', parseInt(card.dataset.claimId) === claimId);
  });

  const claim = state.verifyResults?.results.find(r => r.claim_id === claimId);
  if (claim) renderEvidence(claim);
}

function generateDiffHtml(claimTxt, sourceTxt) {
  if (!sourceTxt) {
    return {
      c: escapeHtml(claimTxt),
      s: '<span class="text-slate-500 italic">No external source text could be retrieved for diffing.</span>'
    };
  }

  const sTokens = new Set(sourceTxt.toLowerCase().replace(/[^a-z0-9%.\s]/g, '').split(/\s+/));
  const cTokens = new Set(claimTxt.toLowerCase().replace(/[^a-z0-9%.\s]/g, '').split(/\s+/));

  const cHtml = claimTxt.split(/(\s+)/).map(w => {
    const clean = w.toLowerCase().replace(/[^a-z0-9%.]/g, '');
    if (clean.length > 2 && (/^\d+/.test(clean) || clean.length > 5) && !sTokens.has(clean)) {
      return `<span class="diff-removed">${escapeHtml(w)}</span>`;
    }
    return escapeHtml(w);
  }).join('');

  const sHtml = sourceTxt.split(/(\s+)/).map(w => {
    const clean = w.toLowerCase().replace(/[^a-z0-9%.]/g, '');
    if (clean.length > 2 && (/^\d+/.test(clean) || clean.length > 5) && !cTokens.has(clean)) {
      return `<span class="diff-added">${escapeHtml(w)}</span>`;
    }
    return escapeHtml(w);
  }).join('');

  return { c: cHtml, s: sHtml };
}

function renderEvidence(claim) {
  dom.evidenceEmpty.classList.add('hidden');
  dom.evidenceContent.querySelector('.evidence-detail')?.remove();

  const vc = getVerdictConfig(claim.verdict);
  const confPct = Math.round((claim.confidence || 0) * 100);

  let comparisonHtml = '';
  if (state.viewMode === 'diff') {
    const diff = generateDiffHtml(claim.claim_text, claim.evidence_snippet);
    comparisonHtml = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-5 rounded-2xl bg-slate-900/90 border border-rose-500/30 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold uppercase tracking-wider text-rose-300">Manuscript Claim (Author)</span>
            <span class="text-[10px] font-mono text-rose-400">Red = Unverified Token</span>
          </div>
          <p class="text-sm text-slate-100 leading-relaxed">${diff.c}</p>
        </div>
        <div class="p-5 rounded-2xl bg-slate-900/90 border border-emerald-500/30 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-extrabold uppercase tracking-wider text-emerald-300">Ground-Truth Source Passage</span>
            <span class="text-[10px] font-mono text-emerald-400">Green = Source Fact</span>
          </div>
          <p class="text-sm text-slate-100 leading-relaxed">${diff.s}</p>
        </div>
      </div>
    `;
  } else {
    comparisonHtml = `
      <div class="space-y-4">
        <div class="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 border-l-4 border-l-indigo-400">
          <span class="text-xs font-extrabold uppercase tracking-wider text-indigo-300 block mb-2">Manuscript Claim Sentence</span>
          <p class="text-sm sm:text-base font-semibold text-white leading-relaxed">${escapeHtml(claim.claim_text)}</p>
        </div>

        <div class="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 border-l-4 border-l-amber-400">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-extrabold uppercase tracking-wider text-amber-300">Retrieved Source Passage Quote</span>
            <span class="text-xs font-mono text-slate-400">${escapeHtml(claim.source_type || 'Crossref / PDF')}</span>
          </div>
          ${claim.evidence_snippet
            ? `<blockquote class="text-sm text-slate-200 italic leading-relaxed">"${escapeHtml(claim.evidence_snippet)}"</blockquote>`
            : `<p class="text-sm text-slate-500 italic">Source text unavailable behind paywall or missing DOI.</p>`
          }
        </div>
      </div>
    `;
  }

  // AI Auto-Rewrite Box for Mismatched or Weakly Supported claims
  let rewriteHtml = '';
  const needsRewrite = (claim.verdict === 'Mismatched' || claim.verdict === 'Weakly Supported') && claim.suggested_rewrite;
  if (needsRewrite) {
    const isMis = claim.verdict === 'Mismatched';
    const borderCls = isMis ? 'border-rose-500/50 bg-rose-950/30' : 'border-amber-500/50 bg-amber-950/30';
    const titleClr = isMis ? 'text-rose-300' : 'text-amber-300';

    rewriteHtml = `
      <div class="p-5 rounded-2xl border ${borderCls} space-y-3 animate-slide-up">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <i data-lucide="wand-2" class="w-4 h-4 ${titleClr}"></i>
            <h4 class="text-xs font-extrabold uppercase tracking-wider ${titleClr}">AI Correction &amp; Auto-Rewrite Suggestion</h4>
          </div>
          <button id="btn-copy-rewrite" class="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all" data-rewrite="${escapeHtml(claim.suggested_rewrite)}">
            <i data-lucide="copy" class="w-3.5 h-3.5"></i>
            <span>Copy Rewrite</span>
          </button>
        </div>
        <p class="text-sm text-white font-medium leading-relaxed bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
          "${escapeHtml(claim.suggested_rewrite)}"
        </p>
      </div>
    `;
  }

  const detail = document.createElement('div');
  detail.className = 'evidence-detail space-y-5 animate-fade-in';
  detail.innerHTML = `
    <!-- Top Verdict Banner -->
    <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="space-y-1">
        <div class="flex items-center gap-2.5">
          <span class="text-xs font-mono font-bold text-slate-400">CLAIM #${claim.claim_id}</span>
          <span class="px-3 py-1 rounded-xl text-xs font-extrabold uppercase tracking-wider border ${vc.badge}">
            ${vc.emoji}${escapeHtml(claim.verdict)}
          </span>
        </div>
        <p class="text-xs text-slate-300 pt-1">
          <strong>Cited Reference:</strong> <span class="font-mono text-indigo-300">${escapeHtml(claim.citation_marker)}</span> —${escapeHtml(claim.cited_reference)}
        </p>
      </div>

      <div class="sm:text-right shrink-0">
        <span class="text-2xl font-extrabold text-white font-mono">${confPct}%</span>
        <span class="block text-[10px] uppercase tracking-widest text-slate-400 font-bold">AI Confidence</span>

/**
 * CiteGuard AI — Frontend Application
 * Handles API calls, state management, search filters, and UI updates.
 */

const state = {
  documentText: '',
  sourceTexts: {},
  documentTitle: '',
  verifyResults: null,
  benchmarkData: null,
  selectedClaimId: null,
  activeFilter: 'all',
  isMockMode: false
};

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
  searchClaims: $('#search-claims'),
  filterSection: $('#filter-section'),
  filterPills: () => $$('.filter-pill'),
  claimsList: $('#claims-list'),
  claimsEmpty: $('#claims-empty'),
  claimsCountBadge: $('#claims-count-badge'),
  evidenceContent: $('#evidence-content'),
  evidenceEmpty: $('#evidence-empty'),
  btnRunBenchmark: $('#btn-run-benchmark'),
  benchmarkResults: $('#benchmark-results'),
  benchmarkEmpty: $('#benchmark-empty'),
  exportEmpty: $('#export-empty'),
  exportOptions: $('#export-options'),
  btnExportJson: $('#btn-export-json'),
  btnExportMd: $('#btn-export-md'),
  loadingOverlay: $('#loading-overlay'),
  loadingText: $('#loading-text'),
  toastContainer: $('#toast-container'),
  apiStatus: $('#api-status'),
  apiStatusDot: $('#api-status-dot'),
  mockBadge: $('#mock-badge')
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
  bindEvents();
  checkHealth();
});

function bindEvents() {
  dom.tabBtns().forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  dom.btnLoadDemo.addEventListener('click', loadDemoPaper);
  dom.btnVerify.addEventListener('click', verifyCitations);
  dom.fileInput.addEventListener('change', handleFileUpload);
  dom.btnClearDoc.addEventListener('click', clearDocument);
  dom.btnFetchUrl.addEventListener('click', fetchFromUrl);

  dom.filterPills().forEach(pill => {
    pill.addEventListener('click', () => {
      state.activeFilter = pill.dataset.filter;
      updateFilterPills();
      renderClaimsList();
    });
  });

  dom.searchClaims.addEventListener('input', renderClaimsList);

  dom.btnRunBenchmark.addEventListener('click', runBenchmark);
  dom.btnExportJson.addEventListener('click', () => exportReport('json'));
  dom.btnExportMd.addEventListener('click', () => exportReport('md'));

  // Keyboard Navigation for Claims
  dom.claimsList.addEventListener('keydown', (e) => {
    if (!state.verifyResults) return;
    const items = Array.from(dom.claimsList.querySelectorAll('.claim-card'));
    if (!items.length) return;
    
    const currentIndex = items.findIndex(el => parseInt(el.dataset.claimId) === state.selectedClaimId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[currentIndex + 1] || items[0];
      selectClaim(parseInt(next.dataset.claimId));
      next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[currentIndex - 1] || items[items.length - 1];
      selectClaim(parseInt(prev.dataset.claimId));
      prev.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

function switchTab(tabId) {
  dom.tabBtns().forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  dom.tabContents().forEach(content => content.classList.toggle('active', content.id.replace('tab-', '') === tabId));
  if (window.lucide) lucide.createIcons();
}

/* ==========================================================================
   API & Mock Data Handling
   ========================================================================== */

async function apiFetch(url, options = {}) {
  if (state.isMockMode) return getMockData(url, options);
  
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      console.warn('Backend unreachable. Switching to Mock Mode.');
      enableMockMode();
      return getMockData(url, options);
    }
    throw err;
  }
}

function enableMockMode() {
  if (state.isMockMode) return;
  state.isMockMode = true;
  dom.mockBadge.classList.remove('hidden');
  dom.apiStatus.textContent = 'Disconnected (Mock Data)';
  dom.apiStatusDot.classList.replace('bg-emerald-500', 'bg-amber-500');
  showToast('Backend offline. Switched to Mock Mode.', 'warn');
}

async function checkHealth() {
  try {
    await fetch('/api/health', { method: 'GET', signal: AbortSignal.timeout(2000) });
    dom.apiStatus.textContent = 'Connected & Ready';
  } catch {
    enableMockMode();
  }
}

function showLoading(text) {
  dom.loadingText.textContent = text;
  dom.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  dom.loadingOverlay.classList.add('hidden');
}

function showToast(message, type = 'info') {
  const colors = {
    success: 'border-emerald-500 bg-emerald-950/80 text-emerald-300',
    error:   'border-rose-500 bg-rose-950/80 text-rose-300',
    info:    'border-indigo-500 bg-indigo-950/80 text-indigo-300',
    warn:    'border-amber-500 bg-amber-950/80 text-amber-300',
  };
  const icons = { success: 'check-circle-2', error: 'alert-circle', info: 'info', warn: 'alert-triangle' };
  const toast = document.createElement('div');
  toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-xl animate-slide-up ${colors[type] || colors.info}`;
  toast.innerHTML = `<i data-lucide="${icons[type] || icons.info}" class="w-4 h-4 flex-shrink-0"></i><span class="text-sm font-medium">${escapeHtml(message)}</span>`;
  dom.toastContainer.appendChild(toast);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ==========================================================================
   Document Loading & Verification
   ========================================================================== */

async function loadDemoPaper() {
  showLoading('Loading demo research paper…');
  try {
    const data = await apiFetch('/api/sample');
    setDocumentLoaded(data.document_text, data.title || 'Attention Is All You Need.pdf');
    hideLoading();
    showToast('Demo paper loaded successfully', 'success');
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  dom.fileLabel.textContent = file.name.length > 20 ? file.name.substring(0,20)+'...' : file.name;
  
  if (file.name.toLowerCase().endsWith('.pdf') && !state.isMockMode) {
    showLoading('Extracting text from PDF…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch('/api/extract-pdf', { method: 'POST', body: formData });
      setDocumentLoaded(data.document_text, file.name);
      hideLoading();
      showToast('PDF extracted successfully', 'success');
    } catch (err) {
      hideLoading();
      showToast(err.message, 'error');
    }
  } else {
    const reader = new FileReader();
    reader.onload = (ev) => {
      setDocumentLoaded(ev.target.result, file.name);
      showToast('Document loaded successfully', 'success');
    };
    if (file.name.endsWith('.pdf')) {
      reader.onload({ target: { result: "Mock Extracted PDF Content." }});
    } else {
      reader.readAsText(file);
    }
  }
}

async function fetchFromUrl() {
  const url = dom.urlInput.value.trim();
  if (!url) return showToast('Please enter a valid DOI or arXiv URL', 'warn');
  
  showLoading('Fetching and extracting document from URL...');
  try {
    const data = await apiFetch('/api/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    setDocumentLoaded(data.document_text, data.title || url);
    hideLoading();
    showToast('Document fetched successfully', 'success');
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

function setDocumentLoaded(text, title) {
  state.documentText = text;
  state.documentTitle = title;
  dom.docIndicator.classList.remove('hidden');
  dom.docTitle.textContent = title;
  dom.btnVerify.disabled = false;
  dom.urlInput.value = '';
}

function clearDocument() {
  state.documentText = '';
  state.documentTitle = '';
  state.verifyResults = null;
  state.selectedClaimId = null;
  dom.docIndicator.classList.add('hidden');
  dom.btnVerify.disabled = true;
  dom.fileLabel.textContent = 'Upload PDF/Txt';
  dom.fileInput.value = '';
  dom.urlInput.value = '';
  dom.searchClaims.value = '';
  
  dom.claimsList.querySelectorAll('.claim-card').forEach(c => c.remove());
  dom.claimsEmpty.classList.remove('hidden');
  dom.claimsCountBadge.textContent = '';
  dom.evidenceContent.querySelector('.evidence-detail')?.remove();
  dom.evidenceEmpty.classList.remove('hidden');
  
  updateFilterCounts({supported:0, weakly_supported:0, mismatched:0, unverifiable:0}, 0);
  updateExportTab();
  showToast('Document cleared', 'info');
}

async function verifyCitations() {
  if (!state.documentText) return showToast('Please load a document first', 'warn');
  showLoading('Verifying citations against source material...');
  try {
    const data = await apiFetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_text: state.documentText, fetch_external: true })
    });
    state.verifyResults = data;
    state.selectedClaimId = null;
    state.activeFilter = 'all';
    updateFilterCounts(data.summary, data.results.length);
    renderClaimsList();
    resetEvidencePanel();
    updateExportTab();
    hideLoading();
    showToast(`Verification complete: ${data.results.length} claims analyzed`, 'success');
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

/* ==========================================================================
   UI Rendering: Filters & List
   ========================================================================== */

function updateFilterCounts(s, total) {
  $('#filter-count-all').textContent = `(${total})`;
  $('#filter-count-supported').textContent = `(${s.supported || 0})`;
  $('#filter-count-weak').textContent = `(${s.weakly_supported || 0})`;
  $('#filter-count-mismatched').textContent = `(${s.mismatched || 0})`;
  $('#filter-count-unverifiable').textContent = `(${s.unverifiable || 0})`;
}

function updateFilterPills() {
  dom.filterPills().forEach(pill => {
    pill.classList.toggle('active', pill.dataset.filter === state.activeFilter);
  });
}

function getVerdictConfig(verdict) {
  const v = verdict.toLowerCase().replace(/\s+/g, '_');
  const configs = {
    supported: { color: 'emerald', emoji: '🟢', bg: 'bg-emerald-950/40', border: 'border-emerald-700/40', borderLeft: 'border-l-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/40' },
    weakly_supported: { color: 'amber', emoji: '🟡', bg: 'bg-amber-950/30', border: 'border-amber-700/30', borderLeft: 'border-l-amber-500', text: 'text-amber-400', badge: 'bg-amber-900/60 text-amber-300 border-amber-700/40' },
    mismatched: { color: 'rose', emoji: '🔴', bg: 'bg-rose-950/30', border: 'border-rose-700/30', borderLeft: 'border-l-rose-500', text: 'text-rose-400', badge: 'bg-rose-900/60 text-rose-300 border-rose-700/40' },
    unverifiable: { color: 'indigo', emoji: '⚪', bg: 'bg-indigo-950/30', border: 'border-indigo-700/30', borderLeft: 'border-l-indigo-500', text: 'text-indigo-400', badge: 'bg-indigo-900/60 text-indigo-300 border-indigo-700/40' },
  };
  return configs[v] || configs.unverifiable;
}

function renderClaimsList() {
  if (!state.verifyResults) return;
  const searchQuery = dom.searchClaims.value.toLowerCase();
  
  const filtered = state.verifyResults.results.filter(claim => {
    const matchesFilter = state.activeFilter === 'all' || claim.verdict === state.activeFilter;
    const matchesSearch = claim.claim_text.toLowerCase().includes(searchQuery) || claim.cited_reference.toLowerCase().includes(searchQuery);
    return matchesFilter && matchesSearch;
  });

  dom.claimsList.querySelectorAll('.claim-card').forEach(c => c.remove());
  if (filtered.length === 0) {
    dom.claimsCountBadge.textContent = '0 claims';
    dom.claimsEmpty.classList.remove('hidden');
    return;
  }
  dom.claimsEmpty.classList.add('hidden');
  dom.claimsCountBadge.textContent = `${filtered.length} claim${filtered.length !== 1 ? 's' : ''}`;

  filtered.forEach((claim, idx) => {
    const vc = getVerdictConfig(claim.verdict);
    const card = document.createElement('div');
    card.className = `claim-card rounded-xl p-3 border ${vc.border} ${vc.bg} border-l-2 ${vc.borderLeft} ${state.selectedClaimId === claim.claim_id ? 'selected' : ''}`;
    card.style.animationDelay = `${idx * 40}ms`;
    card.classList.add('animate-slide-right');
    card.dataset.claimId = claim.claim_id;
    card.tabIndex = 0; 

    const confPct = Math.round(claim.confidence * 100);
    const confColorStr = confPct >= 80 ? 'bg-emerald-500' : confPct >= 50 ? 'bg-amber-500' : 'bg-rose-500';
    const confTextColor = confPct >= 80 ? 'text-emerald-400' : confPct >= 50 ? 'text-amber-400' : 'text-rose-400';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono text-slate-500">#${claim.claim_id}</span>
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${vc.badge}">
            <span>${vc.emoji}</span> ${claim.verdict}
          </span>
        </div>
        <div class="flex flex-col items-end gap-1 w-16" title="Confidence Score">
          <span class="text-[10px] font-mono ${confTextColor} font-bold">${confPct}%</span>
          <div class="w-full h-1 rounded-full bg-slate-800/80 overflow-hidden shadow-inner">
            <div class="h-full rounded-full ${confColorStr} transition-all" style="width: ${confPct}%"></div>
          </div>
        </div>
      </div>
      <p class="text-sm text-slate-300 leading-relaxed line-clamp-3">${escapeHtml(claim.claim_text)}</p>
      <div class="flex items-center justify-between mt-2">
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/60 text-[10px] text-slate-400 font-mono border border-slate-700/30">
          <i data-lucide="bookmark" class="w-2.5 h-2.5"></i> ${escapeHtml(claim.citation_marker)}
        </span>
      </div>
    `;
    card.addEventListener('click', () => selectClaim(claim.claim_id));
    dom.claimsList.appendChild(card);
  });
  if (window.lucide) lucide.createIcons();
}

/* ==========================================================================
   UI Rendering: Inspector Panel (With Auto-Rewrite)
   ========================================================================== */

function selectClaim(claimId) {
  state.selectedClaimId = claimId;
  dom.claimsList.querySelectorAll('.claim-card').forEach(card => {
    card.classList.toggle('selected', parseInt(card.dataset.claimId) === claimId);
  });
  const claim = state.verifyResults.results.find(r => r.claim_id === claimId);
  if (claim) renderEvidence(claim);
}

function renderEvidence(claim) {
  dom.evidenceEmpty.classList.add('hidden');
  const vc = getVerdictConfig(claim.verdict);
  const confPct = Math.round(claim.confidence * 100);
  const circ = 2 * Math.PI * 36;
  const dashoffset = circ - (claim.confidence * circ);
  const ringColor = confPct >= 80 ? '#4ade80' : confPct >= 50 ? '#fbbf24' : '#f43f5e';

  dom.evidenceContent.querySelector('.evidence-detail')?.remove();
  const detail = document.createElement('div');
  detail.className = 'evidence-detail space-y-5 animate-fade-in pb-8';
  
  // AI Auto-Rewrite Injection
  let rewriteHtml = '';
  if ((claim.verdict === 'Mismatched' || claim.verdict === 'Weakly Supported') && claim.suggested_rewrite) {
    const isMismatch = claim.verdict === 'Mismatched';
    const boxBg = isMismatch ? 'bg-rose-950/40' : 'bg-amber-950/40';
    const boxBorder = isMismatch ? 'border-rose-500/30' : 'border-amber-500/30';
    const accentColor = isMismatch ? 'text-rose-400' : 'text-amber-400';
    
    rewriteHtml = `
      <div class="mt-6 animate-slide-up" style="animation-delay: 150ms;">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-lg ${boxBg} border border-slate-700/50 flex items-center justify-center">
              <i data-lucide="sparkles" class="w-3.5 h-3.5 ${accentColor}"></i>
            </div>
            <h3 class="text-xs font-bold ${accentColor} uppercase tracking-wider">AI Auto-Rewrite Suggestion</h3>
          </div>
          <button class="copy-rewrite-btn flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] uppercase font-bold tracking-wider rounded-lg border border-slate-700 transition-colors shadow-sm" data-text="${escapeHtml(claim.suggested_rewrite)}">
            <i data-lucide="copy" class="w-3 h-3"></i> <span>Copy Fix</span>
          </button>
        </div>
        <div class="pl-4 py-3 pr-3 rounded-xl ${boxBg} border ${boxBorder} shadow-inner">
          <p class="text-sm text-slate-200 leading-relaxed font-medium italic">"${escapeHtml(claim.suggested_rewrite)}"</p>
        </div>
      </div>
    `;
  }

  detail.innerHTML = `
    <!-- Top KPI Row -->
    <div class="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl ${vc.bg} border ${vc.border}">
      <div class="relative w-[76px] h-[76px] shrink-0">
        <svg class="w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" class="text-slate-800" stroke-width="5" />
          <circle cx="40" cy="40" r="36" fill="none" stroke="${ringColor}" stroke-width="5"
                  stroke-dasharray="${circ}" stroke-dashoffset="${dashoffset}" stroke-linecap="round" class="score-ring" />
        </svg>
        <span class="absolute inset-0 flex items-center justify-center text-base font-bold ${vc.text}">${confPct}%</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-2 mb-1">
          <span class="text-xs font-mono text-slate-500">#${claim.claim_id}</span>
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${vc.badge}">
            ${vc.emoji} ${claim.verdict}
          </span>
        </div>
        <p class="text-xs text-slate-400">Citation: <span class="font-mono text-slate-300">${escapeHtml(claim.citation_marker)}</span></p>
        <p class="text-xs text-slate-500 mt-0.5 truncate" title="${escapeHtml(claim.cited_reference)}">Ref: ${escapeHtml(claim.cited_reference)}</p>
      </div>
    </div>

    <!-- Document Claim -->
    <div>
      <div class="flex items-center gap-2 mb-2">
        <div class="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center">
          <i data-lucide="quote" class="w-3.5 h-3.5 text-indigo-400"></i>
        </div>
        <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Document Claim</h3>
      </div>
      <div class="evidence-claim pl-4 py-3 pr-3 rounded-r-xl bg-slate-800/40">
        <p class="text-sm text-slate-200 leading-relaxed">${escapeHtml(claim.claim_text)}</p>
      </div>
    </div>

    <!-- Retrieved Source -->
    <div>
      <div class="flex items-center gap-2 mb-2">
        <div class="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <i data-lucide="file-search" class="w-3.5 h-3.5 text-amber-400"></i>
        </div>
        <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Retrieved Source Passage</h3>
      </div>
      <div class="evidence-source pl-4 py-3 pr-3 rounded-r-xl bg-slate-800/40">
        ${claim.evidence_snippet
          ? `<p class="text-sm text-slate-300 leading-relaxed">${escapeHtml(claim.evidence_snippet)}</p>`
          : `<p class="text-sm text-slate-500 italic">No source passage available</p>`
        }
      </div>
    </div>

    <!-- AI Diagnostic Explanation -->
    <div>
      <div class="flex items-center gap-2 mb-2">
        <div class="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center">
          <i data-lucide="brain" class="w-3.5 h-3.5 text-purple-400"></i>
        </div>
        <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">AI Diagnostic Explanation</h3>
      </div>
      <div class="pl-4 py-3 pr-3 rounded-xl bg-purple-950/20 border border-purple-800/20">
        <p class="text-sm text-slate-300 leading-relaxed">${escapeHtml(claim.explanation)}</p>
      </div>
    </div>

    ${rewriteHtml}
  `;

  dom.evidenceContent.appendChild(detail);
  if (window.lucide) lucide.createIcons();

  // Copy Rewrite Action
  const copyBtn = detail.querySelector('.copy-rewrite-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(copyBtn.dataset.text).then(() => {
        const originalHtml = copyBtn.innerHTML;
        copyBtn.classList.replace('bg-slate-800', 'bg-emerald-950/50');
        copyBtn.classList.replace('border-slate-700', 'border-emerald-500/50');
        copyBtn.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-400"></i> <span class="text-emerald-400">Copied</span>`;
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
          copyBtn.innerHTML = originalHtml;
          copyBtn.classList.replace('bg-emerald-950/50', 'bg-slate-800');
          copyBtn.classList.replace('border-emerald-500/50', 'border-slate-700');
          if (window.lucide) lucide.createIcons();
        }, 2000);
      }).catch(() => showToast('Failed to copy', 'error'));
    });
  }
}

function resetEvidencePanel() {
  dom.evidenceContent.querySelector('.evidence-detail')?.remove();
  dom.evidenceEmpty.classList.remove('hidden');
}

/* ==========================================================================
   Benchmark & Export
   ========================================================================== */
async function runBenchmark() {
  showLoading('Running evaluation suite…');
  try {
    const data = await apiFetch('/api/benchmark');
    dom.benchmarkEmpty.classList.add('hidden');
    dom.benchmarkResults.innerHTML = `
      <div class="glass rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-6">
        <div class="relative w-[120px] h-[120px] shrink-0">
          <svg class="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" class="text-slate-800" stroke-width="6" />
            <circle cx="60" cy="60" r="52" fill="none" stroke="#4ade80" stroke-width="6" stroke-dasharray="326" stroke-dashoffset="${326 - (data.overall_accuracy * 326)}" stroke-linecap="round" class="score-ring" />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-2xl font-bold text-white">${Math.round(data.overall_accuracy * 100)}%</span>
            <span class="text-[10px] text-slate-500 uppercase font-medium">Accuracy</span>
          </div>
        </div>
        <div>
          <h3 class="text-lg font-bold text-slate-200">Overall Accuracy</h3>
          <p class="text-sm text-slate-400 mt-1">${data.correct_predictions} of ${data.total_cases} test cases passed</p>
        </div>
      </div>
    `;
    hideLoading();
    showToast(`Benchmark complete.`, 'success');
  } catch(err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

function updateExportTab() {
  if (state.verifyResults) {
    dom.exportEmpty.classList.add('hidden');
    dom.exportOptions.classList.remove('hidden');
  } else {
    dom.exportEmpty.classList.remove('hidden');
    dom.exportOptions.classList.add('hidden');
  }
}

function exportReport(format) {
  if (!state.verifyResults) return showToast('No data to export', 'warn');
  let content, mimeType, fileName;
  
  if (format === 'json') {
    content = JSON.stringify(state.verifyResults, null, 2);
    mimeType = 'application/json';
    fileName = 'citeguard_audit.json';
  } else {
    const s = state.verifyResults.summary;
    content = `# CiteGuard AI Audit Report\n\nTotal Claims: ${s.total_claims}\nSupported: ${s.supported} | Weak: ${s.weakly_supported} | Mismatched: ${s.mismatched}\n\n`;
    state.verifyResults.results.forEach(r => {
      content += `### Claim #${r.claim_id} — ${r.verdict} (${Math.round(r.confidence*100)}%)\n**Claim:** ${r.claim_text}\n**Source:** ${r.cited_reference}\n**Evidence:** ${r.evidence_snippet}\n**AI Reasoning:** ${r.explanation}\n\n---\n`;
    });
    mimeType = 'text/markdown';
    fileName = 'citeguard_audit.md';
  }
  
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${fileName}`, 'success');
}

/* ==========================================================================
   Utility & Mock
   ========================================================================== */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getMockData(url, options) {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (url === '/api/sample') {
        resolve({ document_text: "Mock text.", title: "Attention Is All You Need (Mock)" });
      } else if (url === '/api/fetch-url') {
        resolve({ document_text: "Fetched text.", title: "Fetched DOI Doc" });
      } else if (url === '/api/verify') {
        resolve({
          summary: { total_claims: 2, supported: 1, weakly_supported: 0, mismatched: 1, unverifiable: 0 },
          results: [
            { claim_id: 1, verdict: "Supported", confidence: 0.94, claim_text: "Transformer models dispense with recurrence.", citation_marker: "[1]", cited_reference: "Vaswani 2017", source_found: true, evidence_snippet: "We propose the Transformer, dispensing with recurrence.", explanation: "Source explicitly confirms the claim." },
            { claim_id: 2, verdict: "Mismatched", confidence: 0.88, claim_text: "LLMs require significantly less data.", citation_marker: "[2]", cited_reference: "Kaplan 2020", source_found: true, evidence_snippet: "Model performance necessitates vast corpora.", explanation: "Contradiction detected.", suggested_rewrite: "LLMs require significantly larger training datasets." }
          ]
        });
      } else if (url === '/api/benchmark') {
        resolve({ overall_accuracy: 0.85, total_cases: 10, correct_predictions: 8 });
      }
    }, 1000);
  });
}


/**
 * CiteGuard AI — Frontend Application
 * Claim-to-Source Citation Verifier
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
  isLoading: false,
  isMockMode: false // Auto-enabled if backend is unreachable
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
  docIndicator: $('#doc-indicator'),
  docTitle: $('#doc-title'),
  btnClearDoc: $('#btn-clear-doc'),

  countSupported: $('#count-supported'),
  countWeak: $('#count-weak'),
  countMismatched: $('#count-mismatched'),
  countUnverifiable: $('#count-unverifiable'),
  barSupported: $('#bar-supported'),
  barWeak: $('#bar-weak'),
  barMismatched: $('#bar-mismatched'),
  barUnverifiable: $('#bar-unverifiable'),

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
  exportPreview: $('#export-preview'),
  exportPreviewContent: $('#export-preview-content'),
  exportStats: $('#export-stats'),
  btnExportJson: $('#btn-export-json'),
  btnExportMd: $('#btn-export-md'),
  btnCopyExport: $('#btn-copy-export'),

  loadingOverlay: $('#loading-overlay'),
  loadingText: $('#loading-text'),
  toastContainer: $('#toast-container'),
  mobileMenuBtn: $('#mobile-menu-btn'),
  mobileNav: $('#mobile-nav'),

  apiStatus: $('#api-status'),
  apiStatusDot: $('#api-status-dot'),
  mockBadge: $('#mock-badge')
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initLucide();
  bindEvents();
  checkHealth();
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

  dom.mobileMenuBtn?.addEventListener('click', () => {
    dom.mobileNav.classList.toggle('hidden');
  });

  dom.btnLoadDemo.addEventListener('click', loadDemoPaper);
  dom.btnVerify.addEventListener('click', verifyCitations);
  dom.fileInput.addEventListener('change', handleFileUpload);
  dom.btnClearDoc.addEventListener('click', clearDocument);

  dom.filterPills().forEach(pill => {
    pill.addEventListener('click', () => {
      state.activeFilter = pill.dataset.filter;
      updateFilterPills();
      renderClaimsList();
    });
  });

  dom.btnRunBenchmark.addEventListener('click', runBenchmark);
  dom.btnExportJson.addEventListener('click', () => exportReport('json'));
  dom.btnExportMd.addEventListener('click', () => exportReport('md'));
  dom.btnCopyExport.addEventListener('click', copyExportToClipboard);

  // Keyboard navigation for claims list
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

// ═══════════════════════════════════════════════════════════════
// TAB MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function switchTab(tabId) {
  state.activeTab = tabId;

  dom.tabBtns().forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle('active', isActive);
  });

  dom.tabContents().forEach(content => {
    const id = content.id.replace('tab-', '');
    content.classList.toggle('active', id === tabId);
  });

  dom.mobileNav?.classList.add('hidden');
  initLucide();
}

// ═══════════════════════════════════════════════════════════════
// API HELPERS & MOCK MODE
// ═══════════════════════════════════════════════════════════════

async function apiFetch(url, options = {}) {
  if (state.isMockMode) return getMockData(url);
  
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
      return getMockData(url);
    }
    throw err;
  }
}

function enableMockMode() {
  if (state.isMockMode) return;
  state.isMockMode = true;
  dom.mockBadge.classList.remove('hidden');
  dom.apiStatus.textContent = 'Disconnected (Using Mock Data)';
  dom.apiStatusDot.classList.replace('bg-emerald-500', 'bg-amber-500');
  showToast('Backend offline. Switched to Mock Mode for demonstration.', 'warn', 5000);
}

async function checkHealth() {
  try {
    await fetch('/api/health', { method: 'GET', signal: AbortSignal.timeout(2000) });
    dom.apiStatus.textContent = 'Connected & Ready';
  } catch {
    enableMockMode();
  }
}

function showLoading(text = 'Processing…') {
  state.isLoading = true;
  dom.loadingText.textContent = text;
  dom.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  state.isLoading = false;
  dom.loadingOverlay.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

function showToast(message, type = 'info', duration = 4000) {
  const colors = {
    success: 'border-emerald-500 bg-emerald-950/80 text-emerald-300',
    error:   'border-red-500 bg-red-950/80 text-red-300',
    info:    'border-indigo-500 bg-indigo-950/80 text-indigo-300',
    warn:    'border-amber-500 bg-amber-950/80 text-amber-300',
  };

  const icons = {
    success: 'check-circle-2',
    error:   'alert-circle',
    info:    'info',
    warn:    'alert-triangle',
  };

  const toast = document.createElement('div');
  toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-xl animate-slide-up ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <i data-lucide="${icons[type] || icons.info}" class="w-4 h-4 flex-shrink-0"></i>
    <span class="text-sm font-medium">${escapeHtml(message)}</span>
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
// DOCUMENT HANDLING
// ═══════════════════════════════════════════════════════════════

async function loadDemoPaper() {
  showLoading('Loading demo research paper…');
  try {
    const data = await apiFetch('/api/sample');
    state.documentText = data.document_text;
    state.sourceTexts = data.source_texts || {};
    state.documentTitle = data.title || 'Attention Is All You Need.pdf';

    dom.docIndicator.classList.remove('hidden');
    dom.docTitle.textContent = state.documentTitle;
    dom.btnVerify.disabled = false;

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

  const fileName = file.name;
  dom.fileLabel.textContent = truncateText(fileName, 25);

  if (fileName.toLowerCase().endsWith('.pdf') && !state.isMockMode) {
    showLoading('Extracting text from PDF…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch('/api/extract-pdf', { method: 'POST', body: formData });
      
      state.documentText = data.document_text;
      state.sourceTexts = {};
      state.documentTitle = fileName;
      
      dom.docIndicator.classList.remove('hidden');
      dom.docTitle.textContent = fileName;
      dom.btnVerify.disabled = false;
      hideLoading();
      showToast('PDF extracted successfully', 'success');
    } catch (err) {
      hideLoading();
      showToast(err.message, 'error');
    }
  } else {
    // For text files or PDF in Mock Mode (fake reading)
    const reader = new FileReader();
    reader.onload = (ev) => {
      state.documentText = ev.target.result;
      state.sourceTexts = {};
      state.documentTitle = fileName;
      dom.docIndicator.classList.remove('hidden');
      dom.docTitle.textContent = fileName;
      dom.btnVerify.disabled = false;
      showToast('Document loaded successfully', 'success');
    };
    if (fileName.endsWith('.pdf')) {
      // Fake data if uploading a PDF in mock mode
      reader.onload({ target: { result: "Mock Extracted PDF Content.\nTransformers changed NLP significantly [1]." }});
    } else {
      reader.readAsText(file);
    }
  }
}

function clearDocument() {
  state.documentText = '';
  state.sourceTexts = {};
  state.documentTitle = '';
  state.verifyResults = null;
  state.selectedClaimId = null;

  dom.docIndicator.classList.add('hidden');
  dom.docTitle.textContent = '';
  dom.btnVerify.disabled = true;
  dom.fileLabel.textContent = 'Upload PDF or Text File';
  dom.fileInput.value = '';

  resetKPI();
  dom.filterSection.classList.add('hidden');
  resetClaimsPanel();
  resetEvidencePanel();
  updateExportTab();

  showToast('Document cleared', 'info');
}

// ═══════════════════════════════════════════════════════════════
// VERIFY CITATIONS
// ═══════════════════════════════════════════════════════════════

async function verifyCitations() {
  if (!state.documentText) return showToast('Please load a document first', 'warn');

  showLoading('Verifying citations… Extracting claims and retrieving sources');

  try {
    const payload = { document_text: state.documentText, fetch_external: true };
    const data = await apiFetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    state.verifyResults = data;
    state.selectedClaimId = null;
    state.activeFilter = 'all';

    updateKPI(data.summary);
    updateFilterCounts(data.summary, data.results.length);
    dom.filterSection.classList.remove('hidden');
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

// ═══════════════════════════════════════════════════════════════
// UI RENDERING: KPIs & FILTERS
// ═══════════════════════════════════════════════════════════════

function updateKPI(summary) {
  const total = summary.total_claims || 1;
  const pct = (v) => Math.round((v / total) * 100);

  animateCount(dom.countSupported, summary.supported);
  animateCount(dom.countWeak, summary.weakly_supported);
  animateCount(dom.countMismatched, summary.mismatched);
  animateCount(dom.countUnverifiable, summary.unverifiable);

  setTimeout(() => {
    dom.barSupported.style.width = pct(summary.supported) + '%';
    dom.barWeak.style.width = pct(summary.weakly_supported) + '%';
    dom.barMismatched.style.width = pct(summary.mismatched) + '%';
    dom.barUnverifiable.style.width = pct(summary.unverifiable) + '%';
  }, 100);
}

function resetKPI() {
  ['count-supported', 'count-weak', 'count-mismatched', 'count-unverifiable'].forEach(id => {
    $(`#${id}`).textContent = '—';
  });
  ['bar-supported', 'bar-weak', 'bar-mismatched', 'bar-unverifiable'].forEach(id => {
    $(`#${id}`).style.width = '0%';
  });
}

function animateCount(el, target) {
  const duration = 600, start = performance.now(), initial = 0;
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(initial + (target - initial) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function updateFilterCounts(summary, total) {
  $('#filter-count-all').textContent = `(${total})`;
  $('#filter-count-supported').textContent = `(${summary.supported})`;
  $('#filter-count-weak').textContent = `(${summary.weakly_supported})`;
  $('#filter-count-mismatched').textContent = `(${summary.mismatched})`;
  $('#filter-count-unverifiable').textContent = `(${summary.unverifiable})`;
}

function updateFilterPills() {
  dom.filterPills().forEach(pill => {
    pill.classList.toggle('active', pill.dataset.filter === state.activeFilter);
  });
}

// ═══════════════════════════════════════════════════════════════
// UI RENDERING: CLAIMS & EVIDENCE
// ═══════════════════════════════════════════════════════════════

function getVerdictConfig(verdict) {
  const v = verdict.toLowerCase().replace(/\s+/g, '_');
  const configs = {
    supported: { color: 'emerald', emoji: '🟢', icon: 'check-circle-2', bg: 'bg-emerald-950/40', border: 'border-emerald-700/40', borderLeft: 'border-l-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/40' },
    weakly_supported: { color: 'amber', emoji: '🟡', icon: 'alert-triangle', bg: 'bg-amber-950/30', border: 'border-amber-700/30', borderLeft: 'border-l-amber-500', text: 'text-amber-400', badge: 'bg-amber-900/60 text-amber-300 border-amber-700/40' },
    mismatched: { color: 'red', emoji: '🔴', icon: 'x-circle', bg: 'bg-red-950/30', border: 'border-red-700/30', borderLeft: 'border-l-red-500', text: 'text-red-400', badge: 'bg-red-900/60 text-red-300 border-red-700/40' },
    unverifiable: { color: 'indigo', emoji: '⚪', icon: 'help-circle', bg: 'bg-indigo-950/30', border: 'border-indigo-700/30', borderLeft: 'border-l-indigo-500', text: 'text-indigo-400', badge: 'bg-indigo-900/60 text-indigo-300 border-indigo-700/40' },
  };
  return configs[v] || configs.unverifiable;
}

function renderClaimsList() {
  if (!state.verifyResults) return;

  const results = state.verifyResults.results;
  const filtered = state.activeFilter === 'all'
    ? results : results.filter(r => r.verdict === state.activeFilter);

  dom.claimsEmpty.classList.add('hidden');
  dom.claimsList.querySelectorAll('.claim-card').forEach(c => c.remove());

  if (filtered.length === 0) {
    dom.claimsCountBadge.textContent = '0 claims';
    dom.claimsEmpty.classList.remove('hidden');
    dom.claimsEmpty.querySelector('p:first-of-type').textContent = 'No claims match the filter';
    return;
  }

  dom.claimsCountBadge.textContent = `${filtered.length} claim${filtered.length !== 1 ? 's' : ''}`;

  filtered.forEach((claim, idx) => {
    const vc = getVerdictConfig(claim.verdict);
    const card = document.createElement('div');
    card.className = `claim-card rounded-xl p-3 border ${vc.border} ${vc.bg} border-l-2 ${vc.borderLeft} ${state.selectedClaimId === claim.claim_id ? 'selected' : ''}`;
    card.style.animationDelay = `${idx * 40}ms`;
    card.classList.add('animate-slide-right');
    card.dataset.claimId = claim.claim_id;
    card.tabIndex = 0; // Make focusable for keyboard nav

    const confPct = Math.round(claim.confidence * 100);
    const confColor = confPct >= 80 ? 'text-emerald-400' : confPct >= 50 ? 'text-amber-400' : 'text-red-400';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono text-slate-500">#${claim.claim_id}</span>
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${vc.badge}">
            <span>${vc.emoji}</span> ${claim.verdict}
          </span>
        </div>
        <span class="text-xs font-mono ${confColor} font-semibold">${confPct}%</span>
      </div>
      <p class="text-sm text-slate-300 leading-relaxed line-clamp-3">${escapeHtml(claim.claim_text)}</p>
      <div class="flex items-center gap-2 mt-2">
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/60 text-[10px] text-slate-400 font-mono border border-slate-700/30">
          <i data-lucide="bookmark" class="w-2.5 h-2.5"></i> ${escapeHtml(claim.citation_marker)}
        </span>
        ${claim.source_found
          ? '<span class="text-[10px] text-emerald-500 flex items-center gap-0.5"><i data-lucide="check" class="w-2.5 h-2.5"></i>Source found</span>'
          : '<span class="text-[10px] text-red-500 flex items-center gap-0.5"><i data-lucide="x" class="w-2.5 h-2.5"></i>No source</span>'
        }
      </div>
    `;

    card.addEventListener('click', () => selectClaim(claim.claim_id));
    dom.claimsList.appendChild(card);
  });
  initLucide();
}

function resetClaimsPanel() {
  dom.claimsList.querySelectorAll('.claim-card').forEach(c => c.remove());
  dom.claimsEmpty.classList.remove('hidden');
  dom.claimsCountBadge.textContent = '';
}

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
  const ringColor = confPct >= 80 ? '#4ade80' : confPct >= 50 ? '#fbbf24' : '#f87171';

  dom.evidenceContent.querySelector('.evidence-detail')?.remove();
  const detail = document.createElement('div');
  detail.className = 'evidence-detail space-y-5 animate-fade-in';
  
  detail.innerHTML = `
    <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl ${vc.bg} border ${vc.border}">
      <div class="relative w-[76px] h-[76px] shrink-0 mx-auto sm:mx-0">
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
      ${claim.source_found ? `
        <div class="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <i data-lucide="link" class="w-3 h-3"></i>
          <span>Source: <span class="text-slate-400">${escapeHtml(claim.source_type)}</span></span>
          ${claim.source_url ? `<span class="text-indigo-400 truncate max-w-[200px]">${escapeHtml(claim.source_url)}</span>` : ''}
        </div>
      ` : ''}
    </div>

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
  `;

  dom.evidenceContent.appendChild(detail);
  initLucide();
}

function resetEvidencePanel() {
  dom.evidenceContent.querySelector('.evidence-detail')?.remove();
  dom.evidenceEmpty.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════
// BENCHMARKING
// ═══════════════════════════════════════════════════════════════

async function runBenchmark() {
  showLoading('Running benchmark evaluation suite…');
  try {
    const data = await apiFetch('/api/benchmark');
    state.benchmarkData = data;
    renderBenchmarkResults(data);
    hideLoading();
    showToast(`Benchmark complete: ${data.correct_predictions}/${data.total_cases} correct (${Math.round(data.overall_accuracy * 100)}%)`, 'success');
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

function renderBenchmarkResults(data) {
  dom.benchmarkEmpty.classList.add('hidden');
  dom.benchmarkResults.querySelectorAll('.bench-section').forEach(p => p.remove());

  const wrapper = document.createElement('div');
  wrapper.className = 'bench-section space-y-6 animate-slide-up';
  
  const accPct = Math.round(data.overall_accuracy * 100);
  const circ = 2 * Math.PI * 52;
  const dashoffset = circ - (data.overall_accuracy * circ);
  const accColor = accPct >= 80 ? '#4ade80' : accPct >= 50 ? '#fbbf24' : '#f87171';

  wrapper.innerHTML = `
    <div class="glass rounded-2xl p-6">
      <div class="flex flex-col sm:flex-row items-center gap-6">
        <div class="relative w-[120px] h-[120px] shrink-0">
          <svg class="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" class="text-slate-800" stroke-width="6" />
            <circle cx="60" cy="60" r="52" fill="none" stroke="${accColor}" stroke-width="6"
                    stroke-dasharray="${circ}" stroke-dashoffset="${dashoffset}" stroke-linecap="round" class="score-ring" />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-2xl font-bold text-white">${accPct}%</span>
            <span class="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Accuracy</span>
          </div>
        </div>
        <div class="flex-1 text-center sm:text-left">
          <h3 class="text-lg font-bold text-slate-200">Overall Benchmark Accuracy</h3>
          <p class="text-sm text-slate-400 mt-1">${data.correct_predictions} of ${data.total_cases} test cases passed correctly</p>
          <div class="flex flex-wrap gap-3 mt-4 justify-center sm:justify-start">
            <div class="px-3 py-1.5 rounded-lg bg-slate-800/60 text-xs text-slate-300 font-medium">
              <span class="text-emerald-400 font-bold">${data.correct_predictions}</span> Correct
            </div>
            <div class="px-3 py-1.5 rounded-lg bg-slate-800/60 text-xs text-slate-300 font-medium">
              <span class="text-red-400 font-bold">${data.total_cases - data.correct_predictions}</span> Incorrect
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="glass rounded-2xl overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-800/40 flex items-center gap-2">
        <i data-lucide="bar-chart-3" class="w-4 h-4 text-purple-400"></i>
        <h3 class="text-sm font-semibold text-slate-300">Per-Class Metrics</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-800/40 bg-slate-900/40">
              <th class="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Class</th>
              <th class="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Precision</th>
              <th class="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Recall</th>
              <th class="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">F1 Score</th>
              <th class="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Support</th>
            </tr>
          </thead>
          <tbody id="metrics-table-body"></tbody>
        </table>
      </div>
    </div>

    <div class="glass rounded-2xl overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-800/40 flex items-center gap-2">
        <i data-lucide="clipboard-list" class="w-4 h-4 text-emerald-400"></i>
        <h3 class="text-sm font-semibold text-slate-300">Detailed Test Cases</h3>
      </div>
      <div class="overflow-x-auto max-h-[400px]">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-slate-900/90 backdrop-blur">
            <tr class="border-b border-slate-800/40">
              <th class="text-center px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider w-12">ID</th>
              <th class="text-left px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Claim</th>
              <th class="text-center px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Expected</th>
              <th class="text-center px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Predicted</th>
              <th class="text-center px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider w-16">Pass</th>
            </tr>
          </thead>
          <tbody id="cases-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  dom.benchmarkResults.appendChild(wrapper);

  // Per Class Metrics
  const mBody = wrapper.querySelector('#metrics-table-body');
  const classConfigs = {
    'Supported': { emoji: '🟢', color: 'emerald' },
    'Weakly Supported': { emoji: '🟡', color: 'amber' },
    'Mismatched': { emoji: '🔴', color: 'red' },
    'Unverifiable': { emoji: '⚪', color: 'indigo' },
  };

  Object.entries(data.per_class_metrics).forEach(([cls, m]) => {
    const cc = classConfigs[cls] || { emoji: '⬜', color: 'slate' };
    mBody.innerHTML += `
      <tr class="border-b border-slate-800/20 hover:bg-slate-800/20">
        <td class="px-4 py-3"><span class="inline-flex items-center gap-1.5 text-${cc.color}-400 font-medium">${cc.emoji} ${cls}</span></td>
        <td class="text-center px-4 py-3 font-mono text-slate-300">${(m.precision * 100).toFixed(1)}%</td>
        <td class="text-center px-4 py-3 font-mono text-slate-300">${(m.recall * 100).toFixed(1)}%</td>
        <td class="text-center px-4 py-3 font-mono font-semibold text-white">${(m.f1 * 100).toFixed(1)}%</td>
        <td class="text-center px-4 py-3 font-mono text-slate-400">${m.support}</td>
      </tr>
    `;
  });

  // Test Cases
  const cBody = wrapper.querySelector('#cases-table-body');
  data.cases.forEach(c => {
    const expCC = classConfigs[c.expected_verdict] || { emoji: '⬜', color: 'slate' };
    const predCC = classConfigs[c.predicted_verdict] || { emoji: '⬜', color: 'slate' };
    cBody.innerHTML += `
      <tr class="border-b border-slate-800/20 hover:bg-slate-800/20">
        <td class="text-center px-3 py-3 font-mono text-slate-500 text-xs">${c.id}</td>
        <td class="px-3 py-3 text-slate-300 text-xs max-w-xs truncate" title="${escapeHtml(c.claim_text)}">${escapeHtml(truncateText(c.claim_text, 80))}</td>
        <td class="text-center px-3 py-3"><span class="inline-flex items-center gap-1 text-[10px] text-${expCC.color}-400">${expCC.emoji} ${c.expected_verdict}</span></td>
        <td class="text-center px-3 py-3"><span class="inline-flex items-center gap-1 text-[10px] text-${predCC.color}-400">${predCC.emoji} ${c.predicted_verdict}</span></td>
        <td class="text-center px-3 py-3">
          ${c.passed ? '<span class="inline-flex w-6 h-6 rounded-full bg-emerald-950/60 items-center justify-center"><i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i></span>'
                     : '<span class="inline-flex w-6 h-6 rounded-full bg-red-950/60 items-center justify-center"><i data-lucide="x" class="w-3.5 h-3.5 text-red-400"></i></span>'}
        </td>
      </tr>
    `;
  });
  initLucide();
}

// ═══════════════════════════════════════════════════════════════
// EXPORTING
// ═══════════════════════════════════════════════════════════════

function updateExportTab() {
  if (state.verifyResults) {
    dom.exportEmpty.classList.add('hidden');
    dom.exportOptions.classList.remove('hidden');
    dom.exportPreview.classList.remove('hidden');
    const res = state.verifyResults;
    dom.exportStats.textContent = `${res.results.length} claims · ${res.summary.supported} supported · ${res.summary.mismatched} mismatched`;
    dom.exportPreviewContent.textContent = generateMarkdownReport(res); // Show MD by default
  } else {
    dom.exportEmpty.classList.remove('hidden');
    dom.exportOptions.classList.add('hidden');
    dom.exportPreview.classList.add('hidden');
  }
}

function exportReport(format) {
  if (!state.verifyResults) return showToast('No verification data', 'warn');

  let content, mimeType, fileName;
  if (format === 'json') {
    content = JSON.stringify(state.verifyResults, null, 2);
    mimeType = 'application/json';
    fileName = 'citeguard_audit.json';
  } else {
    content = generateMarkdownReport(state.verifyResults);
    mimeType = 'text/markdown';
    fileName = 'citeguard_audit.md';
  }

  downloadFile(content, mimeType, fileName);
  showToast(`Downloaded ${fileName}`, 'success');
}

function generateMarkdownReport(data) {
  const s = data.summary;
  let md = `# CiteGuard AI — Citation Audit Report\n\n**Generated:** ${new Date().toISOString()}\n\n## Summary\n\n`;
  md += `| Metric | Count |\n|---|---|\n| Total Claims | ${s.total_claims} |\n| ✅ Supported | ${s.supported} |\n| ⚠️ Weakly Supported | ${s.weakly_supported} |\n| ❌ Mismatched | ${s.mismatched} |\n| ❓ Unverifiable | ${s.unverifiable} |\n\n## Detailed Results\n\n`;

  data.results.forEach(r => {
    md += `### Claim #${r.claim_id} — ${r.verdict} (${Math.round(r.confidence * 100)}% confidence)\n\n`;
    md += `**Claim:** ${r.claim_text}\n\n**Citation:** ${r.citation_marker} → ${r.cited_reference}\n\n`;
    md += `**Source Found:** ${r.source_found ? 'Yes' : 'No'} (${r.source_type})\n\n`;
    if (r.evidence_snippet) md += `**Evidence:**\n> ${r.evidence_snippet}\n\n`;
    md += `**Explanation:** ${r.explanation}\n\n---\n\n`;
  });
  return md;
}

function downloadFile(content, mimeType, fileName) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyExportToClipboard() {
  if (!state.verifyResults) return;
  const content = dom.exportPreviewContent.textContent;
  navigator.clipboard.writeText(content).then(() => {
    showToast('Report copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES & MOCK DATA GENERATORS
// ═══════════════════════════════════════════════════════════════

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncateText(text, maxLen = 100) {
  if (!text || text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '…';
}

function getMockData(url) {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (url === '/api/sample') {
        resolve({
          document_text: "Mock document about transformers replacing RNNs [1] and LLMs requiring less data [2].",
          source_texts: {}, title: "Attention Is All You Need (Mock)"
        });
      } else if (url === '/api/verify') {
        resolve({
          summary: { total_claims: 4, supported: 1, weakly_supported: 1, mismatched: 1, unverifiable: 1 },
          results: [
            { claim_id: 1, verdict: "Supported", confidence: 0.96, claim_text: "Transformer architectures dispense with recurrence entirely.", citation_marker: "[1]", cited_reference: "Vaswani 2017", source_found: true, source_type: "Crossref", evidence_snippet: "We propose the Transformer, dispensing with recurrence.", explanation: "Source explicitly confirms the claim." },
            { claim_id: 2, verdict: "Mismatched", confidence: 0.89, claim_text: "LLMs require significantly less training data.", citation_marker: "[2]", cited_reference: "Kaplan 2020", source_found: true, source_type: "PDF", evidence_snippet: "Model performance improves smoothly as dataset size increases, necessitating vast corpora.", explanation: "Contradiction: claim says 'less data', source says 'vast corpora'." },
            { claim_id: 3, verdict: "Weakly Supported", confidence: 0.65, claim_text: "Fine-tuning improves truthfulness.", citation_marker: "[3]", cited_reference: "Bai 2022", source_found: true, source_type: "ArXiv", evidence_snippet: "RLHF improves helpfulness, though truthfulness remains complex.", explanation: "Source mentions truthfulness but does not explicitly confirm improvement." },
            { claim_id: 4, verdict: "Unverifiable", confidence: 0.42, claim_text: "80% of deployments fail.", citation_marker: "[4]", cited_reference: "Gartner 2023", source_found: false, source_type: "Paywall", evidence_snippet: null, explanation: "Could not access source material." }
          ]
        });
      } else if (url === '/api/benchmark') {
        resolve({
          overall_accuracy: 0.75, total_cases: 4, correct_predictions: 3,
          per_class_metrics: {
            "Supported": { precision: 1.0, recall: 1.0, f1: 1.0, support: 1 },
            "Mismatched": { precision: 1.0, recall: 1.0, f1: 1.0, support: 1 },
            "Weakly Supported": { precision: 0.0, recall: 0.0, f1: 0.0, support: 1 },
            "Unverifiable": { precision: 1.0, recall: 1.0, f1: 1.0, support: 1 }
          },
          cases: [
            { id: "TC-001", claim_text: "Transformers use attention.", expected_verdict: "Supported", predicted_verdict: "Supported", passed: true },
            { id: "TC-002", claim_text: "LLMs use less data.", expected_verdict: "Mismatched", predicted_verdict: "Mismatched", passed: true },
            { id: "TC-003", claim_text: "RLHF fixes everything.", expected_verdict: "Weakly Supported", predicted_verdict: "Supported", passed: false },
            { id: "TC-004", claim_text: "80% failure rate.", expected_verdict: "Unverifiable", predicted_verdict: "Unverifiable", passed: true }
          ]
        });
      }
    }, 1500); // 1.5s simulated delay
  });
}

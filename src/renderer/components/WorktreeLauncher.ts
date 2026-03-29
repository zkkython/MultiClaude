import type { ModelConfig, WorktreeInfo, WorktreeMergeReadiness } from '../../shared/types.js';
import { setupDialogA11y } from './modal-a11y.js';

interface WorktreeLauncherOptions {
  config: ModelConfig;
  initialRepoPath: string;
  initialTargetRef: string;
  onOpenTerminal: (cwd: string, customName?: string) => void;
  onPersistDefaults: (repoPath: string, targetRef: string) => Promise<void>;
}

type LauncherTab = 'worktree' | 'merge';
type ReadinessFilter = 'all' | 'ready' | 'behind' | 'dirty' | 'unknown';
type BatchEntryStatus = 'ok' | 'skipped' | 'error';

interface BatchCommandEntry {
  source: string;
  worktreePath: string;
  status: BatchEntryStatus;
  command?: string;
  reason?: string;
}

export function buildWorktreeLauncherMarkup(configName: string, repoPath: string, targetRef: string): string {
  return `
    <div class="modal-header">
      <h2>Worktree · ${escapeHtml(configName)}</h2>
      <div class="modal-header-actions">
        <button class="btn btn-secondary btn-sm" type="button" id="wt-help-toggle">Help</button>
        <button class="btn btn-icon modal-close-btn" aria-label="Close dialog">✕</button>
      </div>
    </div>
    <div class="modal-body">
      <details id="wt-help-panel" class="worktree-help-panel">
        <summary>Worktree + Merge Quick Help</summary>
        <div>
          1) Worktree tab: choose repo, create/open worktree, then start terminal.
          <br />
          2) Merge tab: set target branch, select source branches, copy command(s).
          <br />
          3) Bulk flow: use "Select merge-ready" then "Copy Batch Commands".
        </div>
      </details>
      <div class="worktree-tabs" role="tablist" aria-label="Worktree actions">
        <button type="button" class="worktree-tab is-active" data-tab="worktree" role="tab" aria-selected="true">Worktree</button>
        <button type="button" class="worktree-tab" data-tab="merge" role="tab" aria-selected="false">Merge</button>
      </div>

      <section class="worktree-panel is-active" data-panel="worktree" role="tabpanel">
        <div class="task-brief task-brief-worktree">
          <strong>Task goal:</strong> create or pick a worktree and open a coding terminal.
          <div class="task-brief-done">Done when terminal opens in the selected worktree.</div>
        </div>
        <div class="task-tip">Tip: choose repository first, then either create a new worktree or open an existing one. Shortcut: ⌘/Ctrl+1 switch Worktree tab.</div>
        <div id="wt-feedback-worktree" class="task-feedback" aria-live="polite"></div>
        <p class="worktree-step-hint">Step 1 · Select repository.</p>
        <div class="form-group">
          <label for="wt-repo-path">Repository Directory</label>
          <div class="input-with-toggle">
            <input id="wt-repo-path" type="text" value="${escapeHtml(repoPath)}" placeholder="/path/to/repo" />
            <button type="button" class="btn btn-secondary" id="wt-browse">Browse</button>
          </div>
        </div>
        <p class="worktree-step-hint">Step 2 · Create a new worktree, or choose one from the list.</p>
        <div class="form-group">
          <div class="form-section-label">Create New Worktree</div>
          <div class="worktree-create-grid">
            <label for="wt-branch-name" class="visually-hidden">Branch name</label>
            <input id="wt-branch-name" type="text" placeholder="wt/task-name" />
            <label for="wt-path-name" class="visually-hidden">Worktree directory name</label>
            <input id="wt-path-name" type="text" placeholder="worktree directory name" />
            <label for="wt-from-ref" class="visually-hidden">Base reference</label>
            <input id="wt-from-ref" type="text" value="HEAD" placeholder="from ref (default HEAD)" />
            <button type="button" class="btn btn-primary" id="wt-create-open">Create + Open Terminal</button>
          </div>
          <label class="wt-existing-branch-toggle">
            <input type="checkbox" id="wt-use-existing-branch" />
            Use existing branch (open branch as new worktree)
          </label>
          <div class="form-help" id="wt-create-mode-help">Default strategy creates a new branch from current HEAD.</div>
        </div>
        <div class="form-group">
          <div class="form-section-label">Existing Worktrees</div>
          <div id="wt-readiness-summary" class="worktree-readiness-summary">Loading readiness summary...</div>
          <div class="worktree-bulk-actions">
            <button type="button" class="btn btn-secondary btn-sm is-active" id="wt-filter-all">All</button>
            <button type="button" class="btn btn-secondary btn-sm" id="wt-filter-ready">Ready</button>
            <button type="button" class="btn btn-secondary btn-sm" id="wt-filter-behind">Behind</button>
            <button type="button" class="btn btn-secondary btn-sm" id="wt-filter-dirty">Dirty</button>
            <button type="button" class="btn btn-secondary btn-sm" id="wt-filter-unknown">Unknown</button>
            <label class="wt-compact-toggle">
              <input type="checkbox" id="wt-compact-toggle" checked />
              Compact rows
            </label>
          </div>
          <div id="wt-list" class="worktree-list">Loading...</div>
          <div class="form-help">Readiness checks use Merge tab target: <span id="wt-readiness-target-label">${escapeHtml(targetRef)}</span></div>
        </div>
        <p class="worktree-step-hint">Step 3 · Open terminal and start coding in the selected worktree.</p>
      </section>

      <section class="worktree-panel" data-panel="merge" role="tabpanel" hidden>
        <div class="task-brief task-brief-merge">
          <strong>Task goal:</strong> generate a safe merge command for your target branch.
          <div class="task-brief-done">Done when command is copied and ready to run in terminal.</div>
        </div>
        <div class="task-tip">Shortcut: ⌘/Ctrl+2 switch Merge tab · ⌘/Ctrl+Shift+C copy merge command.</div>
        <div id="wt-feedback-merge" class="task-feedback" aria-live="polite"></div>
        <p class="worktree-step-hint">Step 1 · Choose target branch for readiness and merge.</p>
        <div class="form-group">
          <label for="wt-target-ref">Merge Target Branch</label>
          <input id="wt-target-ref" type="text" value="${escapeHtml(targetRef)}" placeholder="main" />
          <div class="form-help">We check if your source branch is ready to merge into this target branch.</div>
        </div>
        <p class="worktree-step-hint">Step 2 · Choose merge strategy and source ref.</p>
        <div class="form-group">
          <div class="form-section-label">Generate Merge Command</div>
          <div class="worktree-create-grid worktree-merge-grid">
            <label for="wt-merge-strategy" class="visually-hidden">Merge strategy</label>
            <select id="wt-merge-strategy">
              <option value="merge">merge</option>
              <option value="rebase">rebase</option>
              <option value="squash">squash</option>
            </select>
            <label for="wt-merge-source" class="visually-hidden">Source branch</label>
            <input id="wt-merge-source" type="text" placeholder="source branch (e.g. wt/task-2026-03-24-0)" />
            <button type="button" class="btn btn-secondary" id="wt-copy-template">Copy Merge Command</button>
          </div>
          <div class="form-help">Use this in repo root. Example source: <code>wt/task-2026-03-24-0</code>.</div>
          <pre id="wt-template-preview" class="worktree-template-preview">Fill source + target refs to preview command.</pre>
        </div>
        <div class="form-group">
          <div class="form-section-label">Bulk Merge Commands</div>
          <div class="worktree-bulk-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="wt-select-ready">Select merge-ready</button>
            <button type="button" class="btn btn-secondary btn-sm" id="wt-clear-selection">Clear selection</button>
            <button type="button" class="btn btn-secondary btn-sm" id="wt-copy-batch">Copy Batch Commands</button>
          </div>
          <div class="form-help">Batch uses selected worktrees with known branch names.</div>
          <pre id="wt-batch-preview" class="worktree-template-preview">Select one or more worktrees to preview batch commands.</pre>
        </div>
        <p class="worktree-step-hint">Step 3 · Paste into terminal and run after confirming readiness.</p>
      </section>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="wt-refresh">Refresh</button>
      <button class="btn btn-secondary" id="wt-close">Close</button>
    </div>
  `;
}

export function showWorktreeLauncher(options: WorktreeLauncherOptions): void {
  const oldModal = document.querySelector('.modal-overlay');
  if (oldModal) oldModal.remove();

  let repoPath = options.initialRepoPath;
  let targetRef = options.initialTargetRef || 'main';
  let activeTab: LauncherTab = 'worktree';
  let worktrees: WorktreeInfo[] = [];
  const readinessByPath = new Map<string, WorktreeMergeReadiness | null>();
  const lastFeedbackByScope: Record<LauncherTab, { level: 'error' | 'success'; message: string; at: number } | null> = {
    worktree: null,
    merge: null,
  };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal worktree-launcher';
  modal.innerHTML = buildWorktreeLauncherMarkup(options.config.name, repoPath, targetRef);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const teardownDialogA11y = setupDialogA11y({
    modal,
    onEscape: close,
  });

  const repoInput = modal.querySelector('#wt-repo-path') as HTMLInputElement;
  const targetInput = modal.querySelector('#wt-target-ref') as HTMLInputElement;
  const readinessTargetLabel = modal.querySelector('#wt-readiness-target-label') as HTMLElement;
  const readinessSummaryEl = modal.querySelector('#wt-readiness-summary') as HTMLElement;
  const listEl = modal.querySelector('#wt-list') as HTMLElement;
  const branchInput = modal.querySelector('#wt-branch-name') as HTMLInputElement;
  const pathInput = modal.querySelector('#wt-path-name') as HTMLInputElement;
  const fromRefInput = modal.querySelector('#wt-from-ref') as HTMLInputElement;
  const useExistingBranchInput = modal.querySelector('#wt-use-existing-branch') as HTMLInputElement;
  const createModeHelp = modal.querySelector('#wt-create-mode-help') as HTMLElement;
  const mergeSourceInput = modal.querySelector('#wt-merge-source') as HTMLInputElement;
  const mergeStrategyInput = modal.querySelector('#wt-merge-strategy') as HTMLSelectElement;
  const templatePreview = modal.querySelector('#wt-template-preview') as HTMLElement;
  const batchPreview = modal.querySelector('#wt-batch-preview') as HTMLElement;
  const selectReadyBtn = modal.querySelector('#wt-select-ready') as HTMLButtonElement;
  const clearSelectionBtn = modal.querySelector('#wt-clear-selection') as HTMLButtonElement;
  const copyBatchBtn = modal.querySelector('#wt-copy-batch') as HTMLButtonElement;
  const helpToggleBtn = modal.querySelector('#wt-help-toggle') as HTMLButtonElement;
  const helpPanel = modal.querySelector('#wt-help-panel') as HTMLDetailsElement;
  const refreshBtn = modal.querySelector('#wt-refresh') as HTMLButtonElement;
  const worktreeFeedback = modal.querySelector('#wt-feedback-worktree') as HTMLElement;
  const mergeFeedback = modal.querySelector('#wt-feedback-merge') as HTMLElement;
  const tabButtons = Array.from(modal.querySelectorAll('.worktree-tab')) as HTMLButtonElement[];
  const tabPanels = Array.from(modal.querySelectorAll('.worktree-panel')) as HTMLElement[];
  const selectedWorktreePaths = new Set<string>();
  const filterButtons: Record<ReadinessFilter, HTMLButtonElement> = {
    all: modal.querySelector('#wt-filter-all') as HTMLButtonElement,
    ready: modal.querySelector('#wt-filter-ready') as HTMLButtonElement,
    behind: modal.querySelector('#wt-filter-behind') as HTMLButtonElement,
    dirty: modal.querySelector('#wt-filter-dirty') as HTMLButtonElement,
    unknown: modal.querySelector('#wt-filter-unknown') as HTMLButtonElement,
  };
  const compactToggle = modal.querySelector('#wt-compact-toggle') as HTMLInputElement;
  let readinessFilter: ReadinessFilter = 'all';
  let compactRows = true;

  branchInput.value = defaultBranchName();
  pathInput.value = defaultPathName(branchInput.value);
  syncCreateModeUI();

  repoInput.addEventListener('input', () => {
    repoPath = repoInput.value.trim();
  });
  targetInput.addEventListener('input', () => {
    targetRef = targetInput.value.trim() || 'main';
    readinessTargetLabel.textContent = targetRef;
    void updateMergePreview();
  });
  branchInput.addEventListener('input', () => {
    if (!pathInput.value.trim()) {
      pathInput.value = defaultPathName(branchInput.value);
    }
  });
  useExistingBranchInput.addEventListener('change', () => {
    syncCreateModeUI();
  });
  mergeStrategyInput.addEventListener('change', () => {
    void updateMergePreview();
  });
  mergeSourceInput.addEventListener('input', () => {
    void updateMergePreview();
  });

  modal.querySelector('.modal-close-btn')?.addEventListener('click', close);
  helpToggleBtn.addEventListener('click', () => {
    helpPanel.open = !helpPanel.open;
  });
  modal.querySelector('#wt-close')?.addEventListener('click', close);
  refreshBtn.addEventListener('click', () => {
    void refresh();
  });
  modal.querySelector('#wt-browse')?.addEventListener('click', async () => {
    const selected = await window.multiclaude.app.selectDirectory(repoPath);
    if (selected) {
      repoPath = selected;
      repoInput.value = selected;
      await refresh();
    }
  });
  modal.querySelector('#wt-create-open')?.addEventListener('click', async () => {
    try {
      const branchName = branchInput.value.trim();
      const pathName = pathInput.value.trim() || defaultPathName(branchName);
      if (!repoPath || !branchName) {
        showFeedback('worktree', 'error', 'Repository path and branch name are required.');
        return;
      }
      const worktreePath = joinPath(parentDir(repoPath), pathName);
      const created = await window.multiclaude.worktree.create({
        repoPath,
        worktreePath,
        branchName,
        fromRef: fromRefInput.value.trim() || 'HEAD',
        useExistingBranch: useExistingBranchInput.checked,
      });
      await options.onPersistDefaults(repoPath, targetRef);
      options.onOpenTerminal(created.path, branchName);
      showFeedback('worktree', 'success', `Terminal opened in ${created.path}`);
      await refresh();
    } catch (err) {
      showFeedback(
        'worktree',
        'error',
        toActionableMessage(`Failed to create worktree: ${formatError(err)}`),
        {
          label: 'Retry',
          onClick: () => {
            (modal.querySelector('#wt-create-open') as HTMLButtonElement | null)?.click();
          },
        }
      );
    }
  });
  modal.querySelector('#wt-copy-template')?.addEventListener('click', async () => {
    const source = mergeSourceInput.value.trim();
    const target = targetInput.value.trim();
    if (!source || !target) {
      showFeedback('merge', 'error', 'Source and target refs are required.');
      return;
    }
    try {
      const template = await window.multiclaude.worktree.buildMergeTemplate({
        strategy: mergeStrategyInput.value as 'merge' | 'rebase' | 'squash',
        sourceRef: source,
        targetRef: target,
      });
      await navigator.clipboard.writeText(template.command);
      templatePreview.textContent = template.command;
      showFeedback('merge', 'success', 'Merge command copied to clipboard.');
    } catch (err) {
      showFeedback(
        'merge',
        'error',
        toActionableMessage(`Failed to build merge template: ${formatError(err)}`),
      );
    }
  });
  selectReadyBtn.addEventListener('click', () => {
    selectedWorktreePaths.clear();
    for (const item of worktrees) {
      const readiness = readinessByPath.get(item.path);
      if (readiness && readiness.behind === 0 && !readiness.dirty) {
        selectedWorktreePaths.add(item.path);
      }
    }
    renderList();
    void updateBatchPreview();
  });
  clearSelectionBtn.addEventListener('click', () => {
    selectedWorktreePaths.clear();
    renderList();
    void updateBatchPreview();
  });
  filterButtons.all.addEventListener('click', () => setReadinessFilter('all'));
  filterButtons.ready.addEventListener('click', () => setReadinessFilter('ready'));
  filterButtons.behind.addEventListener('click', () => setReadinessFilter('behind'));
  filterButtons.dirty.addEventListener('click', () => setReadinessFilter('dirty'));
  filterButtons.unknown.addEventListener('click', () => setReadinessFilter('unknown'));
  compactToggle.addEventListener('change', () => {
    compactRows = compactToggle.checked;
    renderList();
  });
  copyBatchBtn.addEventListener('click', async () => {
    await copyBatchCommands();
  });
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.dataset.tab === 'merge' ? 'merge' : 'worktree');
    });
  });
  modal.addEventListener('keydown', (e) => {
    if (!shouldHandleModalShortcut(e, modal)) return;
    const modifier = e.metaKey || e.ctrlKey;
    if (!modifier) return;
    if (e.key === '1') {
      e.preventDefault();
      setActiveTab('worktree');
      repoInput.focus();
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      setActiveTab('merge');
      mergeSourceInput.focus();
      return;
    }
    if (e.key.toLowerCase() === 'r' && activeTab === 'worktree') {
      e.preventDefault();
      void refresh();
      return;
    }
    if (e.shiftKey && e.key.toLowerCase() === 'c' && activeTab === 'merge') {
      e.preventDefault();
      (modal.querySelector('#wt-copy-template') as HTMLButtonElement | null)?.click();
      return;
    }
    if (e.shiftKey && e.key.toLowerCase() === 'b' && activeTab === 'merge') {
      e.preventDefault();
      copyBatchBtn.click();
    }
  });
  branchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (isImeComposingKeyEvent(e)) return;
    e.preventDefault();
    (modal.querySelector('#wt-create-open') as HTMLButtonElement | null)?.click();
  });
  mergeSourceInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (isImeComposingKeyEvent(e)) return;
    e.preventDefault();
    (modal.querySelector('#wt-copy-template') as HTMLButtonElement | null)?.click();
  });

  function close() {
    teardownDialogA11y();
    overlay.remove();
  }

  function syncCreateModeUI(): void {
    const useExisting = useExistingBranchInput.checked;
    fromRefInput.disabled = useExisting;
    if (useExisting) {
      fromRefInput.title = 'Existing-branch mode does not use from-ref.';
      createModeHelp.textContent = 'Existing-branch mode opens an already-created branch in a new worktree.';
      return;
    }
    fromRefInput.title = '';
    createModeHelp.textContent = 'Default strategy creates a new branch from current HEAD.';
  }

  async function refresh(): Promise<void> {
    if (!repoPath) {
      readinessSummaryEl.textContent = 'No repository selected.';
      listEl.textContent = 'Enter repository directory first.';
      return;
    }
    listEl.textContent = 'Loading...';
    readinessByPath.clear();
    try {
      worktrees = await window.multiclaude.worktree.list(repoPath);
      const existingPaths = new Set(worktrees.map(item => item.path));
      for (const selectedPath of Array.from(selectedWorktreePaths)) {
        if (!existingPaths.has(selectedPath)) selectedWorktreePaths.delete(selectedPath);
      }
      await options.onPersistDefaults(repoPath, targetRef);
      await Promise.all(worktrees.map(async (item) => {
        try {
          const readiness = await window.multiclaude.worktree.mergeReadiness(item.path, targetRef);
          readinessByPath.set(item.path, readiness);
        } catch {
          readinessByPath.set(item.path, null);
        }
      }));
      renderReadinessSummary();
      renderList();
      await updateBatchPreview();
      clearFeedback('worktree');
    } catch (err) {
      readinessSummaryEl.textContent = 'Unable to load readiness summary.';
      listEl.textContent = `Failed to load worktrees: ${formatError(err)}`;
      showFeedback(
        'worktree',
        'error',
        toActionableMessage(`Failed to load worktrees: ${formatError(err)}`),
        {
          label: 'Retry',
          onClick: () => {
            void refresh();
          },
        }
      );
    }
  }

  function renderList(): void {
    if (worktrees.length === 0) {
      readinessSummaryEl.textContent = 'No worktrees available.';
      listEl.textContent = 'No worktrees found.';
      batchPreview.textContent = 'Select one or more worktrees to preview batch commands.';
      return;
    }
    const filtered = getFilteredAndSortedWorktrees();
    if (filtered.length === 0) {
      listEl.textContent = `No worktrees match filter: ${readinessFilter}.`;
      return;
    }
    listEl.innerHTML = filtered.map((item) => {
      const readiness = readinessByPath.get(item.path);
      const readinessText = readiness
        ? `merge to ${escapeHtml(targetRef)}: ${readiness.ahead} ahead, ${readiness.behind} behind${readiness.dirty ? ', has local changes' : ''}`
        : `merge to ${escapeHtml(targetRef)}: unavailable`;
      const readinessHints = readiness
        ? buildReadinessHintTags(readiness, targetRef, item.branch || '(unknown)')
        : '';
      const selected = selectedWorktreePaths.has(item.path);
      return `
        <div class="worktree-row${compactRows ? ' is-compact' : ''}" data-worktree-path="${escapeHtml(item.path)}" data-worktree-branch="${escapeHtml(item.branch || '')}">
          <label class="worktree-select-cell">
            <input type="checkbox" data-action="select" ${selected ? 'checked' : ''} />
          </label>
          <div class="worktree-meta">
            <div><strong>${escapeHtml(item.branch || '(unknown)')}</strong> ${item.isMain ? '<span class="provider-pill">main</span>' : ''}</div>
            <div class="form-help">${escapeHtml(item.path)}</div>
            <div class="form-help">${readinessText} ${readinessHints}</div>
          </div>
          <div class="worktree-actions">
            <button class="btn btn-sm" data-action="open">Open</button>
            <button class="btn btn-sm" data-action="remove">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.worktree-row').forEach((row) => {
      const worktreePath = (row as HTMLElement).dataset.worktreePath!;
      const openBtn = row.querySelector('[data-action="open"]');
      const removeBtn = row.querySelector('[data-action="remove"]');
      const selectInput = row.querySelector('[data-action="select"]') as HTMLInputElement | null;
      const worktreeBranch = (row as HTMLElement).dataset.worktreeBranch?.trim() || undefined;
      selectInput?.addEventListener('change', () => {
        if (selectInput.checked) selectedWorktreePaths.add(worktreePath);
        else selectedWorktreePaths.delete(worktreePath);
        void updateBatchPreview();
      });
      openBtn?.addEventListener('click', () => options.onOpenTerminal(worktreePath, worktreeBranch));
      removeBtn?.addEventListener('click', async () => {
        if (!confirm(`Remove worktree?\n${worktreePath}`)) return;
        try {
          await window.multiclaude.worktree.remove({ repoPath, worktreePath });
          await window.multiclaude.worktree.prune(repoPath);
          showFeedback('worktree', 'success', `Removed worktree ${worktreePath}`);
          await refresh();
        } catch (err) {
          const msg = formatError(err);
          if (msg.includes('dirty_tree')) {
            showFeedback('worktree', 'error', 'Cannot remove worktree with uncommitted changes. Commit, stash, or discard changes first.');
            return;
          }
          showFeedback(
            'worktree',
            'error',
            toActionableMessage(`Failed to remove worktree: ${msg}`),
            {
              label: 'Retry',
              onClick: () => {
                (row.querySelector('[data-action="remove"]') as HTMLButtonElement | null)?.click();
              },
            }
          );
        }
      });
    });
  }

  function renderReadinessSummary(): void {
    if (worktrees.length === 0) {
      readinessSummaryEl.textContent = 'No worktrees available.';
      return;
    }
    let ready = 0;
    let behind = 0;
    let dirty = 0;
    let unavailable = 0;
    let dirtyModifiedTotal = 0;
    let dirtyUntrackedTotal = 0;
    for (const item of worktrees) {
      const readiness = readinessByPath.get(item.path);
      if (!readiness) {
        unavailable += 1;
        continue;
      }
      if (readiness.behind > 0) behind += 1;
      if (readiness.dirty) {
        dirty += 1;
        dirtyModifiedTotal += readiness.modifiedCount;
        dirtyUntrackedTotal += readiness.untrackedCount;
      }
      if (readiness.behind === 0 && !readiness.dirty) ready += 1;
    }
    readinessSummaryEl.innerHTML = `
      <span class="summary-chip summary-chip-ok">Ready ${ready}</span>
      <span class="summary-chip summary-chip-warn" title="${escapeHtml(`${behind} worktree(s) are behind ${targetRef}: target branch has commits not in source branch.`)}">Behind ${behind}</span>
      <span class="summary-chip summary-chip-warn" title="${escapeHtml(`${dirty} worktree(s) are dirty: ${dirtyModifiedTotal} modified + ${dirtyUntrackedTotal} untracked file(s).`)}">Dirty ${dirty}</span>
      <span class="summary-chip summary-chip-muted">Unknown ${unavailable}</span>
      <span class="summary-chip summary-chip-muted">Selected ${selectedWorktreePaths.size}</span>
    `;
  }

  async function buildBatchPlan(): Promise<BatchCommandEntry[]> {
    const selected = worktrees.filter((item) => selectedWorktreePaths.has(item.path));
    const entries: BatchCommandEntry[] = [];
    for (const item of selected) {
      const source = (item.branch || '').trim();
      const target = targetInput.value.trim();
      if (item.isMain) {
        entries.push({ source: source || '(main)', worktreePath: item.path, status: 'skipped', reason: 'main worktree is not a merge source' });
        continue;
      }
      if (!source) {
        entries.push({ source: '(unknown)', worktreePath: item.path, status: 'skipped', reason: 'missing branch name' });
        continue;
      }
      if (!target) {
        entries.push({ source, worktreePath: item.path, status: 'error', reason: 'missing merge target branch' });
        continue;
      }
      try {
        const template = await window.multiclaude.worktree.buildMergeTemplate({
          strategy: mergeStrategyInput.value as 'merge' | 'rebase' | 'squash',
          sourceRef: source,
          targetRef: target,
        });
        entries.push({ source, worktreePath: item.path, status: 'ok', command: template.command });
      } catch (err) {
        entries.push({ source, worktreePath: item.path, status: 'error', reason: formatError(err) });
      }
    }
    return entries;
  }

  async function updateBatchPreview(): Promise<void> {
    const plan = await buildBatchPlan();
    if (plan.length === 0) {
      batchPreview.textContent = 'Select one or more worktrees to preview batch commands.';
      return;
    }
    batchPreview.textContent = formatBatchPlan(plan);
    renderReadinessSummary();
  }

  async function copyBatchCommands(): Promise<void> {
    const plan = await buildBatchPlan();
    if (plan.length === 0) {
      showFeedback('merge', 'error', 'No selected worktrees for batch copy.');
      return;
    }
    const ok = plan.filter((entry) => entry.status === 'ok' && entry.command);
    const skipped = plan.filter((entry) => entry.status === 'skipped');
    const failed = plan.filter((entry) => entry.status === 'error');
    if (ok.length === 0) {
      batchPreview.textContent = formatBatchPlan(plan);
      showFeedback('merge', 'error', 'Batch failed: no valid commands generated.');
      return;
    }
    const text = ok.map((entry) => `# ${entry.source}\n${entry.command}`).join('\n\n');
    await navigator.clipboard.writeText(text);
    batchPreview.textContent = formatBatchPlan(plan);
    showFeedback(
      'merge',
      'success',
      `Batch copied: ${ok.length} ok, ${failed.length} failed, ${skipped.length} skipped.`
    );
  }

  function setReadinessFilter(next: ReadinessFilter): void {
    readinessFilter = next;
    for (const [key, btn] of Object.entries(filterButtons) as Array<[ReadinessFilter, HTMLButtonElement]>) {
      btn.classList.toggle('is-active', key === next);
    }
    renderList();
  }

  function getFilteredAndSortedWorktrees(): WorktreeInfo[] {
    const weight = (item: WorktreeInfo): number => {
      const readiness = readinessByPath.get(item.path);
      if (!readiness) return 3;
      if (readiness.dirty) return 2;
      if (readiness.behind > 0) return 1;
      return 0;
    };
    const filtered = worktrees.filter((item) => matchesFilter(item, readinessFilter));
    return filtered.sort((a, b) => {
      const diff = weight(a) - weight(b);
      if (diff !== 0) return diff;
      return (a.branch || '').localeCompare(b.branch || '');
    });
  }

  function matchesFilter(item: WorktreeInfo, filter: ReadinessFilter): boolean {
    if (filter === 'all') return true;
    const readiness = readinessByPath.get(item.path);
    if (!readiness) return filter === 'unknown';
    if (filter === 'ready') return readiness.behind === 0 && !readiness.dirty;
    if (filter === 'behind') return readiness.behind > 0;
    if (filter === 'dirty') return readiness.dirty;
    return false;
  }

  function formatBatchPlan(plan: BatchCommandEntry[]): string {
    const lines: string[] = [];
    const ok = plan.filter((entry) => entry.status === 'ok');
    const failed = plan.filter((entry) => entry.status === 'error');
    const skipped = plan.filter((entry) => entry.status === 'skipped');
    lines.push(`Summary: ${ok.length} ok · ${failed.length} failed · ${skipped.length} skipped`);
    lines.push('');
    for (const entry of plan) {
      if (entry.status === 'ok') {
        lines.push(`[OK] ${entry.source}`);
        lines.push(entry.command || '');
        lines.push('');
        continue;
      }
      if (entry.status === 'error') {
        lines.push(`[FAILED] ${entry.source} — ${entry.reason || 'unknown error'}`);
        lines.push('');
        continue;
      }
      lines.push(`[SKIPPED] ${entry.source} — ${entry.reason || 'not applicable'}`);
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  void refresh();
  void updateMergePreview();
  setActiveTab(activeTab);

  function setActiveTab(nextTab: LauncherTab): void {
    activeTab = nextTab;
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === nextTab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.panel === nextTab;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });
    const refreshEnabled = nextTab === 'worktree';
    refreshBtn.disabled = !refreshEnabled;
    refreshBtn.title = refreshEnabled
      ? 'Refresh worktree list'
      : 'Refresh is only available in the Worktree tab';
  }

  async function updateMergePreview(): Promise<void> {
    const source = mergeSourceInput.value.trim();
    const target = targetInput.value.trim();
    if (!source || !target) {
      templatePreview.textContent = 'Fill source + target refs to preview command.';
      return;
    }
    try {
      const template = await window.multiclaude.worktree.buildMergeTemplate({
        strategy: mergeStrategyInput.value as 'merge' | 'rebase' | 'squash',
        sourceRef: source,
        targetRef: target,
      });
      templatePreview.textContent = template.command;
      clearFeedback('merge');
    } catch (err) {
      templatePreview.textContent = 'Unable to preview command with current refs.';
      showFeedback('merge', 'error', toActionableMessage(`Failed to preview merge command: ${formatError(err)}`));
    }
  }

  function clearFeedback(scope: LauncherTab): void {
    const feedbackEl = scope === 'worktree' ? worktreeFeedback : mergeFeedback;
    feedbackEl.innerHTML = '';
    feedbackEl.className = 'task-feedback';
  }

  function showFeedback(
    scope: LauncherTab,
    level: 'error' | 'success',
    message: string,
    action?: { label: string; onClick: () => void },
  ): void {
    const now = Date.now();
    const prev = lastFeedbackByScope[scope];
    if (prev && prev.level === level && prev.message === message && now - prev.at < 2000) {
      return;
    }
    lastFeedbackByScope[scope] = { level, message, at: now };
    const feedbackEl = scope === 'worktree' ? worktreeFeedback : mergeFeedback;
    feedbackEl.className = `task-feedback ${level === 'error' ? 'is-error' : 'is-success'}`;
    feedbackEl.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    feedbackEl.appendChild(text);
    const helpText = getErrorHelpText(message);
    if (level === 'error' && helpText) {
      const details = document.createElement('details');
      details.className = 'task-feedback-help';
      const summary = document.createElement('summary');
      summary.textContent = 'Why this happens';
      const helpBody = document.createElement('div');
      helpBody.textContent = helpText;
      details.appendChild(summary);
      details.appendChild(helpBody);
      feedbackEl.appendChild(details);
    }
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-secondary';
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      feedbackEl.appendChild(btn);
    }
  }
}

function defaultBranchName(): string {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  return `wt/task-${ts}`;
}

function defaultPathName(branchName: string): string {
  const normalized = branchName.trim().replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
  return normalized || `wt-${Date.now()}`;
}

function parentDir(repoPath: string): string {
  const idx = Math.max(repoPath.lastIndexOf('/'), repoPath.lastIndexOf('\\'));
  if (idx <= 0) return repoPath;
  return repoPath.slice(0, idx);
}

function joinPath(base: string, child: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${sep}${child.replace(/^[\\/]+/, '')}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function toActionableMessage(message: string): string {
  const normalized = message.trim();
  if (/HTTP[_ ]404|404/.test(normalized)) {
    return `${normalized}. Verify API route/repo path, then retry.`;
  }
  if (/ECONNREFUSED|ENOTFOUND|network/i.test(normalized)) {
    return `${normalized}. Check network connectivity and service availability, then retry.`;
  }
  if (/already exists/i.test(normalized) && /branch/i.test(normalized)) {
    return `${normalized}. Enable "Use existing branch" to open that branch as a new worktree.`;
  }
  return `${normalized}. Check input values and repository state, then retry.`;
}

function getErrorHelpText(message: string): string | null {
  if (/404|HTTP_404/i.test(message)) {
    return 'The requested API path or service route was not found. Verify the endpoint path and that the target service is running.';
  }
  if (/ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
    return 'The app cannot reach the service right now. This usually means the local service is down, blocked, or network is unavailable.';
  }
  if (/dirty_tree/i.test(message) || /uncommitted changes/i.test(message)) {
    return 'Git blocks worktree removal when there are local changes to prevent accidental data loss.';
  }
  if (/already exists/i.test(message) && /branch/i.test(message)) {
    return 'Branch names are unique. If the branch already exists, switch to "Use existing branch" instead of creating a new one.';
  }
  if (/required/i.test(message)) {
    return 'Some required inputs are missing, so the command cannot be generated or executed safely.';
  }
  return 'The current repository state or provided inputs do not satisfy this operation yet.';
}

function shouldHandleModalShortcut(e: KeyboardEvent, modal: HTMLElement): boolean {
  const target = e.target as HTMLElement | null;
  if (!target || !modal.contains(target)) return false;
  const isEditable = Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  if (!isEditable) return true;
  // Keep fast tab switching available even while typing.
  if ((e.metaKey || e.ctrlKey) && (e.key === '1' || e.key === '2')) {
    return true;
  }
  return false;
}

function isImeComposingKeyEvent(e: KeyboardEvent): boolean {
  return e.isComposing || (e as KeyboardEvent).keyCode === 229;
}

function buildReadinessHintTags(readiness: WorktreeMergeReadiness, targetRef: string, branchName: string): string {
  const hints: string[] = [];
  if (readiness.behind > 0) {
    hints.push(
      `<span class="summary-chip summary-chip-warn worktree-hint-chip" title="${escapeHtml(
        `${branchName} is ${readiness.behind} commit(s) behind ${targetRef}. Bring ${targetRef} into ${branchName} via merge/rebase before final merge.`
      )}">Behind reason</span>`
    );
  }
  if (readiness.dirty) {
    hints.push(
      `<span class="summary-chip summary-chip-warn worktree-hint-chip" title="${escapeHtml(
        `${branchName} has local changes: ${readiness.modifiedCount} modified + ${readiness.untrackedCount} untracked file(s). Commit, stash, or clean before merge/remove operations.`
      )}">Dirty reason</span>`
    );
  }
  return hints.join(' ');
}

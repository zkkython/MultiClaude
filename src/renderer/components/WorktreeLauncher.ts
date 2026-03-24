import type { ModelConfig, WorktreeInfo, WorktreeMergeReadiness } from '../../shared/types.js';

interface WorktreeLauncherOptions {
  config: ModelConfig;
  initialRepoPath: string;
  initialTargetRef: string;
  onOpenTerminal: (cwd: string) => void;
  onPersistDefaults: (repoPath: string, targetRef: string) => Promise<void>;
}

type LauncherTab = 'worktree' | 'merge';

export function buildWorktreeLauncherMarkup(configName: string, repoPath: string, targetRef: string): string {
  return `
    <div class="modal-header">
      <h2>Worktree · ${escapeHtml(configName)}</h2>
      <button class="btn btn-icon modal-close-btn">✕</button>
    </div>
    <div class="modal-body">
      <div class="worktree-tabs" role="tablist" aria-label="Worktree actions">
        <button type="button" class="worktree-tab is-active" data-tab="worktree" role="tab" aria-selected="true">Worktree</button>
        <button type="button" class="worktree-tab" data-tab="merge" role="tab" aria-selected="false">Merge</button>
      </div>

      <section class="worktree-panel is-active" data-panel="worktree" role="tabpanel">
        <p class="worktree-step-hint">Step 1 · Select repository.</p>
        <div class="form-group">
          <label>Repository Directory</label>
          <div class="input-with-toggle">
            <input id="wt-repo-path" type="text" value="${escapeHtml(repoPath)}" placeholder="/path/to/repo" />
            <button type="button" class="btn btn-secondary" id="wt-browse">Browse</button>
          </div>
        </div>
        <p class="worktree-step-hint">Step 2 · Create a new worktree, or choose one from the list.</p>
        <div class="form-group">
          <label>Create New Worktree</label>
          <div class="worktree-create-grid">
            <input id="wt-branch-name" type="text" placeholder="wt/task-name" />
            <input id="wt-path-name" type="text" placeholder="worktree directory name" />
            <input id="wt-from-ref" type="text" value="HEAD" placeholder="from ref (default HEAD)" />
            <button type="button" class="btn btn-primary" id="wt-create-open">Create + Open Terminal</button>
          </div>
          <div class="form-help">Default strategy creates a new branch from current HEAD.</div>
        </div>
        <div class="form-group">
          <label>Existing Worktrees</label>
          <div id="wt-list" class="worktree-list">Loading...</div>
          <div class="form-help">Merge readiness compares against: <span id="wt-readiness-target-label">${escapeHtml(targetRef)}</span></div>
        </div>
        <p class="worktree-step-hint">Step 3 · Open terminal and start coding in the selected worktree.</p>
      </section>

      <section class="worktree-panel" data-panel="merge" role="tabpanel" hidden>
        <p class="worktree-step-hint">Step 1 · Choose target branch for readiness and merge.</p>
        <div class="form-group">
          <label>Target Branch For Merge Readiness</label>
          <input id="wt-target-ref" type="text" value="${escapeHtml(targetRef)}" placeholder="main" />
        </div>
        <p class="worktree-step-hint">Step 2 · Choose merge strategy and source ref.</p>
        <div class="form-group">
          <label>Generate Merge Command</label>
          <div class="worktree-create-grid worktree-merge-grid">
            <select id="wt-merge-strategy">
              <option value="merge">merge</option>
              <option value="rebase">rebase</option>
              <option value="squash">squash</option>
            </select>
            <input id="wt-merge-source" type="text" placeholder="source branch (e.g. wt/task-123)" />
            <button type="button" class="btn btn-secondary" id="wt-copy-template">Copy Merge Command</button>
          </div>
          <div class="form-help">Copies a ready-to-run git command chain to your clipboard.</div>
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

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal worktree-launcher';
  modal.innerHTML = buildWorktreeLauncherMarkup(options.config.name, repoPath, targetRef);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const repoInput = modal.querySelector('#wt-repo-path') as HTMLInputElement;
  const targetInput = modal.querySelector('#wt-target-ref') as HTMLInputElement;
  const readinessTargetLabel = modal.querySelector('#wt-readiness-target-label') as HTMLElement;
  const listEl = modal.querySelector('#wt-list') as HTMLElement;
  const branchInput = modal.querySelector('#wt-branch-name') as HTMLInputElement;
  const pathInput = modal.querySelector('#wt-path-name') as HTMLInputElement;
  const fromRefInput = modal.querySelector('#wt-from-ref') as HTMLInputElement;
  const mergeSourceInput = modal.querySelector('#wt-merge-source') as HTMLInputElement;
  const mergeStrategyInput = modal.querySelector('#wt-merge-strategy') as HTMLSelectElement;
  const refreshBtn = modal.querySelector('#wt-refresh') as HTMLButtonElement;
  const tabButtons = Array.from(modal.querySelectorAll('.worktree-tab')) as HTMLButtonElement[];
  const tabPanels = Array.from(modal.querySelectorAll('.worktree-panel')) as HTMLElement[];

  branchInput.value = defaultBranchName();
  pathInput.value = defaultPathName(branchInput.value);

  repoInput.addEventListener('input', () => {
    repoPath = repoInput.value.trim();
  });
  targetInput.addEventListener('input', () => {
    targetRef = targetInput.value.trim() || 'main';
    readinessTargetLabel.textContent = targetRef;
  });
  branchInput.addEventListener('input', () => {
    if (!pathInput.value.trim()) {
      pathInput.value = defaultPathName(branchInput.value);
    }
  });

  modal.querySelector('.modal-close-btn')?.addEventListener('click', close);
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
        alert('Repository path and branch name are required.');
        return;
      }
      const worktreePath = joinPath(parentDir(repoPath), pathName);
      const created = await window.multiclaude.worktree.create({
        repoPath,
        worktreePath,
        branchName,
        fromRef: fromRefInput.value.trim() || 'HEAD',
      });
      await options.onPersistDefaults(repoPath, targetRef);
      options.onOpenTerminal(created.path);
      await refresh();
    } catch (err) {
      alert(`Failed to create worktree: ${formatError(err)}`);
    }
  });
  modal.querySelector('#wt-copy-template')?.addEventListener('click', async () => {
    const source = mergeSourceInput.value.trim();
    const target = targetInput.value.trim();
    if (!source || !target) {
      alert('Source and target refs are required.');
      return;
    }
    try {
      const template = await window.multiclaude.worktree.buildMergeTemplate({
        strategy: mergeStrategyInput.value as 'merge' | 'rebase' | 'squash',
        sourceRef: source,
        targetRef: target,
      });
      await navigator.clipboard.writeText(template.command);
      alert('Merge command copied to clipboard.');
    } catch (err) {
      alert(`Failed to build merge template: ${formatError(err)}`);
    }
  });
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.dataset.tab === 'merge' ? 'merge' : 'worktree');
    });
  });

  function close() {
    overlay.remove();
  }

  async function refresh(): Promise<void> {
    if (!repoPath) {
      listEl.textContent = 'Enter repository directory first.';
      return;
    }
    listEl.textContent = 'Loading...';
    readinessByPath.clear();
    try {
      worktrees = await window.multiclaude.worktree.list(repoPath);
      await options.onPersistDefaults(repoPath, targetRef);
      await Promise.all(worktrees.map(async (item) => {
        try {
          const readiness = await window.multiclaude.worktree.mergeReadiness(item.path, targetRef);
          readinessByPath.set(item.path, readiness);
        } catch {
          readinessByPath.set(item.path, null);
        }
      }));
      renderList();
    } catch (err) {
      listEl.textContent = `Failed to load worktrees: ${formatError(err)}`;
    }
  }

  function renderList(): void {
    if (worktrees.length === 0) {
      listEl.textContent = 'No worktrees found.';
      return;
    }
    listEl.innerHTML = worktrees.map((item) => {
      const readiness = readinessByPath.get(item.path);
      const confidence = readiness ? `${readiness.ahead}↑ ${readiness.behind}↓${readiness.dirty ? ' dirty' : ''}` : 'n/a';
      return `
        <div class="worktree-row" data-worktree-path="${escapeHtml(item.path)}">
          <div class="worktree-meta">
            <div><strong>${escapeHtml(item.branch || '(unknown)')}</strong> ${item.isMain ? '<span class="provider-pill">main</span>' : ''}</div>
            <div class="form-help">${escapeHtml(item.path)}</div>
            <div class="form-help">readiness: ${escapeHtml(confidence)}</div>
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
      openBtn?.addEventListener('click', () => options.onOpenTerminal(worktreePath));
      removeBtn?.addEventListener('click', async () => {
        if (!confirm(`Remove worktree?\n${worktreePath}`)) return;
        try {
          await window.multiclaude.worktree.remove({ repoPath, worktreePath });
          await window.multiclaude.worktree.prune(repoPath);
          await refresh();
        } catch (err) {
          const msg = formatError(err);
          if (msg.includes('dirty_tree')) {
            alert('Cannot remove worktree with uncommitted changes.');
            return;
          }
          alert(`Failed to remove worktree: ${msg}`);
        }
      });
    });
  }

  void refresh();
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

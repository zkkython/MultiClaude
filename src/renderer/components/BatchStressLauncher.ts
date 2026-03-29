import type { ModelConfig } from '../../shared/types.js';
import { setupDialogA11y } from './modal-a11y.js';

export interface BatchStressInput {
  rootDir: string;
  jobName: string;
  count: number;
  subdirPattern: string;
  concurrency: number;
  bootstrapCommand: string;
  sendDelayMs: number;
  enableIsolationCheck: boolean;
  roundsJson: string;
}

export interface BatchStressProgress {
  total: number;
  running: number;
  succeeded: number;
  failed: number;
  pending: number;
}

interface BatchStressHooks {
  log: (line: string) => void;
  progress: (stats: BatchStressProgress) => void;
}

export interface BatchStressRunControls {
  pause: () => void;
  resume: () => void;
  exportReport: () => Promise<string>;
  isPaused: () => boolean;
}

export interface BatchStressRunHandle {
  controls: BatchStressRunControls;
  done: Promise<void>;
}

interface BatchStressLauncherOptions {
  config: ModelConfig;
  initialRootDir: string;
  onBrowseRoot: (defaultPath?: string) => Promise<string | null>;
  onDryRun: (input: BatchStressInput) => string[];
  onRun: (input: BatchStressInput, hooks: BatchStressHooks) => BatchStressRunHandle;
}

export function showBatchStressLauncher(options: BatchStressLauncherOptions): void {
  const oldModal = document.querySelector('.modal-overlay');
  if (oldModal) oldModal.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal batch-stress-launcher';
  modal.innerHTML = `
    <div class="modal-header">
      <h2>Batch Stress · ${escapeHtml(options.config.name)}</h2>
      <button class="btn btn-icon modal-close-btn" aria-label="Close dialog">✕</button>
    </div>
    <div class="modal-body">
      <div class="task-brief task-brief-worktree">
        <strong>Task goal:</strong> create N subdirectories, open N terminals, auto-start Claude, and run multi-round prompts.
        <div class="task-brief-done">Done when all instances complete and summary is stable.</div>
      </div>
      <div class="form-group">
        <label for="bs-root-dir">Root Directory</label>
        <div class="input-with-toggle">
          <input id="bs-root-dir" type="text" value="${escapeHtml(options.initialRootDir)}" placeholder="/path/to/root" />
          <button type="button" class="btn btn-secondary" id="bs-browse">Browse</button>
        </div>
      </div>
      <div class="form-group">
        <label for="bs-job-name">Job Name</label>
        <input id="bs-job-name" type="text" value="stress-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}" />
      </div>
      <div class="batch-stress-grid">
        <div class="form-group">
          <label for="bs-count">Count (N)</label>
          <input id="bs-count" type="number" min="1" max="200" value="5" />
        </div>
        <div class="form-group">
          <label for="bs-concurrency">Concurrency</label>
          <input id="bs-concurrency" type="number" min="1" max="64" value="3" />
        </div>
        <div class="form-group">
          <label for="bs-subdir-pattern">Subdir Pattern</label>
          <input id="bs-subdir-pattern" type="text" value="run-\${index}" />
          <div class="form-help">Supports \${index}, \${configName}.</div>
        </div>
        <div class="form-group">
          <label for="bs-bootstrap">Bootstrap Command</label>
          <input id="bs-bootstrap" type="text" value="claude" />
        </div>
      </div>
      <div class="form-group">
        <label for="bs-send-delay">Send Delay (ms)</label>
        <input id="bs-send-delay" type="number" min="0" max="10000" value="300" />
      </div>
      <div class="form-group">
        <label>
          <input id="bs-isolation-check" type="checkbox" checked />
          Enable multi-instance isolation check (detect foreign marker pollution)
        </label>
      </div>
      <div class="form-group">
        <label for="bs-rounds-json">Conversation Script (JSON rounds)</label>
        <textarea id="bs-rounds-json" rows="10">[
  {
    "id": "r1-seed",
    "prompt": "记住会话指纹 SESSION=\${configName}-\${index}，并回复 ACK \${configName}-\${index}",
    "waitForRegex": "ACK \${configName}-\${index}",
    "timeoutSec": 90
  },
  {
    "id": "r2-probe",
    "prompt": "只回答你记住的 SESSION 值，不要解释",
    "waitForRegex": "\${configName}-\${index}",
    "timeoutSec": 90
  }
]</textarea>
        <div class="form-help">Supports variables: \${index}, \${configName}, \${dir}. 20+ rounds are supported.</div>
      </div>
      <div id="bs-feedback" class="task-feedback" aria-live="polite"></div>
      <div class="batch-stress-progress" id="bs-progress">Pending</div>
      <pre class="worktree-template-preview batch-stress-log" id="bs-log">Ready.</pre>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="bs-dry-run">Dry Run</button>
      <button class="btn btn-primary" id="bs-start">Start Stress</button>
      <button class="btn btn-secondary" id="bs-pause" disabled>Pause</button>
      <button class="btn btn-secondary" id="bs-resume" disabled>Resume</button>
      <button class="btn btn-secondary" id="bs-export" disabled>Export Report</button>
      <button class="btn btn-secondary" id="bs-close">Close</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const teardownDialogA11y = setupDialogA11y({ modal, onEscape: close });

  const rootInput = modal.querySelector('#bs-root-dir') as HTMLInputElement;
  const countInput = modal.querySelector('#bs-count') as HTMLInputElement;
  const jobNameInput = modal.querySelector('#bs-job-name') as HTMLInputElement;
  const concurrencyInput = modal.querySelector('#bs-concurrency') as HTMLInputElement;
  const subdirPatternInput = modal.querySelector('#bs-subdir-pattern') as HTMLInputElement;
  const bootstrapInput = modal.querySelector('#bs-bootstrap') as HTMLInputElement;
  const sendDelayInput = modal.querySelector('#bs-send-delay') as HTMLInputElement;
  const roundsInput = modal.querySelector('#bs-rounds-json') as HTMLTextAreaElement;
  const isolationInput = modal.querySelector('#bs-isolation-check') as HTMLInputElement;
  const feedback = modal.querySelector('#bs-feedback') as HTMLElement;
  const progressEl = modal.querySelector('#bs-progress') as HTMLElement;
  const logEl = modal.querySelector('#bs-log') as HTMLElement;
  const startBtn = modal.querySelector('#bs-start') as HTMLButtonElement;
  const dryRunBtn = modal.querySelector('#bs-dry-run') as HTMLButtonElement;
  const pauseBtn = modal.querySelector('#bs-pause') as HTMLButtonElement;
  const resumeBtn = modal.querySelector('#bs-resume') as HTMLButtonElement;
  const exportBtn = modal.querySelector('#bs-export') as HTMLButtonElement;
  const browseBtn = modal.querySelector('#bs-browse') as HTMLButtonElement;
  const closeBtn = modal.querySelector('#bs-close') as HTMLButtonElement;
  const xBtn = modal.querySelector('.modal-close-btn') as HTMLButtonElement;

  let running = false;
  let controls: BatchStressRunControls | null = null;

  browseBtn.addEventListener('click', async () => {
    const selected = await options.onBrowseRoot(rootInput.value.trim());
    if (selected) rootInput.value = selected;
  });

  dryRunBtn.addEventListener('click', () => {
    const payload = readInput();
    if (!payload) return;
    try {
      const lines = options.onDryRun(payload);
      logEl.textContent = lines.join('\n');
      setFeedback('success', `Dry run generated ${lines.length} command lines.`);
    } catch (err) {
      setFeedback('error', formatError(err));
    }
  });

  startBtn.addEventListener('click', async () => {
    if (running) return;
    const payload = readInput();
    if (!payload) return;
    running = true;
    setEditingEnabled(false);
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
    exportBtn.disabled = true;
    logEl.textContent = 'Starting batch stress job...\n';
    setFeedback('', '');
    progressEl.textContent = 'Preparing...';
    try {
      const handle = options.onRun(payload, {
        log: (line) => {
          logEl.textContent = `${logEl.textContent}${line}\n`;
          logEl.scrollTop = logEl.scrollHeight;
        },
        progress: (stats) => {
          progressEl.textContent = `Total ${stats.total} | Running ${stats.running} | Success ${stats.succeeded} | Failed ${stats.failed} | Pending ${stats.pending}`;
        },
      });
      controls = handle.controls;
      await handle.done;
      setFeedback('success', 'Batch stress job finished.');
      exportBtn.disabled = false;
    } catch (err) {
      setFeedback('error', `Batch stress failed: ${formatError(err)}`);
      exportBtn.disabled = false;
    } finally {
      running = false;
      setEditingEnabled(true);
      pauseBtn.disabled = true;
      resumeBtn.disabled = true;
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (!controls || !running) return;
    controls.pause();
    pauseBtn.disabled = true;
    resumeBtn.disabled = false;
    setFeedback('success', 'Paused. Running instances will block at safe checkpoints.');
  });

  resumeBtn.addEventListener('click', () => {
    if (!controls || !running) return;
    controls.resume();
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
    setFeedback('success', 'Resumed.');
  });

  exportBtn.addEventListener('click', async () => {
    if (!controls) return;
    try {
      const path = await controls.exportReport();
      setFeedback('success', `Report exported: ${path}`);
    } catch (err) {
      setFeedback('error', `Export failed: ${formatError(err)}`);
    }
  });

  closeBtn.addEventListener('click', () => {
    if (running) return;
    close();
  });
  xBtn.addEventListener('click', () => {
    if (running) return;
    close();
  });

  setTimeout(() => rootInput.focus(), 20);

  function close(): void {
    teardownDialogA11y();
    overlay.remove();
  }

  function setEditingEnabled(enabled: boolean): void {
    startBtn.disabled = !enabled;
    dryRunBtn.disabled = !enabled;
    browseBtn.disabled = !enabled;
    closeBtn.disabled = !enabled;
    xBtn.disabled = !enabled;
    rootInput.disabled = !enabled;
    jobNameInput.disabled = !enabled;
    countInput.disabled = !enabled;
    concurrencyInput.disabled = !enabled;
    subdirPatternInput.disabled = !enabled;
    bootstrapInput.disabled = !enabled;
    sendDelayInput.disabled = !enabled;
    roundsInput.disabled = !enabled;
    isolationInput.disabled = !enabled;
  }

  function setFeedback(level: '' | 'success' | 'error', message: string): void {
    feedback.className = 'task-feedback';
    if (level === 'success') feedback.classList.add('is-success');
    if (level === 'error') feedback.classList.add('is-error');
    feedback.textContent = message;
  }

  function readInput(): BatchStressInput | null {
    const rootDir = rootInput.value.trim();
    const count = parseInt(countInput.value, 10);
    const jobName = jobNameInput.value.trim();
    const concurrency = parseInt(concurrencyInput.value, 10);
    const subdirPattern = subdirPatternInput.value.trim();
    const bootstrapCommand = bootstrapInput.value.trim();
    const sendDelayMs = parseInt(sendDelayInput.value, 10);
    const roundsJson = roundsInput.value.trim();
    const enableIsolationCheck = isolationInput.checked;
    if (!rootDir) {
      setFeedback('error', 'Root directory is required.');
      return null;
    }
    if (!Number.isFinite(count) || count < 1 || count > 200) {
      setFeedback('error', 'Count must be between 1 and 200.');
      return null;
    }
    if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 64) {
      setFeedback('error', 'Concurrency must be between 1 and 64.');
      return null;
    }
    if (!subdirPattern) {
      setFeedback('error', 'Subdir pattern is required.');
      return null;
    }
    if (!jobName) {
      setFeedback('error', 'Job name is required.');
      return null;
    }
    if (!bootstrapCommand) {
      setFeedback('error', 'Bootstrap command is required.');
      return null;
    }
    if (!Number.isFinite(sendDelayMs) || sendDelayMs < 0 || sendDelayMs > 10000) {
      setFeedback('error', 'Send delay must be between 0 and 10000 ms.');
      return null;
    }
    try {
      const parsed = JSON.parse(roundsJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Script must be a non-empty JSON array.');
      }
    } catch (err) {
      setFeedback('error', `Conversation script JSON invalid: ${formatError(err)}`);
      return null;
    }
    return {
      rootDir,
      jobName,
      count,
      concurrency,
      subdirPattern,
      bootstrapCommand,
      sendDelayMs,
      enableIsolationCheck,
      roundsJson,
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

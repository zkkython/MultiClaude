import type { ConfigProvider, ModelConfig, ModelConfigCreate, ModelConfigUpdate } from '../../shared/types.js';
import { CONFIG_COLORS, DEFAULTS } from '../../shared/constants.js';

export type ConfigEditorResult = ModelConfigCreate | ModelConfigUpdate;

export function showConfigEditor(
  existing: ModelConfig | null,
  onSave: (result: ConfigEditorResult) => void,
  onCancel: () => void,
): void {
  const oldModal = document.querySelector('.modal-overlay');
  if (oldModal) oldModal.remove();

  const isEdit = existing !== null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal config-editor';

  const defaultColor = CONFIG_COLORS[Math.floor(Math.random() * CONFIG_COLORS.length)];
  const currentProvider: ConfigProvider = existing?.provider || 'claude';
  const defaultCodexHome = slugify(existing?.name || '');
  const initialCodexProvider = existing?.codexModelProvider || 'openai';

  modal.innerHTML = `
    <div class="modal-header">
      <h2>${isEdit ? 'Edit Config' : 'New Config'}</h2>
      <button class="btn btn-icon modal-close-btn">✕</button>
    </div>
    <div class="modal-body">
      <form id="config-form">
        <div class="form-group">
          <label for="cfg-name">Name <span class="required">*</span></label>
          <input type="text" id="cfg-name" value="${escapeAttr(existing?.name || '')}" placeholder="e.g. Team Proxy Profile" required />
        </div>
        <div class="form-group">
          <label>Provider</label>
          <div class="provider-segment" id="cfg-provider">
            <button type="button" class="provider-option ${currentProvider === 'claude' ? 'active' : ''}" data-provider="claude">Claude</button>
            <button type="button" class="provider-option ${currentProvider === 'codex' ? 'active' : ''}" data-provider="codex">Codex</button>
          </div>
        </div>
        <div class="form-group">
          <label>Color</label>
          <div class="color-picker">
            ${CONFIG_COLORS.map(c => `
              <button type="button" class="color-swatch ${c === (existing?.color || defaultColor) ? 'selected' : ''}" data-color="${c}" style="background: ${c}"></button>
            `).join('')}
            <input type="color" id="cfg-color-custom" value="${existing?.color || defaultColor}" class="color-custom" title="Custom color" />
          </div>
        </div>

        <div class="provider-fields ${currentProvider === 'claude' ? '' : 'hidden'}" data-provider-fields="claude">
          <div class="form-group">
            <label for="cfg-anthropic-model">Model <span class="required">*</span></label>
            <input type="text" id="cfg-anthropic-model" value="${escapeAttr(existing?.anthropicModel || '')}" placeholder="e.g. claude-opus-4-6" />
          </div>
          <div class="form-group">
            <label for="cfg-anthropic-base-url">Base URL</label>
            <input type="text" id="cfg-anthropic-base-url" value="${escapeAttr(existing?.anthropicBaseUrl || '')}" placeholder="e.g. https://api.anthropic.com" />
          </div>
          <div class="form-group">
            <label for="cfg-anthropic-token">Auth Token</label>
            <div class="input-with-toggle">
              <input type="password" id="cfg-anthropic-token" value="${escapeAttr(existing?.anthropicAuthToken || '')}" placeholder="sk-ant-..." />
              <button type="button" class="btn btn-icon toggle-visibility" data-target="cfg-anthropic-token" title="Show/hide">👁</button>
            </div>
          </div>
          <div class="form-group">
            <label for="cfg-anthropic-small-model">Small/Fast Model</label>
            <input type="text" id="cfg-anthropic-small-model" value="${escapeAttr(existing?.anthropicSmallFastModel || '')}" placeholder="e.g. claude-haiku-4" />
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="cfg-disable-traffic" ${existing?.disableNonessentialTraffic ? 'checked' : ''} />
              Disable non-essential traffic
            </label>
          </div>
        </div>

        <div class="provider-fields ${currentProvider === 'codex' ? '' : 'hidden'}" data-provider-fields="codex">
          <div class="form-group">
            <label for="cfg-openai-model">Model <span class="required">*</span></label>
            <input type="text" id="cfg-openai-model" value="${escapeAttr(existing?.openaiModel || '')}" placeholder="e.g. gpt-5-codex" />
          </div>
          <div class="form-group">
            <label for="cfg-openai-base-url">Base URL</label>
            <input type="text" id="cfg-openai-base-url" value="${escapeAttr(existing?.openaiBaseUrl || 'https://api.openai.com/v1')}" placeholder="e.g. https://api.openai.com/v1" />
          </div>
          <div class="form-group">
            <label for="cfg-openai-key">API Key</label>
            <div class="input-with-toggle">
              <input type="password" id="cfg-openai-key" value="${escapeAttr(existing?.openaiApiKey || '')}" placeholder="sk-..." />
              <button type="button" class="btn btn-icon toggle-visibility" data-target="cfg-openai-key" title="Show/hide">👁</button>
            </div>
          </div>
          <div class="form-group">
            <label for="cfg-codex-provider">Model Provider</label>
            <input type="text" id="cfg-codex-provider" value="${escapeAttr(initialCodexProvider)}" placeholder="e.g. openai / zenmux" />
          </div>
          <div class="form-group">
            <label for="cfg-codex-personality">Personality</label>
            <input type="text" id="cfg-codex-personality" value="${escapeAttr(existing?.codexPersonality || 'pragmatic')}" placeholder="e.g. pragmatic" />
          </div>
          <div class="form-group">
            <label for="cfg-codex-reasoning-effort">Reasoning Effort</label>
            <select id="cfg-codex-reasoning-effort">
              <option value="low" ${(existing?.codexModelReasoningEffort || 'medium') === 'low' ? 'selected' : ''}>low</option>
              <option value="medium" ${(existing?.codexModelReasoningEffort || 'medium') === 'medium' ? 'selected' : ''}>medium</option>
              <option value="high" ${(existing?.codexModelReasoningEffort || 'medium') === 'high' ? 'selected' : ''}>high</option>
            </select>
          </div>
          <div class="form-group">
            <label for="cfg-codex-home-name">Isolated Home Name</label>
            <input type="text" id="cfg-codex-home-name" value="${escapeAttr(existing?.codexHomeName || defaultCodexHome)}" placeholder="e.g. codex-profile-a" />
            <div class="form-help" id="cfg-codex-home-preview"></div>
          </div>
        </div>

        <div class="form-group">
          <label for="cfg-timeout">API Timeout (ms)</label>
          <input type="number" id="cfg-timeout" value="${existing?.apiTimeoutMs ?? DEFAULTS.API_TIMEOUT_MS}" min="1000" step="1000" />
        </div>

        <div class="form-group">
          <label>Protocol Runner</label>
          <div class="form-help">Configure structured protocol transport. Leave as PTY to keep terminal-only mode.</div>
          <div class="protocol-grid">
            <div class="form-group">
              <label for="cfg-protocol-transport">Transport</label>
              <select id="cfg-protocol-transport">
                <option value="pty" ${((existing?.customEnvVars?.MC_PROTOCOL_TRANSPORT || 'pty').toLowerCase() === 'pty') ? 'selected' : ''}>pty</option>
                <option value="http_sse" ${((existing?.customEnvVars?.MC_PROTOCOL_TRANSPORT || '').toLowerCase() === 'http_sse') ? 'selected' : ''}>http_sse</option>
              </select>
            </div>
            <div class="form-group">
              <label for="cfg-protocol-stream-url">Stream URL</label>
              <input type="text" id="cfg-protocol-stream-url" value="${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_STREAM_URL || '')}" placeholder="optional override" />
            </div>
            <div class="form-group">
              <label for="cfg-protocol-input-url">Input URL</label>
              <input type="text" id="cfg-protocol-input-url" value="${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_INPUT_URL || '')}" placeholder="optional override" />
            </div>
            <div class="form-group">
              <label for="cfg-protocol-interrupt-url">Interrupt URL</label>
              <input type="text" id="cfg-protocol-interrupt-url" value="${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_INTERRUPT_URL || '')}" placeholder="optional override" />
            </div>
            <div class="form-group">
              <label for="cfg-protocol-stop-url">Stop URL</label>
              <input type="text" id="cfg-protocol-stop-url" value="${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_STOP_URL || '')}" placeholder="optional override" />
            </div>
            <div class="form-group">
              <label for="cfg-protocol-auth-header">Auth Header</label>
              <input type="text" id="cfg-protocol-auth-header" value="${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_AUTH_HEADER || '')}" placeholder="e.g. Authorization" />
            </div>
            <div class="form-group">
              <label for="cfg-protocol-auth-token">Auth Token</label>
              <div class="input-with-toggle">
                <input type="password" id="cfg-protocol-auth-token" value="${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_AUTH_TOKEN || '')}" placeholder="token" />
                <button type="button" class="btn btn-icon toggle-visibility" data-target="cfg-protocol-auth-token" title="Show/hide">👁</button>
              </div>
            </div>
            <div class="form-group">
              <label for="cfg-protocol-reconnect-max">Reconnect Max</label>
              <input type="number" id="cfg-protocol-reconnect-max" value="${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_RECONNECT_MAX || '')}" min="1" step="1" placeholder="default 6" />
            </div>
            <div class="form-group">
              <label for="cfg-protocol-reconnect-base-ms">Reconnect Base (ms)</label>
              <input type="number" id="cfg-protocol-reconnect-base-ms" value="${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_RECONNECT_BASE_MS || '')}" min="100" step="100" placeholder="default 500" />
            </div>
            <div class="form-group">
              <label for="cfg-waiting-detection-mode">Waiting Detection</label>
              <select id="cfg-waiting-detection-mode">
                <option value="" ${(existing?.customEnvVars?.MC_WAITING_DETECTION_MODE || '') === '' ? 'selected' : ''}>auto (protocol=strict)</option>
                <option value="strict" ${(existing?.customEnvVars?.MC_WAITING_DETECTION_MODE || '') === 'strict' ? 'selected' : ''}>strict (accurate, structured only)</option>
                <option value="heuristic" ${(existing?.customEnvVars?.MC_WAITING_DETECTION_MODE || '') === 'heuristic' ? 'selected' : ''}>heuristic (text guess)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="cfg-protocol-headers-json">Headers JSON</label>
              <textarea id="cfg-protocol-headers-json" rows="3" placeholder='{"x-foo":"bar"}'>${escapeAttr(existing?.customEnvVars?.MC_PROTOCOL_HEADERS_JSON || '')}</textarea>
            </div>
          </div>
          <div class="protocol-actions">
            <button type="button" class="btn btn-sm" id="cfg-protocol-test">Test Connectivity</button>
            <span class="form-help" id="cfg-protocol-test-status"></span>
          </div>
          <pre class="protocol-test-output hidden" id="cfg-protocol-test-output"></pre>
        </div>

        <div class="form-group">
          <label>Custom Environment Variables</label>
          <div class="form-help">Provider fields override custom variables with the same key.</div>
          <div id="custom-env-vars">
            ${renderCustomEnvVars(existing?.customEnvVars || {})}
          </div>
          <button type="button" class="btn btn-sm" id="add-env-var">+ Add Variable</button>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="config-cancel">Cancel</button>
      <button class="btn btn-primary" id="config-save">${isEdit ? 'Save' : 'Create'}</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let selectedColor = existing?.color || defaultColor;
  let selectedProvider: ConfigProvider = currentProvider;

  const providerButtons = Array.from(modal.querySelectorAll('.provider-option')) as HTMLButtonElement[];
  providerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedProvider = btn.dataset.provider as ConfigProvider;
      providerButtons.forEach(b => b.classList.toggle('active', b === btn));
      modal.querySelectorAll('[data-provider-fields]').forEach((section) => {
        const isTarget = (section as HTMLElement).dataset.providerFields === selectedProvider;
        section.classList.toggle('hidden', !isTarget);
      });
    });
  });

  modal.querySelector('.modal-close-btn')!.addEventListener('click', () => {
    cleanup();
    onCancel();
  });
  modal.querySelector('#config-cancel')!.addEventListener('click', () => {
    cleanup();
    onCancel();
  });

  modal.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      modal.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = (swatch as HTMLElement).dataset.color!;
      (modal.querySelector('#cfg-color-custom') as HTMLInputElement).value = selectedColor;
    });
  });

  const customColorInput = modal.querySelector('#cfg-color-custom') as HTMLInputElement;
  customColorInput.addEventListener('input', () => {
    selectedColor = customColorInput.value;
    modal.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  });

  modal.querySelectorAll('.toggle-visibility').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = (btn as HTMLElement).dataset.target!;
      const input = modal.querySelector(`#${targetId}`) as HTMLInputElement;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  modal.querySelector('#add-env-var')!.addEventListener('click', () => {
    const container = modal.querySelector('#custom-env-vars')!;
    const row = document.createElement('div');
    row.className = 'env-var-row';
    row.innerHTML = `
      <input type="text" class="env-key" placeholder="KEY" />
      <span class="env-eq">=</span>
      <input type="text" class="env-value" placeholder="value" />
      <button type="button" class="btn btn-icon btn-sm btn-danger env-remove">✕</button>
    `;
    container.appendChild(row);
    row.querySelector('.env-remove')!.addEventListener('click', () => row.remove());
  });
  modal.querySelectorAll('.env-remove').forEach(btn => {
    btn.addEventListener('click', () => (btn as HTMLElement).closest('.env-var-row')!.remove());
  });

  const nameInput = modal.querySelector('#cfg-name') as HTMLInputElement;
  const codexHomeNameInput = modal.querySelector('#cfg-codex-home-name') as HTMLInputElement;
  const codexHomePreview = modal.querySelector('#cfg-codex-home-preview') as HTMLElement;
  const codexProviderInput = modal.querySelector('#cfg-codex-provider') as HTMLInputElement;
  const protocolTestButton = modal.querySelector('#cfg-protocol-test') as HTMLButtonElement;
  const protocolTestStatus = modal.querySelector('#cfg-protocol-test-status') as HTMLElement;
  const protocolTestOutput = modal.querySelector('#cfg-protocol-test-output') as HTMLElement;
  const refreshCodexHomePreview = () => {
    const value = codexHomeNameInput.value.trim() || slugify(nameInput.value) || 'profile';
    codexHomePreview.textContent = `CODEX_HOME preview: codex-homes/${slugify(value)}`;
  };
  nameInput.addEventListener('input', () => {
    if (!codexHomeNameInput.value.trim()) {
      codexHomeNameInput.value = slugify(nameInput.value);
    }
    refreshCodexHomePreview();
  });
  codexHomeNameInput.addEventListener('input', refreshCodexHomePreview);
  refreshCodexHomePreview();

  protocolTestButton.addEventListener('click', async () => {
    protocolTestButton.disabled = true;
    protocolTestStatus.textContent = 'Testing...';
    protocolTestOutput.classList.add('hidden');
    protocolTestOutput.textContent = '';

    const draftCustomEnv = collectCustomEnvVars(modal);
    applyProtocolEnvOverrides(draftCustomEnv, modal);
    try {
      const result = await window.multiclaude.protocol.testConnectivity({
        provider: selectedProvider,
        anthropicBaseUrl: (modal.querySelector('#cfg-anthropic-base-url') as HTMLInputElement).value.trim(),
        anthropicAuthToken: (modal.querySelector('#cfg-anthropic-token') as HTMLInputElement).value.trim(),
        openaiBaseUrl: (modal.querySelector('#cfg-openai-base-url') as HTMLInputElement).value.trim(),
        openaiApiKey: (modal.querySelector('#cfg-openai-key') as HTMLInputElement).value.trim(),
        customEnvVars: draftCustomEnv,
      });
      protocolTestStatus.textContent = result.summary;
      protocolTestStatus.classList.toggle('text-success', result.ok);
      protocolTestStatus.classList.toggle('text-danger', !result.ok);
      protocolTestOutput.classList.remove('hidden');
      protocolTestOutput.textContent = result.details
        .map(item => `${item.ok ? 'OK' : 'FAIL'} ${item.name}${item.status ? ` (${item.status})` : ''}${item.url ? ` ${item.url}` : ''} - ${item.message}`)
        .join('\n');
    } catch (err) {
      protocolTestStatus.textContent = `Test failed: ${formatError(err)}`;
      protocolTestStatus.classList.remove('text-success');
      protocolTestStatus.classList.add('text-danger');
      protocolTestOutput.classList.remove('hidden');
      protocolTestOutput.textContent = formatError(err);
    } finally {
      protocolTestButton.disabled = false;
    }
  });

  modal.querySelector('#config-save')!.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const claudeModelInput = modal.querySelector('#cfg-anthropic-model') as HTMLInputElement;
    const codexModelInput = modal.querySelector('#cfg-openai-model') as HTMLInputElement;
    const model = selectedProvider === 'claude' ? claudeModelInput.value.trim() : codexModelInput.value.trim();

    nameInput.classList.remove('input-error');
    claudeModelInput.classList.remove('input-error');
    codexModelInput.classList.remove('input-error');

    if (!name || !model) {
      if (!name) nameInput.classList.add('input-error');
      if (!model) {
        if (selectedProvider === 'claude') claudeModelInput.classList.add('input-error');
        else codexModelInput.classList.add('input-error');
      }
      return;
    }

    const customEnvVars = collectCustomEnvVars(modal);
    applyProtocolEnvOverrides(customEnvVars, modal);

    const data: any = {
      name,
      color: selectedColor,
      provider: selectedProvider,
      anthropicModel: claudeModelInput.value.trim(),
      anthropicBaseUrl: (modal.querySelector('#cfg-anthropic-base-url') as HTMLInputElement).value.trim(),
      anthropicAuthToken: (modal.querySelector('#cfg-anthropic-token') as HTMLInputElement).value.trim(),
      anthropicSmallFastModel: (modal.querySelector('#cfg-anthropic-small-model') as HTMLInputElement).value.trim(),
      disableNonessentialTraffic: (modal.querySelector('#cfg-disable-traffic') as HTMLInputElement).checked,
      openaiModel: codexModelInput.value.trim(),
      openaiBaseUrl: (modal.querySelector('#cfg-openai-base-url') as HTMLInputElement).value.trim(),
      openaiApiKey: (modal.querySelector('#cfg-openai-key') as HTMLInputElement).value.trim(),
      codexModelProvider: codexProviderInput.value.trim(),
      codexApiKeyEnvKey: deriveCodexApiKeyEnvKey(codexProviderInput.value.trim()),
      codexWireApi: 'responses',
      codexPersonality: (modal.querySelector('#cfg-codex-personality') as HTMLInputElement).value.trim(),
      codexModelReasoningEffort: (modal.querySelector('#cfg-codex-reasoning-effort') as HTMLSelectElement).value,
      codexHomeMode: 'isolated',
      codexHomeName: (modal.querySelector('#cfg-codex-home-name') as HTMLInputElement).value.trim(),
      apiTimeoutMs: parseInt((modal.querySelector('#cfg-timeout') as HTMLInputElement).value, 10) || DEFAULTS.API_TIMEOUT_MS,
      customEnvVars,
      sortOrder: existing?.sortOrder ?? 0,
    };

    if (isEdit) data.id = existing!.id;
    cleanup();
    onSave(data);
  });

  setTimeout(() => nameInput.focus(), 50);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      cleanup();
      onCancel();
    }
  }
  document.addEventListener('keydown', handleKeydown);

  function cleanup() {
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
  }
}

function renderCustomEnvVars(vars: Record<string, string>): string {
  return Object.entries(vars).map(([key, value]) => `
    <div class="env-var-row">
      <input type="text" class="env-key" value="${escapeAttr(key)}" placeholder="KEY" />
      <span class="env-eq">=</span>
      <input type="text" class="env-value" value="${escapeAttr(value)}" placeholder="value" />
      <button type="button" class="btn btn-icon btn-sm btn-danger env-remove">✕</button>
    </div>
  `).join('');
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function deriveCodexApiKeyEnvKey(provider: string): string {
  const normalizedProvider = slugify(provider).replace(/-/g, '_').toUpperCase();
  if (!normalizedProvider || normalizedProvider === 'OPENAI') {
    return 'OPENAI_API_KEY';
  }
  return `${normalizedProvider}_OPENAI_API_KEY`;
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function collectCustomEnvVars(modal: HTMLElement): Record<string, string> {
  const customEnvVars: Record<string, string> = {};
  modal.querySelectorAll('.env-var-row').forEach(row => {
    const key = (row.querySelector('.env-key') as HTMLInputElement).value.trim();
    const value = (row.querySelector('.env-value') as HTMLInputElement).value;
    if (key) customEnvVars[key] = value;
  });
  return customEnvVars;
}

function applyProtocolEnvOverrides(customEnvVars: Record<string, string>, modal: HTMLElement): void {
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_TRANSPORT', valueOf(modal, '#cfg-protocol-transport'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_STREAM_URL', valueOf(modal, '#cfg-protocol-stream-url'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_INPUT_URL', valueOf(modal, '#cfg-protocol-input-url'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_INTERRUPT_URL', valueOf(modal, '#cfg-protocol-interrupt-url'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_STOP_URL', valueOf(modal, '#cfg-protocol-stop-url'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_AUTH_HEADER', valueOf(modal, '#cfg-protocol-auth-header'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_AUTH_TOKEN', valueOf(modal, '#cfg-protocol-auth-token'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_RECONNECT_MAX', valueOf(modal, '#cfg-protocol-reconnect-max'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_RECONNECT_BASE_MS', valueOf(modal, '#cfg-protocol-reconnect-base-ms'));
  setOrDeleteEnv(customEnvVars, 'MC_WAITING_DETECTION_MODE', valueOf(modal, '#cfg-waiting-detection-mode'));
  setOrDeleteEnv(customEnvVars, 'MC_PROTOCOL_HEADERS_JSON', valueOf(modal, '#cfg-protocol-headers-json'));
}

function valueOf(modal: HTMLElement, selector: string): string {
  const node = modal.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  return node ? node.value.trim() : '';
}

function setOrDeleteEnv(target: Record<string, string>, key: string, value: string): void {
  if (value) {
    target[key] = value;
  } else {
    delete target[key];
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

import type { ModelConfig, ModelConfigCreate, ModelConfigUpdate } from '../../shared/types.js';
import { CONFIG_COLORS, DEFAULTS } from '../../shared/constants.js';

export type ConfigEditorResult = ModelConfigCreate | ModelConfigUpdate;

export function showConfigEditor(
  existing: ModelConfig | null,
  onSave: (result: ConfigEditorResult) => void,
  onCancel: () => void,
): void {
  // Remove any existing modal
  const oldModal = document.querySelector('.modal-overlay');
  if (oldModal) oldModal.remove();

  const isEdit = existing !== null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal config-editor';

  const defaultColor = CONFIG_COLORS[Math.floor(Math.random() * CONFIG_COLORS.length)];

  modal.innerHTML = `
    <div class="modal-header">
      <h2>${isEdit ? 'Edit Config' : 'New Config'}</h2>
      <button class="btn btn-icon modal-close-btn">✕</button>
    </div>
    <div class="modal-body">
      <form id="config-form">
        <div class="form-group">
          <label for="cfg-name">Name <span class="required">*</span></label>
          <input type="text" id="cfg-name" value="${escapeAttr(existing?.name || '')}" placeholder="e.g. Opus 4.6 via Proxy" required />
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
        <div class="form-group">
          <label for="cfg-model">Model <span class="required">*</span></label>
          <input type="text" id="cfg-model" value="${escapeAttr(existing?.anthropicModel || '')}" placeholder="e.g. claude-opus-4-6" required />
        </div>
        <div class="form-group">
          <label for="cfg-base-url">Base URL</label>
          <input type="text" id="cfg-base-url" value="${escapeAttr(existing?.anthropicBaseUrl || '')}" placeholder="e.g. https://api.anthropic.com" />
        </div>
        <div class="form-group">
          <label for="cfg-auth-token">Auth Token</label>
          <div class="input-with-toggle">
            <input type="password" id="cfg-auth-token" value="${escapeAttr(existing?.anthropicAuthToken || '')}" placeholder="sk-ant-..." />
            <button type="button" class="btn btn-icon toggle-visibility" title="Show/hide">👁</button>
          </div>
        </div>
        <div class="form-group">
          <label for="cfg-small-model">Small/Fast Model</label>
          <input type="text" id="cfg-small-model" value="${escapeAttr(existing?.anthropicSmallFastModel || '')}" placeholder="e.g. claude-haiku-4" />
        </div>
        <div class="form-group">
          <label for="cfg-timeout">API Timeout (ms)</label>
          <input type="number" id="cfg-timeout" value="${existing?.apiTimeoutMs ?? DEFAULTS.API_TIMEOUT_MS}" min="1000" step="1000" />
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="cfg-disable-traffic" ${existing?.disableNonessentialTraffic ? 'checked' : ''} />
            Disable non-essential traffic
          </label>
        </div>
        <div class="form-group">
          <label>Custom Environment Variables</label>
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

  // Selected color tracking
  let selectedColor = existing?.color || defaultColor;

  // Bind events
  modal.querySelector('.modal-close-btn')!.addEventListener('click', () => {
    cleanup();
    onCancel();
  });

  modal.querySelector('#config-cancel')!.addEventListener('click', () => {
    cleanup();
    onCancel();
  });

  // Color swatches
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

  // Toggle token visibility
  modal.querySelector('.toggle-visibility')!.addEventListener('click', () => {
    const input = modal.querySelector('#cfg-auth-token') as HTMLInputElement;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Add env var
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

  // Bind remove for existing rows
  modal.querySelectorAll('.env-remove').forEach(btn => {
    btn.addEventListener('click', () => (btn as HTMLElement).closest('.env-var-row')!.remove());
  });

  // Save
  modal.querySelector('#config-save')!.addEventListener('click', () => {
    const name = (modal.querySelector('#cfg-name') as HTMLInputElement).value.trim();
    const model = (modal.querySelector('#cfg-model') as HTMLInputElement).value.trim();

    if (!name || !model) {
      // Highlight required fields
      if (!name) (modal.querySelector('#cfg-name') as HTMLElement).classList.add('input-error');
      if (!model) (modal.querySelector('#cfg-model') as HTMLElement).classList.add('input-error');
      return;
    }

    // Collect custom env vars
    const customEnvVars: Record<string, string> = {};
    modal.querySelectorAll('.env-var-row').forEach(row => {
      const key = (row.querySelector('.env-key') as HTMLInputElement).value.trim();
      const value = (row.querySelector('.env-value') as HTMLInputElement).value;
      if (key) {
        customEnvVars[key] = value;
      }
    });

    const data: any = {
      name,
      color: selectedColor,
      anthropicModel: model,
      anthropicBaseUrl: (modal.querySelector('#cfg-base-url') as HTMLInputElement).value.trim(),
      anthropicAuthToken: (modal.querySelector('#cfg-auth-token') as HTMLInputElement).value.trim(),
      anthropicSmallFastModel: (modal.querySelector('#cfg-small-model') as HTMLInputElement).value.trim(),
      apiTimeoutMs: parseInt((modal.querySelector('#cfg-timeout') as HTMLInputElement).value) || DEFAULTS.API_TIMEOUT_MS,
      disableNonessentialTraffic: (modal.querySelector('#cfg-disable-traffic') as HTMLInputElement).checked,
      customEnvVars,
      sortOrder: existing?.sortOrder ?? 0,
    };

    if (isEdit) {
      data.id = existing!.id;
    }

    cleanup();
    onSave(data);
  });

  // Focus name field
  setTimeout(() => {
    (modal.querySelector('#cfg-name') as HTMLInputElement).focus();
  }, 50);

  // Escape to close
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

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

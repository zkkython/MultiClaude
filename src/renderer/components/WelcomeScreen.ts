export function createWelcomeScreen(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'welcome-screen';
  container.innerHTML = buildWelcomeScreenMarkup();
  return container;
}

export function buildWelcomeScreenMarkup(): string {
  return `
    <div class="welcome-content">
      <div class="welcome-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <path d="M13 2L4 14h7l-1 8 10-13h-7l0-7z"></path>
        </svg>
      </div>
      <h1>MultiClaude</h1>
      <p>Run Claude and Codex configurations in isolated parallel terminals.</p>
      <p class="welcome-subtitle">Define provider configs with different endpoints, keys, and models,<br>then launch terminals with the correct environment variables.</p>
      <button class="btn btn-primary welcome-btn" id="welcome-create-btn">Create Your First Config</button>
    </div>
  `;
}

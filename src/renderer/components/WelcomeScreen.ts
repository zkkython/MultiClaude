export function createWelcomeScreen(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'welcome-screen';
  container.innerHTML = buildWelcomeScreenMarkup();
  return container;
}

export function buildWelcomeScreenMarkup(): string {
  return `
    <div class="welcome-content">
      <div class="welcome-icon">⚡</div>
      <h1>MultiClaude</h1>
      <p>Run Claude and Codex configurations in isolated parallel terminals.</p>
      <p class="welcome-subtitle">Define provider configs with different endpoints, keys, and models,<br>then launch terminals with the correct environment variables.</p>
      <button class="btn btn-primary welcome-btn" id="welcome-create-btn">Create Your First Config</button>
    </div>
  `;
}

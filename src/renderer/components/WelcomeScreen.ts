export function createWelcomeScreen(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'welcome-screen';
  container.innerHTML = `
    <div class="welcome-content">
      <div class="welcome-icon">⚡</div>
      <h1>MultiClaude</h1>
      <p>Run multiple Claude Code configurations in parallel terminals.</p>
      <p class="welcome-subtitle">Define model configs with different API endpoints, tokens, and models,<br>then launch terminals with the correct environment variables.</p>
      <button class="btn btn-primary welcome-btn" id="welcome-create-btn">Create Your First Config</button>
    </div>
  `;
  return container;
}

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');

// Shared esbuild options
const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
};

async function build() {
  const mainDistDir = path.resolve(__dirname, '../dist/main');
  const preloadDistDir = path.resolve(__dirname, '../dist/preload');
  const hooksDistDir = path.resolve(__dirname, '../dist/hooks');

  // Patch Electron.app display name to "MultiClaude" for dev mode
  patchElectronAppName();

  // Main process
  const mainContext = await esbuild.context({
    ...commonOptions,
    entryPoints: [path.resolve(__dirname, '../src/main/index.ts')],
    outdir: mainDistDir,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node-pty'],
    tsconfig: path.resolve(__dirname, '../tsconfig.json'),
  });

  // Preload
  const preloadContext = await esbuild.context({
    ...commonOptions,
    entryPoints: [path.resolve(__dirname, '../src/preload/index.ts')],
    outdir: preloadDistDir,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    tsconfig: path.resolve(__dirname, '../tsconfig.json'),
  });

  // Renderer
  const rendererContext = await esbuild.context({
    ...commonOptions,
    entryPoints: [path.resolve(__dirname, '../src/renderer/index.ts')],
    outdir: path.resolve(__dirname, '../dist/renderer'),
    platform: 'browser',
    format: 'iife',
    tsconfig: path.resolve(__dirname, '../tsconfig.json'),
  });

  // Copy static files
  const rendererSrcDir = path.resolve(__dirname, '../src/renderer');
  const rendererDistDir = path.resolve(__dirname, '../dist/renderer');

  // Ensure dist/renderer exists
  fs.mkdirSync(rendererDistDir, { recursive: true });
  fs.mkdirSync(path.join(rendererDistDir, 'styles'), { recursive: true });

  // Copy HTML
  fs.copyFileSync(
    path.join(rendererSrcDir, 'index.html'),
    path.join(rendererDistDir, 'index.html')
  );

  // Copy CSS
  fs.copyFileSync(
    path.join(rendererSrcDir, 'styles', 'main.css'),
    path.join(rendererDistDir, 'styles', 'main.css')
  );

  // Copy xterm CSS from node_modules
  const xtermCssPath = path.resolve(__dirname, '../node_modules/@xterm/xterm/css/xterm.css');
  if (fs.existsSync(xtermCssPath)) {
    fs.copyFileSync(xtermCssPath, path.join(rendererDistDir, 'styles', 'xterm.css'));
  }

  // Copy Claude hook bridge script for packaged/runtime hook installation.
  fs.mkdirSync(hooksDistDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '../scripts/hooks/claude-runner-sidechannel.js'),
    path.join(hooksDistDir, 'claude-runner-sidechannel.js')
  );

  if (isWatch) {
    await mainContext.watch();
    await preloadContext.watch();
    await rendererContext.watch();
    console.log('Watching for changes...');

    // Watch static files too
    const chokidar = (() => {
      try { return require('chokidar'); } catch { return null; }
    })();

    if (chokidar) {
      chokidar.watch([
        path.join(rendererSrcDir, 'index.html'),
        path.join(rendererSrcDir, 'styles', '*.css'),
      ]).on('change', (filePath) => {
        console.log(`Static file changed: ${filePath}`);
        const basename = path.basename(filePath);
        if (basename === 'index.html') {
          fs.copyFileSync(filePath, path.join(rendererDistDir, 'index.html'));
        } else if (basename.endsWith('.css')) {
          fs.copyFileSync(filePath, path.join(rendererDistDir, 'styles', basename));
        }
      });
    }
  } else {
    await mainContext.rebuild();
    await preloadContext.rebuild();
    await rendererContext.rebuild();
    await mainContext.dispose();
    await preloadContext.dispose();
    await rendererContext.dispose();
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Patch the Electron.app Info.plist so macOS shows "MultiClaude" instead of
// "Electron" in the menu bar, Dock, and About dialog during development.
function patchElectronAppName() {
  const { execSync } = require('child_process');
  const glob = require('path');

  // Find the Electron.app Info.plist
  const electronDir = path.resolve(__dirname, '../node_modules');
  let plistPath = null;

  // Walk through possible pnpm / npm paths
  const candidates = [
    path.resolve(electronDir, 'electron/dist/Electron.app/Contents/Info.plist'),
    path.resolve(electronDir, '.pnpm/electron@*/node_modules/electron/dist/Electron.app/Contents/Info.plist'),
  ];

  // For pnpm glob, resolve manually
  try {
    const pnpmDir = path.resolve(electronDir, '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      const entries = fs.readdirSync(pnpmDir).filter(e => e.startsWith('electron@'));
      for (const entry of entries) {
        const candidate = path.join(pnpmDir, entry, 'node_modules/electron/dist/Electron.app/Contents/Info.plist');
        if (fs.existsSync(candidate)) {
          plistPath = candidate;
          break;
        }
      }
    }
  } catch {}

  if (!plistPath) {
    // Try direct node_modules/electron (npm/yarn)
    const direct = candidates[0];
    if (fs.existsSync(direct)) plistPath = direct;
  }

  if (!plistPath) {
    console.log('Note: Could not find Electron.app Info.plist to patch app name.');
    return;
  }

  try {
    const currentName = execSync(
      `/usr/libexec/PlistBuddy -c "Print CFBundleDisplayName" "${plistPath}" 2>/dev/null || echo ""`,
      { encoding: 'utf-8' }
    ).trim();

    if (currentName === 'MultiClaude') return; // Already patched

    execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName MultiClaude" "${plistPath}" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string MultiClaude" "${plistPath}"`);
    execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName MultiClaude" "${plistPath}"`);
    console.log('Patched Electron.app name to "MultiClaude".');
  } catch (err) {
    console.log('Note: Could not patch Electron.app name:', err.message);
  }
}

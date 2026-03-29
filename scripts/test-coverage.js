const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { spawnSync } = require('child_process');

function walkTsFiles(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(fullPath, acc);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.ts')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function toCompiledTestPath(srcRoot, outRoot, sourcePath) {
  const relative = path.relative(srcRoot, sourcePath).replace(/\.ts$/, '.js');
  return path.join(outRoot, relative);
}

function transpileTsFile(sourceFilePath, srcRoot, outRoot) {
  const sourceText = fs.readFileSync(sourceFilePath, 'utf8');
  const relative = path.relative(srcRoot, sourceFilePath);
  const jsOutPath = path.join(outRoot, relative).replace(/\.ts$/, '.js');

  const result = ts.transpileModule(sourceText, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      sourceMap: true,
      inlineSources: true,
      strict: true,
      esModuleInterop: true,
    },
    fileName: sourceFilePath,
  });

  const sourceMap = JSON.parse(result.sourceMapText);
  sourceMap.sources = [sourceFilePath];
  sourceMap.sourceRoot = '';

  fs.mkdirSync(path.dirname(jsOutPath), { recursive: true });
  fs.writeFileSync(jsOutPath, result.outputText, 'utf8');
  fs.writeFileSync(`${jsOutPath}.map`, JSON.stringify(sourceMap), 'utf8');
}

async function run() {
  const projectRoot = path.resolve(__dirname, '..');
  const srcRoot = path.join(projectRoot, 'src');
  const outRoot = fs.mkdtempSync(path.join(projectRoot, '.coverage-tmp-'));
  const tsFiles = walkTsFiles(srcRoot).sort();
  const testSourceFiles = tsFiles.filter((filePath) => filePath.includes(`${path.sep}__tests__${path.sep}`) && filePath.endsWith('.test.ts'));

  if (testSourceFiles.length === 0) {
    console.error('No test files found under src/**/__tests__/*.test.ts');
    process.exit(1);
  }

  try {
    for (const tsFile of tsFiles) {
      transpileTsFile(tsFile, srcRoot, outRoot);
    }

    const compiledTests = testSourceFiles.map((testFile) => toCompiledTestPath(srcRoot, outRoot, testFile));
    const c8Bin = path.join(projectRoot, 'node_modules', 'c8', 'bin', 'c8.js');
    const runnerPath = path.join(outRoot, 'test-runner.cjs');

    if (!fs.existsSync(c8Bin)) {
      console.error('c8 is not installed. Run `pnpm install` first.');
      process.exit(1);
    }

    const runnerSource = `const files = ${JSON.stringify(compiledTests)};

for (const file of files) {
  require(file);
}
`;
    fs.writeFileSync(runnerPath, runnerSource, 'utf8');

    const c8Args = [
      c8Bin,
      '--reporter=text-summary',
      '--reporter=text',
      '--reporter=html',
      '--reporter=lcov',
      '--reports-dir=coverage',
      '--all',
      `--include=${path.basename(outRoot)}/**/*.js`,
      `--exclude=${path.basename(outRoot)}/**/__tests__/**`,
      '--exclude-after-remap=false',
      process.execPath,
      runnerPath,
    ];

    const result = spawnSync(process.execPath, c8Args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
    });

    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

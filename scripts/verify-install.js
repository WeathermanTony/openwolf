#!/usr/bin/env node
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const hookNames = [
  'session-start.js',
  'pre-read.js',
  'pre-write.js',
  'post-read.js',
  'post-write.js',
  'shared.js',
  'stop.js',
  'complete-review.js',
];

const utilNames = [
  'fs-safe.js',
  'logger.js',
  'paths.js',
  'platform.js',
  'port-allocator.js',
  'size-discipline.js',
];

const requiredFiles = [
  'CLAUDE.md',
  '.claude/settings.json',
  '.claude/rules/openwolf.md',
  '.wolf/OPENWOLF.md',
  '.wolf/PROTOCOL-UPGRADE-2026-06.md',
  '.wolf/config.json',
  '.wolf/anatomy.md',
  '.wolf/memory.md',
  '.wolf/hooks/package.json',
  '.wolf/qa/_README.md',
  '.wolf/qa/_template.md',
  'src/config/default-config.json',
  'templates/claude/settings.json',
  'templates/claude/rules/openwolf.md',
  'templates/wolf/OPENWOLF.md',
  'templates/wolf/PROTOCOL-UPGRADE-2026-06.md',
  'templates/wolf/anatomy.md',
  'templates/wolf/memory.md',
  'templates/wolf/cerebrum.md',
  'templates/wolf/config.json',
  'templates/wolf/identity.md',
  'templates/wolf/hooks/package.json',
  'templates/wolf/reframe-frameworks.md',
  'templates/wolf/qa/_README.md',
  'templates/wolf/qa/_template.md',
  'templates/wolf/qa/_gate-log.json',
  ...hookNames.flatMap((name) => [`.wolf/hooks/${name}`, `src/hooks/${name}`, `templates/wolf/hooks/${name}`]),
  ...utilNames.flatMap((name) => [`.wolf/utils/${name}`, `src/utils/${name}`, `templates/wolf/utils/${name}`]),
];

const jsonFiles = [
  'package.json',
  '.claude/settings.json',
  '.wolf/config.json',
  '.wolf/hooks/package.json',
  'src/config/default-config.json',
  'templates/claude/settings.json',
  'templates/wolf/config.json',
  'templates/wolf/hooks/package.json',
];

const javascriptFiles = [
  ...hookNames.flatMap((name) => [`.wolf/hooks/${name}`, `src/hooks/${name}`, `templates/wolf/hooks/${name}`]),
  ...utilNames.flatMap((name) => [`.wolf/utils/${name}`, `src/utils/${name}`, `templates/wolf/utils/${name}`]),
];

function rel(file) {
  return path.join(root, file);
}

async function fileExists(file) {
  try {
    await access(rel(file), constants.R_OK);
    return true;
  } catch {
    failures.push(`missing required file: ${file}`);
    return false;
  }
}

async function parseJson(file) {
  try {
    return JSON.parse(await readFile(rel(file), 'utf8'));
  } catch (error) {
    failures.push(`invalid JSON in ${file}: ${error.message}`);
    return null;
  }
}

const expectedClaimCalibration = {
  enabled: true,
  nudge_only: true,
  min_text_chars: 180,
  min_signal_hits: 2,
  max_fires_per_session: 3,
  retention_days: 30,
  log_decisions: true,
  require_missing_markers: true,
  categories: {
    strong_claims: true,
    causal_claims: true,
    generalizations: true,
    debugging_conclusions: true,
    methodology_claims: true,
    confidence_claims: true,
  },
  discipline_markers: {
    observed: true,
    inferred: true,
    limits: true,
    falsifiers: true,
  },
};

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function checkOptionalDaemonDefaults() {
  for (const file of ['src/config/default-config.json', 'src/templates/config.json', 'templates/wolf/config.json']) {
    const parsed = await parseJson(file);
    if (parsed?.openwolf?.daemon?.auto_start !== false) {
      failures.push(`${file} must default openwolf.daemon.auto_start to false`);
    }
    if (parsed?.openwolf?.dashboard?.enabled !== false) {
      failures.push(`${file} must default openwolf.dashboard.enabled to false`);
    }
  }
}

async function checkClaimCalibrationConfig() {
  for (const file of ['.wolf/config.json', 'src/config/default-config.json', 'templates/wolf/config.json']) {
    const parsed = await parseJson(file);
    const actual = parsed?.openwolf?.claim_calibration;
    if (!actual) {
      failures.push(`${file} missing openwolf.claim_calibration`);
      continue;
    }
    if (parsed?.openwolf?.scientific_mode !== undefined) {
      failures.push(`${file} should use canonical openwolf.claim_calibration, not legacy openwolf.scientific_mode`);
    }
    if (!deepEqual(actual, expectedClaimCalibration)) {
      failures.push(`${file} openwolf.claim_calibration defaults differ from the expected default-enabled Claim Calibration contract`);
    }
  }
}

async function readRequiredText(file) {
  try {
    return await readFile(rel(file), 'utf8');
  } catch (error) {
    failures.push(`unable to inspect ${file}: ${error.message}`);
    return '';
  }
}

async function checkReviewCompletionWorkflow() {
  for (const file of ['.wolf/hooks/stop.js', 'src/hooks/stop.js', 'templates/wolf/hooks/stop.js']) {
    const content = await readRequiredText(file);
    if (content.includes('mark .wolf/reviewlog.json entry')) {
      failures.push(`${file} still tells assistants to manually complete reviewlog entries`);
    }
    if (!content.includes('hooks", "complete-review.js"') && !content.includes('.wolf/hooks/complete-review.js')) {
      failures.push(`${file} must point review completion to an absolute or project .wolf/hooks/complete-review.js helper path`);
    }
    for (const marker of ['provider companion review', 'Critical flaws only', 'evidence and a falsifier', '--reviewed-current']) {
      if (!content.includes(marker)) failures.push(`${file} missing standardized review marker: ${marker}`);
    }
    for (const forbidden of ['codex exec --full-auto', 'codex_command']) {
      if (content.includes(forbidden)) failures.push(`${file} contains active legacy review transport: ${forbidden}`);
    }
  }
  for (const file of ['.wolf/config.json', 'src/config/default-config.json', 'src/templates/config.json', 'templates/wolf/config.json']) {
    const content = await readRequiredText(file);
    if (content.includes('codex exec --full-auto')) failures.push(`${file} contains the legacy Codex default`);
    if (!content.includes('"review_companion"')) failures.push(`${file} missing review_companion config`);
  }
}

const scaffoldLeakMarkers = [
  'customopenwolf',
  '/mnt/j/projectshome/projects/customopenwolf',
  '/home/tony/projects/customopenwolf',
  'Scientific Mode',
  'autonomy_continuation',
  'complete-review.js review-NNNN',
  'daemon start/init paths',
  'silly-herding-cake',
  'unified-kindling-rose',
];

function checkNoScaffoldLeakMarkers(label, content) {
  for (const marker of scaffoldLeakMarkers) {
    if (content.includes(marker)) {
      failures.push(`${label} contains project-specific scaffold marker: ${marker}`);
    }
  }
}

async function checkCleanProjectTemplates() {
  for (const file of ['src/templates/cerebrum.md', 'templates/wolf/cerebrum.md', 'src/templates/anatomy.md', 'templates/wolf/anatomy.md', 'src/templates/identity.md', 'templates/wolf/identity.md', 'src/templates/buglog.json', 'src/templates/reviewlog.json', 'src/templates/token-ledger.json', 'src/templates/qa/_gate-log.json', 'templates/wolf/qa/_gate-log.json']) {
    checkNoScaffoldLeakMarkers(file, await readRequiredText(file));
  }

  const initSource = await readRequiredText('src/cli/init.ts');
  for (const marker of ['"cerebrum.md"', '"anatomy.md"']) {
    if (!initSource.includes(marker)) {
      failures.push(`src/cli/init.ts embedded scaffold fallback missing ${marker}`);
    }
  }
  checkNoScaffoldLeakMarkers('src/cli/init.ts embedded scaffold fallback', initSource);
}

async function checkProtocolUpgradeDocs() {
  for (const file of ['.wolf/OPENWOLF.md', 'src/templates/OPENWOLF.md', 'templates/wolf/OPENWOLF.md']) {
    const content = await readRequiredText(file);
    for (const heading of ['## Recall Before Acting', '## Link Fixes to Proof', '## Consolidate When Noisy', '## Companion-Owned Review Lifecycle', '## Operational Verification']) {
      if (!content.includes(heading)) {
        failures.push(`${file} missing protocol section ${heading}`);
      }
    }
    for (const marker of ['/ops:live-debug', '/ops:deploy-verify', 'health and functional probes', 'not an OS/filesystem sandbox', 'receipt hashes currently use a different representation']) {
      if (!content.includes(marker)) failures.push(`${file} missing review/ops protocol marker: ${marker}`);
    }
    for (const field of ['"commit": null', '"reduction":']) {
      if (!content.includes(field)) {
        failures.push(`${file} buglog schema example missing ${field}`);
      }
    }
  }

  for (const file of ['.wolf/PROTOCOL-UPGRADE-2026-06.md', 'src/templates/PROTOCOL-UPGRADE-2026-06.md', 'templates/wolf/PROTOCOL-UPGRADE-2026-06.md']) {
    const content = await readRequiredText(file);
    for (const heading of ['## Recall Before Acting', '## Link Fixes to Proof', '## Consolidate When Noisy', '## Buglog schema bump']) {
      if (!content.includes(heading)) {
        failures.push(`${file} missing portable protocol section ${heading}`);
      }
    }
  }
}

async function checkBuglogProofFields() {
  const current = await parseJson('.wolf/buglog.json');
  for (const bug of current?.bugs || []) {
    if (!Object.prototype.hasOwnProperty.call(bug, 'commit')) {
      failures.push(`.wolf/buglog.json ${bug.id || '<unknown>'} missing commit field`);
    }
    if (!Object.prototype.hasOwnProperty.call(bug, 'reduction')) {
      failures.push(`.wolf/buglog.json ${bug.id || '<unknown>'} missing reduction field`);
    }
  }

  const scaffold = await parseJson('src/templates/buglog.json');
  if (Array.isArray(scaffold?.bugs) && scaffold.bugs.length !== 0) {
    failures.push('src/templates/buglog.json should be an empty scaffold buglog, not copied project history');
  }
}

async function checkFreshInitScaffoldOutput() {
  const cli = rel('dist/bin/openwolf.js');
  try {
    await access(cli, constants.X_OK);
  } catch {
    failures.push('dist/bin/openwolf.js missing or not executable; run npm run build before verify');
    return;
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'ow-verify-scaffold-'));
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fresh-verify-app', description: 'Fresh verify scaffold' }, null, 2));
    const result = spawnSync(process.execPath, [cli, 'init', '--profile', 'open'], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, OPENWOLF_VERIFY_INSTALL: '1' },
      encoding: 'utf8',
      timeout: 120000,
    });
    if (result.status !== 0) {
      failures.push(`fresh init scaffold check failed: ${(result.stderr || result.stdout).trim()}`);
      return;
    }

    const cerebrum = await readFile(path.join(dir, '.wolf', 'cerebrum.md'), 'utf8');
    const anatomy = await readFile(path.join(dir, '.wolf', 'anatomy.md'), 'utf8');
    const gateLog = JSON.parse(await readFile(path.join(dir, '.wolf', 'qa', '_gate-log.json'), 'utf8'));
    const config = JSON.parse(await readFile(path.join(dir, '.wolf', 'config.json'), 'utf8'));
    const protocolUpgrade = await readFile(path.join(dir, '.wolf', 'PROTOCOL-UPGRADE-2026-06.md'), 'utf8');
    checkNoScaffoldLeakMarkers('fresh init .wolf/cerebrum.md', cerebrum);
    checkNoScaffoldLeakMarkers('fresh init .wolf/anatomy.md', anatomy);
    checkNoScaffoldLeakMarkers('fresh init .wolf/qa/_gate-log.json', JSON.stringify(gateLog));
    if (!Array.isArray(gateLog.entries) || gateLog.entries.length !== 0) {
      failures.push('fresh init .wolf/qa/_gate-log.json should be an empty scaffold log');
    }
    if (config?.openwolf?.daemon?.auto_start !== false || config?.openwolf?.dashboard?.enabled !== false) {
      failures.push('fresh init must disable daemon auto-start and dashboard by default');
    }
    if (!result.stdout.includes('Wolfpack quality hooks are active')) {
      failures.push('fresh init output must distinguish active quality hooks from optional background services');
    }
    for (const heading of ['## Recall Before Acting', '## Link Fixes to Proof', '## Consolidate When Noisy', '## Buglog schema bump']) {
      if (!protocolUpgrade.includes(heading)) {
        failures.push(`fresh init .wolf/PROTOCOL-UPGRADE-2026-06.md missing ${heading}`);
      }
    }
    if (!cerebrum.includes('- **Project:** fresh-verify-app')) {
      failures.push('fresh init .wolf/cerebrum.md did not seed the fresh project name');
    }
    if (!cerebrum.includes('- **Description:** Fresh verify scaffold')) {
      failures.push('fresh init .wolf/cerebrum.md did not seed the fresh project description');
    }
  } catch (error) {
    failures.push(`fresh init scaffold check could not inspect generated output: ${error.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function checkHookPackage(file) {
  const manifest = await parseJson(file);
  if (manifest && manifest.type !== 'module') {
    failures.push(`${file} must set type=module so hook JavaScript loads as ESM`);
  }
}

function nodeCheck(file) {
  const result = spawnSync(process.execPath, ['--check', rel(file)], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failures.push(`node --check failed for ${file}: ${(result.stderr || result.stdout).trim()}`);
  }
}

async function checkSettings() {
  try {
    const settings = JSON.parse(await readFile(rel('.claude/settings.json'), 'utf8'));
    const hooks = settings.hooks || {};
    for (const name of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']) {
      if (!Array.isArray(hooks[name])) {
        failures.push(`.claude/settings.json missing hooks.${name}`);
      }
    }

    const serialized = JSON.stringify(settings);
    for (const hook of ['session-start.js', 'pre-read.js', 'pre-write.js', 'post-read.js', 'post-write.js', 'stop.js']) {
      if (!serialized.includes(`.wolf/hooks/${hook}`)) {
        failures.push(`.claude/settings.json does not reference .wolf/hooks/${hook}`);
      }
    }
  } catch (error) {
    failures.push(`unable to inspect .claude/settings.json: ${error.message}`);
  }
}

function checkGitIgnored() {
  const gitRoot = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    encoding: 'utf8',
  });

  if (gitRoot.status !== 0 || gitRoot.stdout.trim() !== 'true') {
    failures.push('git ignore checks require running inside an initialized git repository');
    return;
  }

  const ignoredPaths = [
    '.wolf/daemon.log',
    '.wolf/hooks/_session.json',
    '.wolf/token-ledger.json',
    '.wolf/cerebrum-stats.json',
    '.wolf/cerebrum/cerebrum-stats.json',
    '.wolf/nested/token-ledger.json',
    '.wolf/nested/suggestions.json',
    '.wolf/nested/reviewlog.json',
    '.wolf/nested/cron-manifest.json',
    '.wolf/nested/designqc-report.json',
    '.wolf/nested/runtime.log',
    '.wolf/nested/runtime-state.json',
    '.wolf/hooks/_session.json.lock',
    '.wolf/hooks/_session.json.lock.reclaim',
    '.wolf/qa/_gate-log.json',
    '.wolf/qa/nested/reduction.md',
  ];

  for (const ignoredPath of ignoredPaths) {
    const result = spawnSync('git', ['check-ignore', '-q', ignoredPath], {
      cwd: root,
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      failures.push(`expected OpenWolf runtime file to be ignored by git: ${ignoredPath}`);
    }
  }

  const trackedPaths = [
    'CLAUDE.md',
    '.claude/settings.json',
    '.claude/rules/openwolf.md',
    '.wolf/OPENWOLF.md',
    '.wolf/PROTOCOL-UPGRADE-2026-06.md',
    '.wolf/config.json',
    '.wolf/anatomy.md',
    '.wolf/memory.md',
    '.wolf/buglog.json',
    '.wolf/hooks/package.json',
    '.wolf/qa/_README.md',
    '.wolf/qa/_template.md',
    'src/config/default-config.json',
    'src/templates/.gitignore',
    'templates/claude/settings.json',
    'templates/claude/rules/openwolf.md',
    'templates/wolf/.gitignore',
    'templates/wolf/OPENWOLF.md',
    'templates/wolf/PROTOCOL-UPGRADE-2026-06.md',
    'templates/wolf/anatomy.md',
    'templates/wolf/memory.md',
    'templates/wolf/cerebrum.md',
    'templates/wolf/config.json',
    'templates/wolf/identity.md',
    'templates/wolf/hooks/package.json',
    'templates/wolf/reframe-frameworks.md',
    'templates/wolf/qa/_README.md',
    'templates/wolf/qa/_template.md',
    'templates/wolf/qa/_gate-log.json',
    ...hookNames.flatMap((name) => [`.wolf/hooks/${name}`, `src/hooks/${name}`, `templates/wolf/hooks/${name}`]),
    ...utilNames.flatMap((name) => [`.wolf/utils/${name}`, `src/utils/${name}`, `templates/wolf/utils/${name}`]),
  ];

  for (const trackedPath of trackedPaths) {
    const result = spawnSync('git', ['check-ignore', '-q', trackedPath], {
      cwd: root,
      encoding: 'utf8',
    });

    if (result.status === 0) {
      failures.push(`expected scaffold file to remain trackable by git: ${trackedPath}`);
    }
  }
}

for (const file of requiredFiles) {
  await fileExists(file);
}

for (const file of jsonFiles) {
  await parseJson(file);
}

for (const file of ['.wolf/hooks/package.json', 'templates/wolf/hooks/package.json']) {
  await checkHookPackage(file);
}

await checkOptionalDaemonDefaults();
await checkClaimCalibrationConfig();
await checkReviewCompletionWorkflow();
await checkCleanProjectTemplates();
await checkProtocolUpgradeDocs();
await checkBuglogProofFields();
await checkFreshInitScaffoldOutput();

for (const file of javascriptFiles) {
  nodeCheck(file);
}

await checkSettings();
checkGitIgnored();

if (failures.length > 0) {
  console.error('OpenWolf install verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('OpenWolf install verification passed.');

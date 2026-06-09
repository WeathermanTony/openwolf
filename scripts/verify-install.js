#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  'templates/wolf/anatomy.md',
  'templates/wolf/memory.md',
  'templates/wolf/cerebrum.md',
  'templates/wolf/config.json',
  'templates/wolf/identity.md',
  'templates/wolf/hooks/package.json',
  'templates/wolf/reframe-frameworks.md',
  'templates/wolf/qa/_README.md',
  'templates/wolf/qa/_template.md',
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
    '.wolf/nested/buglog.json',
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
    'templates/wolf/anatomy.md',
    'templates/wolf/memory.md',
    'templates/wolf/cerebrum.md',
    'templates/wolf/config.json',
    'templates/wolf/identity.md',
    'templates/wolf/hooks/package.json',
    'templates/wolf/reframe-frameworks.md',
    'templates/wolf/qa/_README.md',
    'templates/wolf/qa/_template.md',
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

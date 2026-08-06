import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'bin', 'openwolf.js');
const ids = ['statistical-analysis', 'networkx', 'aeon', 'hypothesis-generation', 'scientific-brainstorming', 'scientific-critical-thinking', 'scientific-writing', 'citation-management', 'scientific-visualization'];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function run(args, home, ok = true) {
  const result = spawnSync(process.execPath, [cli, 'skills', 'scientific', ...args], {
    cwd: tmpdir(),
    env: { ...process.env, HOME: home, OPENWOLF_SKILLSBENCH_DISABLE_SCHEDULE: '1', OPENWOLF_SKILLSBENCH_SKIP_PLUGIN_CLI: '1' },
    encoding: 'utf8',
    timeout: 120000,
  });
  if (ok) assert.equal(result.status, 0, `${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

async function fixture(prefix) { return mkdtemp(path.join(tmpdir(), prefix)); }

async function addSkill(repo, id, body = 'body') {
  const dir = path.join(repo, 'tasks', 'fixtures', 'environment', 'skills', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: fixture\n---\n${body}\n`);
}

async function sourceRepository() {
  const repo = await fixture('scientific-skills-source-');
  git(['init'], repo);
  git(['config', 'user.email', 'fixture@example.test'], repo);
  git(['config', 'user.name', 'Fixture'], repo);
  for (const id of ids) await addSkill(repo, id);
  git(['add', '.'], repo);
  git(['commit', '-m', 'first'], repo);
  return repo;
}

async function configure(home, source) {
  const dir = path.join(home, '.openwolf', 'kdense-scientific');
  await mkdir(dir, { recursive: true });
  const skills = ids.map(id => ({ id, path: `tasks/fixtures/environment/skills/${id}` }));
  await writeFile(path.join(dir, 'config.json'), JSON.stringify({ sourceUrl: source, sourceRef: 'HEAD', cadence: 'weekly', skills }, null, 2));
}

test('Scientific skills manager creates an atomic plugin release without touching unrelated marketplace state', async () => {
  const home = await fixture('scientific-skills-home-');
  const source = await sourceRepository();
  try {
    await configure(home, source);
    const unrelated = path.join(home, '.claude', 'plugins', 'marketplaces', 'unrelated', 'keep.txt');
    await mkdir(path.dirname(unrelated), { recursive: true });
    await writeFile(unrelated, 'unchanged');

    run(['update', '--dry-run'], home);
    assert.equal(existsSync(path.join(home, 'projects', 'kdense-scientific', 'upstream')), false, 'dry-run must not clone or write state');

    run(['init'], home);
    const lockPath = path.join(home, '.openwolf', 'kdense-scientific', 'lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(lock.skills.length, 9);
    assert.match(lock.commit, /^[0-9a-f]{40}$/);
    const manifest = JSON.parse(await readFile(path.join(home, '.openwolf', 'kdense-scientific', 'releases', lock.activeRelease, 'marketplace', 'plugins', 'scientific-skills', '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.match(manifest.version, /^0\.1\.0\+[0-9a-f]{12}$/);
    assert.equal(manifest.metadata.scientificSkillsCommit, lock.commit);
    const marketplace = path.join(home, '.claude', 'plugins', 'marketplaces', 'kdense-scientific');
    assert.equal(lstatSync(marketplace).isSymbolicLink(), true);
    assert.equal(await readFile(unrelated, 'utf8'), 'unchanged');
    for (const id of ids) assert.equal(existsSync(path.join(home, '.openwolf', 'kdense-scientific', 'releases', lock.activeRelease, 'marketplace', 'plugins', 'scientific-skills', 'skills', id, 'SKILL.md')), true);
    run(['doctor'], home);
    const active = path.join(home, '.openwolf', 'kdense-scientific', 'active');
    assert.equal(lstatSync(active).isSymbolicLink(), true);

    const configPath = path.join(home, '.openwolf', 'kdense-scientific', 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.skills = config.skills.slice(0, 5);
    await writeFile(configPath, JSON.stringify(config));
    run(['update'], home);
    const sameCommit = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(sameCommit.commit, lock.commit);
    assert.notEqual(sameCommit.activeRelease, lock.activeRelease, 'selection changes must create a distinct release at the same commit');
    assert.equal(sameCommit.releaseKey, sameCommit.activeRelease);
    run(['doctor'], home);
    config.skills = ids.map(id => ({ id, path: `tasks/fixtures/environment/skills/${id}` }));
    await writeFile(configPath, JSON.stringify(config));

    await writeFile(path.join(source, 'tasks', 'fixtures', 'environment', 'skills', 'statistical-analysis', 'SKILL.md'), '---\nname: statistical-analysis\ndescription: changed\n---\nupdated\n');
    git(['add', '.'], source);
    git(['commit', '-m', 'second'], source);
    run(['update'], home);
    const next = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.notEqual(next.activeRelease, lock.activeRelease);
    assert.equal(next.previousRelease, sameCommit.activeRelease);
    run(['rollback'], home);
    const restored = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(restored.activeRelease, sameCommit.activeRelease);
    assert.equal(restored.commit, sameCommit.commit);
    assert.deepEqual(restored.skills, sameCommit.skills);
    run(['doctor'], home);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test('Scientific skills rejects symlinks in selected skill trees before release activation', async () => {
  const home = await fixture('scientific-skills-symlink-home-');
  const source = await sourceRepository();
  try {
    await configure(home, source);
    const skillDir = path.join(source, 'tasks', 'fixtures', 'environment', 'skills', 'statistical-analysis');
    await writeFile(path.join(source, 'outside.txt'), 'not a skill file');
    await new Promise((resolve, reject) => {
      import('node:fs').then(({ symlink }) => symlink('../outside.txt', path.join(skillDir, 'escape-link'), error => error ? reject(error) : resolve()));
    });
    git(['add', '.'], source);
    git(['commit', '-m', 'symlink fixture'], source);
    const result = run(['update'], home, false);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(path.join(home, '.openwolf', 'kdense-scientific', 'lock.json')), false);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test('Scientific skills rejects a mismatched frontmatter name and preserves no release', async () => {
  const home = await fixture('scientific-skills-name-home-');
  const source = await sourceRepository();
  try {
    await configure(home, source);
    await writeFile(path.join(source, 'tasks', 'fixtures', 'environment', 'skills', 'statistical-analysis', 'SKILL.md'), '---\nname: wrong-name\n---\n');
    git(['add', '.'], source);
    git(['commit', '-m', 'mismatched name'], source);
    const result = run(['update'], home, false);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(path.join(home, '.openwolf', 'kdense-scientific', 'lock.json')), false);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test('Scientific skills cron quoting executes with apostrophes in executable and HOME paths', async () => {
  const fixtureRoot = await fixture("scientific-skills-o'brien-$HOME-%cron-");
  try {
    const module = await import('../dist/src/cli/scientific-skills.js');
    const executable = path.join(fixtureRoot, "n'ode-$USER");
    const entrypoint = path.join(fixtureRoot, "open'wolf-$(id -u).js");
    const logPath = path.join(fixtureRoot, "week'ly-$HOME.log");
    await writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    await chmod(executable, 0o755);
    const command = module.buildScheduledCommand(executable, entrypoint, logPath);
    assert.match(module.managedCron('', command, true), /\\%cron/);
    const executed = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(await readFile(logPath, 'utf8'), `${entrypoint}\nskills\nscientific\nupdate\n--quiet\n`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('Scientific skills rejects path-escaping configuration and preserves no release', async () => {
  const home = await fixture('scientific-skills-invalid-home-');
  const source = await sourceRepository();
  try {
    await configure(home, source);
    const configPath = path.join(home, '.openwolf', 'kdense-scientific', 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.skills[0].path = '../escape';
    await writeFile(configPath, JSON.stringify(config));
    const result = run(['update'], home, false);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(path.join(home, '.openwolf', 'kdense-scientific', 'lock.json')), false);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

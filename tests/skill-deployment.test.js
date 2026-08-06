import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'bin', 'openwolf.js');
const template = path.join(root, 'src', 'templates', 'claude', 'skills', 'quality-reduction', 'SKILL.md');

async function fixture(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function runCli(args, { cwd, home }) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: cwd, OPENWOLF_VERIFY_INSTALL: '1' },
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, `${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

async function seedProject(projectRoot, name) {
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name }, null, 2));
}

async function seedRegistry(home, projects) {
  const registryDir = path.join(home, '.openwolf');
  await mkdir(registryDir, { recursive: true });
  const now = '2026-08-06T00:00:00.000Z';
  await writeFile(path.join(registryDir, 'registry.json'), JSON.stringify({
    version: 1,
    projects: projects.map(({ root: projectRoot, name }) => ({
      root: projectRoot,
      name,
      registered_at: now,
      last_updated: now,
      version: '1.2.0-custom.14',
    })),
  }, null, 2));
}

test('fresh init installs the managed quality-reduction skill and ESM utility scope', async () => {
  const home = await fixture('ow-skill-home-');
  const project = await fixture('ow-skill-project-');
  try {
    await seedProject(project, 'fresh-skill-project');
    runCli(['init', '--profile', 'open'], { cwd: project, home });

    const installed = path.join(project, '.claude', 'skills', 'quality-reduction', 'SKILL.md');
    assert.equal(await readFile(installed, 'utf8'), await readFile(template, 'utf8'));
    for (const external of ['pdf', 'xlsx', 'docx', 'pptx', 'image-ocr', 'video-frame-extraction']) {
      assert.equal(existsSync(path.join(project, '.claude', 'skills', external)), false, `${external} must remain user-scope, not project-managed`);
    }
    assert.deepEqual(JSON.parse(await readFile(path.join(project, '.wolf', 'utils', 'package.json'), 'utf8')), { type: 'module' });

    const sharedHookUrl = pathToFileURL(path.join(project, '.wolf', 'hooks', 'shared.js')).href;
    const hookImport = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(sharedHookUrl)})`], {
      cwd: project,
      encoding: 'utf8',
    });
    assert.equal(hookImport.status, 0, hookImport.stderr || hookImport.stdout);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test('scoped update overwrites only the managed file and restore returns prior state', async () => {
  const home = await fixture('ow-update-home-');
  const first = await fixture('ow-update-first-');
  const second = await fixture('ow-update-second-');
  const staleManaged = 'stale managed skill\n';
  const userSkill = 'user-owned skill\n';
  const adjacentUserFile = 'user notes\n';
  try {
    for (const [project, name] of [[first, 'managed-canary'], [second, 'untouched-project']]) {
      await seedProject(project, name);
      runCli(['init', '--profile', 'open'], { cwd: project, home });
    }

    const managedPath = path.join(first, '.claude', 'skills', 'quality-reduction', 'SKILL.md');
    const userPath = path.join(first, '.claude', 'skills', 'team-private', 'SKILL.md');
    const adjacentPath = path.join(first, '.claude', 'skills', 'quality-reduction', 'NOTES.md');
    const secondManaged = path.join(second, '.claude', 'skills', 'quality-reduction', 'SKILL.md');
    await mkdir(path.dirname(userPath), { recursive: true });
    await writeFile(managedPath, staleManaged);
    await writeFile(userPath, userSkill);
    await writeFile(adjacentPath, adjacentUserFile);
    await writeFile(secondManaged, 'second stale skill\n');
    await seedRegistry(home, [{ root: first, name: 'managed-canary' }, { root: second, name: 'untouched-project' }]);

    runCli(['update', '--dry-run', '--project', 'managed-canary'], { cwd: root, home });
    assert.equal(await readFile(managedPath, 'utf8'), staleManaged, 'dry run must not mutate the managed skill');

    runCli(['update', '--project', 'managed-canary'], { cwd: root, home });
    assert.equal(await readFile(managedPath, 'utf8'), await readFile(template, 'utf8'));
    assert.equal(await readFile(userPath, 'utf8'), userSkill);
    assert.equal(await readFile(adjacentPath, 'utf8'), adjacentUserFile);
    assert.equal(await readFile(secondManaged, 'utf8'), 'second stale skill\n', 'scoped update must not touch other projects');

    const backups = (await readdir(path.join(first, '.wolf', 'backups'))).sort();
    assert.ok(backups.length > 0);
    const backup = backups.at(-1);
    assert.equal(
      await readFile(path.join(first, '.wolf', 'backups', backup, '.claude', 'skills', 'quality-reduction', 'SKILL.md'), 'utf8'),
      staleManaged,
    );

    runCli(['restore', backup], { cwd: first, home });
    assert.equal(await readFile(managedPath, 'utf8'), staleManaged);
    assert.equal(await readFile(userPath, 'utf8'), userSkill);
    assert.equal(await readFile(adjacentPath, 'utf8'), adjacentUserFile);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test('same-minute updates create distinct backups with review history', async () => {
  const home = await fixture('ow-backup-home-');
  const project = await fixture('ow-backup-project-');
  try {
    await seedProject(project, 'backup-collision-project');
    runCli(['init', '--profile', 'open'], { cwd: project, home });
    await writeFile(path.join(project, '.wolf', 'reviewlog.json'), JSON.stringify({ version: 1, reviews: [{ id: 'review-preserved' }] }, null, 2));
    await seedRegistry(home, [{ root: project, name: 'backup-collision-project' }]);

    runCli(['update', '--project', 'backup-collision-project'], { cwd: root, home });
    runCli(['update', '--project', 'backup-collision-project'], { cwd: root, home });
    const backups = (await readdir(path.join(project, '.wolf', 'backups'))).sort();
    assert.equal(backups.length, 2);
    for (const backup of backups) {
      const reviewlog = JSON.parse(await readFile(path.join(project, '.wolf', 'backups', backup, 'reviewlog.json'), 'utf8'));
      assert.equal(reviewlog.reviews[0].id, 'review-preserved');
    }
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test('restore removes an unchanged managed skill introduced after an absent backup', async () => {
  const home = await fixture('ow-restore-home-');
  const project = await fixture('ow-restore-project-');
  try {
    await seedProject(project, 'legacy-without-skill');
    runCli(['init', '--profile', 'open'], { cwd: project, home });
    const managedPath = path.join(project, '.claude', 'skills', 'quality-reduction', 'SKILL.md');
    await rm(managedPath);
    await seedRegistry(home, [{ root: project, name: 'legacy-without-skill' }]);

    runCli(['update', '--project', 'legacy-without-skill'], { cwd: root, home });
    assert.equal(existsSync(managedPath), true);
    const backup = (await readdir(path.join(project, '.wolf', 'backups'))).sort().at(-1);
    runCli(['restore', backup], { cwd: project, home });
    assert.equal(existsSync(managedPath), false);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

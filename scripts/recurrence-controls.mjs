import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { cleanupFixture, createTmpFixture } from '../tests/lib/fixture-cleanup.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = path.join(repository, 'dist/src/buglog/recurrence-report.js');
const original = fs.readFileSync(production, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const sourcePath = path.join(repository, 'src/buglog/recurrence-report.ts');
const configPath = path.join(repository, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined, 'TypeScript configuration must be readable');
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repository);
assert.equal(parsed.errors.length, 0, 'TypeScript configuration must be valid');
const program = ts.createProgram([sourcePath], parsed.options);
assert.equal(ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0,
  'Current source must compile before a control can claim production coverage');
let expectedRuntime;
const emitted = program.emit(undefined, (filename, content) => {
  if (path.resolve(filename) === production) expectedRuntime = content;
});
assert.equal(emitted.emitSkipped, false, 'In-memory compilation must emit the module');
assert.equal(typeof expectedRuntime, 'string', 'Current compiler must emit the exact production module');
assert.equal(sha(original), sha(expectedRuntime), 'Rebuild: compiled runtime does not match current TypeScript source/configuration');
const provenance = {
  source_sha256: sha(fs.readFileSync(sourcePath)), tsconfig_sha256: sha(fs.readFileSync(configPath)),
  typescript_version: ts.version, expected_runtime_sha256: sha(expectedRuntime), compiled_runtime_sha256: sha(original),
  source_runtime_freshness_checked: true,
};
const root = createTmpFixture('ow-ledger-test-');
const git = args => {
  const child = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: {
    ...process.env, GIT_AUTHOR_DATE: '2026-09-02T12:00:00Z', GIT_COMMITTER_DATE: '2026-09-02T12:00:00Z',
  } });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim();
};
try {
  fs.mkdirSync(path.join(root, '.wolf/qa'), { recursive: true });
  fs.mkdirSync(path.join(root, 'transcripts'));
  fs.writeFileSync(path.join(root, 'fixed.txt'), 'fixed\n');
  fs.writeFileSync(path.join(root, '.wolf/qa/fix.md'), 'Fixture reduction\n');
  git(['init', '-q']); git(['add', 'fixed.txt']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fix']);
  fs.writeFileSync(path.join(root, '.wolf/buglog.json'), JSON.stringify({ version: 1, bugs: [{
    id: 'bug-101', status: 'resolved', error_message: 'Connection refused while writing cache',
    commit: git(['rev-parse', 'HEAD']), reduction: '.wolf/qa/fix.md',
  }] }));
  const rows = [];
  for (const [id, timestamp, isError] of [
    ['old', '2026-09-02T11:59:59Z', true], ['new', '2026-09-02T12:00:01Z', true],
    ['success', '2026-09-02T12:00:01Z', false],
  ]) {
    rows.push({ type: 'assistant', sessionId: 'control', cwd: root, timestamp,
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'fixture' } }] } });
    rows.push({ type: 'user', sessionId: 'control', cwd: root, timestamp,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError,
        content: 'Connection refused while writing cache' }] } });
  }
  const content = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'transcripts/a.jsonl'), content);
  fs.writeFileSync(path.join(root, 'transcripts/copy.jsonl'), content);
  const probe = path.join(root, 'probe.mjs');
  fs.writeFileSync(probe, `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildRecurrenceReport} from './runtime.mjs';
const root=${JSON.stringify(root)};
const archive=path.join(root,'.wolf/archive/buglog-2026-08.json');
const unsupported=path.join(root,'transcripts/unsupported.jsonl');
for(const file of [archive,unsupported])if(fs.existsSync(file))fs.unlinkSync(file);
const r = buildRecurrenceReport({projectRoot:${JSON.stringify(root)},transcriptDir:${JSON.stringify(path.join(root, 'transcripts'))}});
assert.equal(r.complete,true);
assert.equal(r.summary.distinct_incidents,2,'explicit error status/correlation guard');
assert.equal(r.bugs[0].counts.pre_fix,1,'old evidence stays pre-fix');
assert.equal(r.bugs[0].counts.post_fix_possible,1,'only newer failure is possible post-fix');
assert.equal(r.bugs[0].incidents.find(i=>i.tool_use_id==='old').classification,'pre_fix','old evidence stays pre-fix');
assert.equal(r.bugs[0].incidents.find(i=>i.tool_use_id==='new').classification,'post_fix_possible','only newer failure is possible post-fix');
const bug=JSON.parse(fs.readFileSync(path.join(root,'.wolf/buglog.json'))).bugs[0];
fs.mkdirSync(path.dirname(archive),{recursive:true});
for(const [field,value] of [['file','different.js'],['commit','deadbee'],['reduction','.wolf/qa/other.md'],['status','open']]){
  fs.writeFileSync(archive,JSON.stringify({bugs:[{...bug,[field]:value}]}));
  const report=buildRecurrenceReport({projectRoot:root,transcriptDir:path.join(root,'transcripts')});
  assert.equal(report.complete,false,'conflicting decision fields must degrade coverage');
  assert.deepEqual(report.ledger_coverage.ambiguous_ids,['bug-101'],'conflicting decision fields must name their ID');
}
fs.unlinkSync(archive);
for(const [content,code] of [[[{type:'server_tool_use',id:'new-shape'}],'unsupported-content-block'],[{type:'tool_use',id:'wrong-container'},'unsupported-message-shape']]){
  fs.writeFileSync(unsupported,JSON.stringify({type:'assistant',sessionId:'control',cwd:root,message:{role:'assistant',content}})+'\\n');
  const report=buildRecurrenceReport({projectRoot:root,transcriptDir:path.join(root,'transcripts')});
  assert.equal(report.complete,false,'unsupported tool shapes must degrade coverage');
  assert.ok(report.diagnostics.some(d=>d.code===code),'unsupported tool shapes must name their diagnostic');
}
fs.unlinkSync(unsupported);
console.log(JSON.stringify({distinct_incidents:r.summary.distinct_incidents,pre_fix:r.bugs[0].counts.pre_fix,post_fix_possible:r.bugs[0].counts.post_fix_possible}));
`);
  const controls = [
    { name: 'baseline', code: original, expected: 0 },
    { name: 'disconnected-error-guard', anchor: 'if (block.is_error !== true)', replacement: 'if (false)', expected: 1, assertion: 'explicit error status/correlation guard' },
    { name: 'inverted-fix-chronology', anchor: 'Date.parse(event.occurred_at) <= Date.parse(fix.committed_at)', replacement: 'Date.parse(event.occurred_at) > Date.parse(fix.committed_at)', expected: 1, assertion: 'only newer failure is possible post-fix|old evidence stays pre-fix' },
    { name: 'omitted-decision-fields', anchor: 'bug.error_message, bug.file ?? null, bug.commit ?? null, bug.reduction ?? null, bug.status ?? "open",', replacement: 'bug.error_message,', expected: 1, assertion: 'conflicting decision fields must degrade coverage' },
    { name: 'silent-unsupported-block', anchor: 'diagnose("unsupported-content-block", file);', replacement: 'void 0;', expected: 1, assertion: 'unsupported tool shapes must degrade coverage' },
    { name: 'silent-unsupported-message', anchor: 'diagnose("unsupported-message-shape", file);', replacement: 'void 0;', expected: 1, assertion: 'unsupported tool shapes must degrade coverage' },
  ];
  const evidence = [];
  for (const control of controls) {
    let code = control.code;
    if (control.anchor) {
      assert.equal(original.split(control.anchor).length - 1, 1, `bind ${control.name} uniquely to production`);
      code = original.replace(control.anchor, control.replacement);
      assert.notEqual(code, original);
    }
    fs.writeFileSync(path.join(root, 'runtime.mjs'), code);
    const child = spawnSync(process.execPath, [probe], { cwd: root, encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, control.expected, `${control.name}: ${child.stderr}`);
    if (control.assertion) assert.match(child.stderr, new RegExp(control.assertion));
    evidence.push({ name: control.name, exit: child.status, production_sha256: sha(original), probe_runtime_sha256: sha(code),
      ...(child.status === 0 ? { observed: JSON.parse(child.stdout) } : { intended_assertion_failed: true }) });
  }
  assert.equal(fs.readFileSync(production, 'utf8'), original, 'production bytes untouched');
  console.log(JSON.stringify({ source: 'compiled production, isolated owned fixture', provenance, controls: evidence }, null, 2));
} finally { cleanupFixture(root); }

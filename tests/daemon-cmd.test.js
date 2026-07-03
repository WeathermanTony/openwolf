import test from 'node:test';
import assert from 'node:assert/strict';
import { isActivePm2Process } from '../dist/src/cli/daemon-cmd.js';

test('PM2 daemon activity requires online status and a live pid', () => {
  assert.equal(isActivePm2Process(null), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'stopped' }, pid: 1234 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'errored' }, pid: 1234 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' } }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' }, pid: 0 }), false);
  assert.equal(isActivePm2Process({ pm2_env: { status: 'online' }, pid: 1234 }), true);
});

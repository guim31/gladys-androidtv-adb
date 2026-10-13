// -----------------------------------------------------------------------------
// scripts/probe.mjs, the check run on a real device after the PR: it reads,
// prints, and sends nothing but the read commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { INFO_COMMAND, STATE_COMMAND } from '../src/tv/commands.js';
import { SHIELD } from './fixtures/devices.js';
import { startFakeAdbd } from './helpers/fakeAdbd.js';
import { simulateDevice } from './helpers/simulator.js';

const run = promisify(execFile);

test('the probe prints the state of a device and changes nothing on it', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-androidtv-adb-probe-'));
  const sim = simulateDevice(SHIELD, {
    app: 'com.netflix.ninja',
    sessions: [{ package: 'com.netflix.ninja', active: true, state: 3 }],
  });
  const adbd = await startFakeAdbd({ respond: sim.respond, autoAccept: true });
  t.after(async () => {
    await adbd.close();
    await rm(dir, { recursive: true, force: true });
  });
  const script = new URL('../scripts/probe.mjs', import.meta.url).pathname;
  const { stdout } = await run(process.execPath, [
    script,
    adbd.address,
    '--raw',
    '--key',
    join(dir, 'probe.key'),
  ]);
  assert.match(stdout, /Device +NVIDIA SHIELD Android TV \(Android 11, API 30\)/);
  assert.match(stdout, /Application +Netflix \(com\.netflix\.ninja\)/);
  assert.match(stdout, /Playback +playing/);
  assert.match(stdout, /Volume +100 % \(15\/15\)/);
  assert.match(stdout, /--- STATE_COMMAND ---/);
  assert.equal(adbd.commands.length, 3);
  assert.deepEqual(adbd.commands.slice(0, 2), [INFO_COMMAND, STATE_COMMAND]);
  assert.ok(adbd.commands.every((c) => !/input |monkey|am start|volume --set/.test(c)));
  assert.deepEqual(sim.log, { keys: [], launches: [], urls: [], volumes: [] });
});

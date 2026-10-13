// -----------------------------------------------------------------------------
// The configuration (address list, interval, language) and what is kept under
// /data (the ADB key, the identified devices).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';
import { Store } from '../src/store.js';
import { recordingLogger } from './helpers/world.js';

test('addresses: separators, ports, pasted URLs, duplicates, mistakes', () => {
  const { hosts, invalid } = parseHosts(
    ' 192.0.2.10, 192.0.2.11:5556;\nadb://192.0.2.12  shield.home, 192.0.2.10:5555, 300.1.1.1, 192.0.2, tv:99999 ',
  );
  assert.deepEqual(
    hosts.map((h) => h.address),
    ['192.0.2.10:5555', '192.0.2.11:5556', '192.0.2.12:5555', 'shield.home:5555'],
  );
  assert.deepEqual(invalid, ['300.1.1.1', '192.0.2', 'tv:99999']);
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
});

test('normalization: defaults, bounds of the interval, unknown language', () => {
  const config = normalizeConfig();
  assert.deepEqual(config.hosts, []);
  assert.equal(config.pollInterval, DEFAULT_CONFIG.poll_interval);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: '2' }).pollInterval, 5);
  assert.equal(normalizeConfig({ poll_interval: 600 }).pollInterval, 60);
  assert.equal(normalizeConfig({ poll_interval: 'abc' }).pollInterval, 10);
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'es' }).language, 'es');
});

test('the ADB key is created once, kept private, and reused', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-androidtv-adb-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const lines = [];
  const first = new Store({ dir, logger: recordingLogger(lines) });
  await first.load();
  assert.match(first.privateKey, /BEGIN PRIVATE KEY/);
  const second = new Store({ dir, logger: recordingLogger(lines) });
  await second.load();
  assert.equal(second.privateKey, first.privateKey, 'the devices keep trusting Gladys');
  assert.ok(!lines.some((l) => l.text.includes('PRIVATE KEY')));
});

test('identified devices are saved, and an address moves to the device that has it now', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-androidtv-adb-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store({ dir, logger: recordingLogger() });
  await store.load();
  assert.equal(store.update('aaa111', { address: '192.0.2.10:5555', model: 'A' }), true);
  assert.equal(store.update('aaa111', { address: '192.0.2.10:5555', model: 'A' }), false);
  store.update('bbb222', { address: '192.0.2.10:5555', model: 'B' });
  assert.equal(store.get('aaa111').address, null);
  assert.equal(store.findByAddress('192.0.2.10:5555').uid, 'bbb222');
  await store.flush();
  const saved = JSON.parse(await readFile(join(dir, 'androidtv-adb.json'), 'utf8'));
  assert.equal(saved.devices.bbb222.model, 'B');

  const reloaded = new Store({ dir, logger: recordingLogger() });
  await reloaded.load();
  assert.equal(reloaded.findByAddress('192.0.2.10:5555').uid, 'bbb222');
});

test('a corrupted state file or a read-only /data are not fatal, and said once', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-androidtv-adb-'));
  t.after(async () => {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(join(dir, 'androidtv-adb.json'), '{not json');
  const lines = [];
  const store = new Store({ dir, logger: recordingLogger(lines) });
  await store.load();
  assert.deepEqual(store.devices, {});
  if (process.getuid?.() === 0) {
    return; // root writes anyway: the read-only case cannot be simulated
  }
  await chmod(dir, 0o500);
  store.update('aaa111', { address: '192.0.2.10:5555' });
  store.update('aaa111', { address: '192.0.2.11:5555' });
  await store.flush();
  assert.equal(lines.filter((l) => l.level === 'warn').length, 1);
});

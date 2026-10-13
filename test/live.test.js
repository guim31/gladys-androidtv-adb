// -----------------------------------------------------------------------------
// The integration end to end, on the SDK's fake Gladys and simulated devices:
// identification, discovery, the container's own refresh (no onPoll from the
// core), standby, scene events, commands, the prompt policy, quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { HEARTBEAT_MS } from '../src/hub.js';
import { registerHandlers } from '../src/app.js';
import { BRAVIA, CHROMECAST, FIRE_TV, SHIELD } from './fixtures/devices.js';
import { createWorld, recordingLogger } from './helpers/world.js';
import { closedPort } from './helpers/fakeAdbd.js';

const NETFLIX = 'com.netflix.ninja';

const feature = (device, key) => `${device.external_id}:${key}`;

test('a configured device is identified and offered in Discovery, by serial number', async (t) => {
  const world = await createWorld(t, { create: false });
  const [device] = world.gladys.fake.discoveredDevices;
  assert.equal(device.name, 'NVIDIA SHIELD Android TV');
  assert.equal(device.external_id, 'ext:test-integration:androidtv:0423119000001');
  assert.deepEqual(device.params, [{ name: 'ADB_ADDRESS', value: world.devices[0].adbd.address }]);
  const app = device.features.find((f) => f.external_id === feature(device, 'app'));
  assert.ok(app.supported_options.some((o) => o.value === NETFLIX && o.label === 'Netflix'));
  assert.ok(
    !app.supported_options.some((o) => o.value === 'com.nvidia.ota'),
    'a service without launcher is not offered',
  );
  assert.ok(device.features.some((f) => f.external_id === feature(device, 'volume')));
  // Not added to Gladys: no state is sent for it.
  assert.equal(world.gladys.fake.states.length, 0);

  // The key and the known device are kept under /data.
  const keyFile = await stat(join(world.dataDir, 'adbkey'));
  assert.equal(keyFile.mode & 0o777, 0o600);
  await world.app.store.flush();
  const saved = JSON.parse(await readFile(join(world.dataDir, 'androidtv-adb.json'), 'utf8'));
  assert.equal(saved.devices['0423119000001'].address, world.devices[0].adbd.address);
});

test('an added device gets its states, and the widget is refreshed', async (t) => {
  const world = await createWorld(t, {
    initial: { app: NETFLIX, sessions: [{ package: NETFLIX, active: true, state: 3 }] },
  });
  const device = world.gladysDevice(world.devices[0]);
  const { fake } = world.gladys;
  assert.equal(fake.lastState(feature(device, 'power')), 1);
  assert.equal(fake.lastState(feature(device, 'app')), NETFLIX);
  assert.equal(fake.lastState(feature(device, 'playback')), 'playing');
  assert.equal(fake.lastState(feature(device, 'volume')), 100);
  assert.ok(fake.widgetRefreshes.includes('remote'));
});

test('the container reads by itself, without any onPoll from the core (Gladys#3198)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const world = await createWorld(t, { timers: true });
  const [{ sim, adbd }] = world.devices;
  const device = world.gladysDevice(world.devices[0]);
  const reads = () => adbd.commands.filter((c) => c.startsWith("echo '##power'")).length;
  const before = reads();

  sim.state.app = NETFLIX;
  t.mock.timers.tick(10_000);
  await waitFor(() => world.gladys.fake.lastState(feature(device, 'app')) === NETFLIX);
  assert.equal(reads(), before + 1);

  t.mock.timers.tick(10_000);
  await waitFor(() => reads() === before + 2);
  assert.ok(
    !world.gladys.fake.wsMessages.some((m) => /poll/i.test(m.type)),
    'no poll came from the core',
  );

  // The core's fallback onPoll does not read again right after the timer.
  await world.gladys.fake.poll(device);
  assert.equal(reads(), before + 2);
});

test('unchanged values are not sent again, until the heartbeat', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const world = await createWorld(t);
  const count = () => world.gladys.fake.states.length;
  const after = count();
  await world.readAll();
  await world.readAll();
  assert.equal(count(), after, 'nothing changed, nothing sent');
  t.mock.timers.tick(HEARTBEAT_MS + 1000);
  await world.readAll();
  assert.ok(count() > after, 'the heartbeat re-sends the unchanged values');
});

test('standby: shown off, connection closed, read every minute', async (t) => {
  const world = await createWorld(t);
  const [{ sim, adbd }] = world.devices;
  const device = world.gladysDevice(world.devices[0]);
  const tv = world.tvOf(world.devices[0]);
  assert.equal(world.hub.periodMs(tv), 10_000);

  sim.state.screenOn = false;
  await world.readAll();
  assert.equal(world.gladys.fake.lastState(feature(device, 'power')), 0);
  assert.equal(world.gladys.fake.lastState(feature(device, 'playback')), 'off');
  assert.equal(tv.connection, null, 'no connection kept to a sleeping device');
  await waitFor(() => adbd.open.size === 0);
  assert.equal(world.hub.periodMs(tv), 60_000);

  // The screensaver is "on", not standby.
  sim.state.screenOn = true;
  sim.state.dreaming = true;
  await world.readAll();
  assert.equal(world.gladys.fake.lastState(feature(device, 'playback')), 'screensaver');
  assert.equal(world.gladys.fake.lastState(feature(device, 'power')), 1);
});

test('scene events: an application opened, playback started then paused', async (t) => {
  const world = await createWorld(t);
  const [{ sim }] = world.devices;
  const device = world.gladysDevice(world.devices[0]);
  const events = () => world.gladys.fake.sceneEvents;
  assert.deepEqual(events(), [], 'nothing on the first read');

  sim.state.app = NETFLIX;
  await world.readAll();
  sim.state.sessions = [{ package: NETFLIX, active: true, state: 3 }];
  await world.readAll();
  // Buffering between two episodes: not a new state.
  sim.state.sessions = [{ package: NETFLIX, active: true, state: 6 }];
  await world.readAll();
  sim.state.sessions = [{ package: NETFLIX, active: true, state: 2 }];
  await world.readAll();

  assert.deepEqual(
    events().map((e) => [e.key, e.data.app ?? e.data.state]),
    [
      ['app_opened', 'netflix'],
      ['playback_changed', 'playing'],
      ['playback_changed', 'paused'],
    ],
  );
  assert.deepEqual(events()[0].data, {
    device: device.external_id,
    device_name: device.name,
    package: NETFLIX,
    app_name: 'Netflix',
    app: 'netflix',
  });

  // Asleep: no event.
  sim.state.screenOn = false;
  sim.state.app = 'com.google.android.youtube.tv';
  await world.readAll();
  assert.equal(events().length, 3);
});

test('a device that stops answering is shown off after two misses, logged once', async (t) => {
  const world = await createWorld(t);
  const [{ adbd }] = world.devices;
  const device = world.gladysDevice(world.devices[0]);
  world.lines.length = 0;
  await adbd.close();
  await world.readAll();
  assert.equal(world.gladys.fake.lastState(feature(device, 'power')), 1, 'one miss is noise');
  await world.readAll();
  await world.readAll();
  assert.equal(world.gladys.fake.lastState(feature(device, 'power')), 0);
  const notDebug = world.lines.filter((l) => l.level !== 'debug');
  assert.equal(notDebug.length, 1, notDebug.map((l) => l.text).join('\n'));
  assert.match(notDebug[0].text, /unreachable/);
});

test('the prompt opens once by itself, then only through "Connect the devices"', async (t) => {
  const world = await createWorld(t, { autoAccept: false, create: false });
  const [{ adbd }] = world.devices;
  const tv = world.tvOf(world.devices[0]);
  assert.equal(adbd.prompts, 1, 'first contact: the device shows the prompt');
  assert.equal(tv.status, 'unauthorized');
  const status = world.gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Toujours autoriser/);
  assert.ok(status.message.fr.includes(adbd.address));

  await world.readAll();
  await world.readAll();
  assert.equal(adbd.prompts, 1, 'background reads never prompt again');

  // The user runs the action and taps "Allow" on the TV.
  const running = world.gladys.fake.action('connect', {});
  await waitFor(() => adbd.prompts === 2);
  adbd.accept();
  const ack = await running;
  assert.equal(ack.success, true);
  assert.match(ack.data.message.fr, /connecté à NVIDIA SHIELD Android TV/);
  assert.match(ack.data.message.fr, /Clé de Gladys : ([0-9A-F]{2}:){15}[0-9A-F]{2}/);
  assert.equal(world.gladys.fake.discoveredDevices.length, 1);
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('an address where nothing answers is reported, with what to check', async (t) => {
  const port = await closedPort();
  const gladys = createFakeGladys({ config: { hosts: `127.0.0.1:${port}, 300.1.2.3` } });
  const lines = [];
  const app = registerHandlers(gladys, {
    dataDir: await mkdtemp(join(tmpdir(), 'gladys-androidtv-adb-')),
    timers: false,
    logger: recordingLogger(lines),
  });
  t.after(() => app.stop());
  await gladys.connect();
  const { connected, message } = gladys.fake.connectionStatus;
  assert.equal(connected, false);
  assert.match(message.en, /Not an IP address: 300\.1\.2\.3/);
  assert.match(message.en, /Never reached: 127\.0\.0\.1/);
  const ack = await gladys.fake.action('connect', {});
  assert.match(ack.data.message.de, /nicht erreichbar/);
});

test('commands: power, application, volume and keys', async (t) => {
  const world = await createWorld(t);
  const [{ sim, adbd }] = world.devices;
  const device = world.gladysDevice(world.devices[0]);
  const { fake } = world.gladys;
  const set = (key, value) =>
    fake.setValue(
      device,
      device.features.find((f) => f.external_id === feature(device, key)),
      value,
    );

  assert.deepEqual(await set('power', 0), { success: true });
  assert.equal(sim.state.screenOn, false);
  assert.deepEqual(await set('power', 0), { success: true });
  assert.equal(sim.state.screenOn, false, 'already off: the POWER toggle is not sent');
  await set('power', 1);
  assert.equal(sim.state.screenOn, true);

  await set('app', NETFLIX);
  assert.equal(sim.state.app, NETFLIX);
  assert.deepEqual(sim.log.launches.at(-1), {
    pkg: NETFLIX,
    category: 'android.intent.category.LEANBACK_LAUNCHER',
  });
  const failed = await set('app', 'com.example.missing');
  assert.equal(failed.success, false);
  assert.match(failed.error, /n'est pas installée/);
  const injected = await set('app', 'com.netflix.ninja; reboot');
  assert.equal(injected.success, false);
  assert.ok(!adbd.commands.some((c) => c.includes('reboot')), 'never sent');

  await set('volume', 40);
  assert.deepEqual(sim.log.volumes.at(-1), {
    index: 6,
    command: 'cmd media_session volume --show --stream 3 --set 6',
  });

  await set('key-home', 1);
  await set('key-mute', 1);
  assert.deepEqual(sim.log.keys.slice(-2), [3, 164]);

  // One info line per user action, none for the reads.
  const info = world.lines.filter((l) => l.level === 'info').map((l) => l.text);
  assert.ok(info.some((text) => /SHIELD Android TV: launch Netflix/.test(text)));
});

test('Fire TV: LAUNCHER first, SLEEP to turn off, the Fire TV YouTube package', async (t) => {
  const world = await createWorld(t, { profiles: [FIRE_TV] });
  const [{ sim }] = world.devices;
  const device = world.gladysDevice(world.devices[0]);
  const ack = await world.gladys.fake.sceneAction('launch_app', {
    device: device.external_id,
    app: 'youtube',
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(sim.state.app, 'com.amazon.firetv.youtube');
  assert.equal(sim.log.launches[0].category, 'android.intent.category.LAUNCHER');
  await world.gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === feature(device, 'power')),
    0,
  );
  assert.deepEqual(sim.log.keys.at(-1), 223);
});

test('scene actions: keys, addresses, and what they refuse', async (t) => {
  const world = await createWorld(t, { profiles: [CHROMECAST] });
  const [{ sim, adbd }] = world.devices;
  const device = world.gladysDevice(world.devices[0]);
  const run = (key, fields) =>
    world.gladys.fake.sceneAction(key, { device: device.external_id, ...fields });

  assert.equal((await run('send_key', { key: 'right', count: 3 })).success, true);
  assert.deepEqual(sim.log.keys, [22, 22, 22]);
  assert.equal((await run('send_key', { key: 'reboot' })).success, false);

  const youtube = await run('open_url', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(youtube.success, true, youtube.error);
  assert.equal(sim.state.app, 'com.google.android.youtube.tv');
  const stream = await run('open_url', { url: 'rtmp://192.0.2.20/live/cam' });
  assert.equal(stream.success, false);
  assert.match(stream.error, /Aucune application/);
  for (const url of ['file:///data/local/tmp/x', "https://x.org/' ; reboot ; '"]) {
    const refused = await run('open_url', { url });
    assert.equal(refused.success, false, url);
  }
  assert.ok(!adbd.commands.some((c) => c.includes('reboot') || c.includes('file:')));

  assert.equal((await run('launch_app', { package: 'tv.molotov.app' })).success, true);
  assert.equal(sim.state.app, 'tv.molotov.app');
  assert.equal((await run('launch_app', {})).success, false);
  const home = await run('launch_app', { app: 'home' });
  assert.equal(home.success, true);
  assert.equal(sim.state.app, CHROMECAST.launcher);
});

test('a device without query-activities still offers its known applications', async (t) => {
  const world = await createWorld(t, { profiles: [BRAVIA], create: false });
  const [device] = world.gladys.fake.discoveredDevices;
  const options = device.features.find(
    (f) => f.external_id === feature(device, 'app'),
  ).supported_options;
  assert.deepEqual(
    options.map((o) => o.label),
    ['YouTube', 'Netflix', "Écran d'accueil"].sort((a, b) => a.localeCompare(b, 'fr')),
  );
});

test('the configuration: an address removed is let go, an address added is identified', async (t) => {
  const world = await createWorld(t, { profiles: [SHIELD, FIRE_TV] });
  const [shield, fire] = world.devices;
  assert.equal(world.gladys.fake.discoveredDevices.length, 2);
  await world.gladys.fake.configUpdated({ hosts: fire.adbd.address, language: 'fr' });
  assert.equal(world.hub.tvs.size, 1);
  assert.equal(world.gladys.fake.discoveredDevices.length, 1);
  await waitFor(() => shield.adbd.open.size === 0);
});

test('a normal cycle writes nothing at the info level, and never the ADB key', async (t) => {
  const world = await createWorld(t, { profiles: [SHIELD, CHROMECAST] });
  const startup = world.lines.map((l) => l.text);
  assert.ok(startup.some((text) => /connected to NVIDIA SHIELD Android TV/.test(text)));
  world.lines.length = 0;
  for (const { sim } of world.devices) {
    sim.state.app = NETFLIX;
    sim.state.sessions = [{ package: NETFLIX, active: true, state: 3 }];
  }
  await world.readAll();
  await world.readAll();
  for (const { sim } of world.devices) {
    sim.state.screenOn = false;
  }
  await world.readAll();
  await world.readAll();
  const loud = world.lines.filter((l) => l.level !== 'debug');
  assert.deepEqual(loud, []);

  const key = world.app.store.privateKey;
  const body = key.split('\n').filter((line) => line && !line.startsWith('-----'));
  const everything = [...startup, ...world.lines.map((l) => l.text)].join('\n');
  for (const line of body) {
    assert.ok(!everything.includes(line), 'the private key never reaches the logs');
  }
});

// Real time (performance.now), as Date and setTimeout may be mocked.
async function waitFor(condition, timeoutMs = 3000) {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error('condition not met');
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

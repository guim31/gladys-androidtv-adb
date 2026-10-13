// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the integration registered on
// it (src/app.js), and simulated devices behind fake adbd servers on
// 127.0.0.1. Nothing leaves the machine.
// -----------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { SHIELD } from '../fixtures/devices.js';
import { startFakeAdbd } from './fakeAdbd.js';
import { simulateDevice } from './simulator.js';

/** A logger that keeps its lines: [{ level, text }]. */
export function recordingLogger(lines = []) {
  const write =
    (level) =>
    (...args) =>
      lines.push({
        level,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  return {
    lines,
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: () => recordingLogger(lines),
  };
}

/**
 * @param {import('node:test').TestContext} t
 * @param {object} [options]
 * @param {object[]} [options.profiles] device profiles (test/fixtures/devices.js)
 * @param {object} [options.initial] initial simulated state, for every device
 * @param {boolean} [options.autoAccept] the user accepts the debugging prompt at once
 * @param {boolean} [options.create] add every discovered device to Gladys
 * @param {object} [options.config] extra configuration values
 * @param {boolean} [options.timers] run the integration's reading timers
 */
export async function createWorld(t, options = {}) {
  const {
    profiles = [SHIELD],
    initial = {},
    autoAccept = true,
    create = true,
    config = {},
    timers = false,
  } = options;
  const dataDir = await mkdtemp(join(tmpdir(), 'gladys-androidtv-adb-'));
  const logger = recordingLogger();
  const devices = [];
  for (const profile of profiles) {
    const sim = simulateDevice(profile, initial);
    const adbd = await startFakeAdbd({ respond: sim.respond, autoAccept });
    devices.push({ profile, sim, adbd });
  }
  const gladys = createFakeGladys({
    config: {
      hosts: devices.map((d) => d.adbd.address).join(', '),
      poll_interval: 10,
      language: 'fr',
      ...config,
    },
  });
  // The user answers the prompt within a second, or never.
  const app = registerHandlers(gladys, { dataDir, timers, logger, promptTimeoutMs: 1000 });
  t.after(async () => {
    await app.stop();
    await Promise.all(devices.map((d) => d.adbd.close()));
    await rm(dataDir, { recursive: true, force: true });
  });
  await gladys.connect();
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
  }
  const hub = app.hub;
  const tvOf = (device) => hub.tvs.get(device.adbd.address);
  return {
    gladys,
    app,
    hub,
    devices,
    dataDir,
    logger,
    lines: logger.lines,
    tvOf,
    /** The Gladys device of a simulated device. */
    gladysDevice: (device) => {
      const tv = tvOf(device);
      return gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(`:${tv.uid}`));
    },
    /** One forced read of every device. */
    readAll: () => Promise.all(devices.map((device) => hub.read(tvOf(device), { force: true }))),
  };
}

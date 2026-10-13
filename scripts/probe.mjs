#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe one device from a computer, with the integration's own ADB code:
//
//   node scripts/probe.mjs <ip[:port]> [--raw] [--key <file>]
//
// It connects (the screen asks "Allow debugging?" the first time: accept),
// then prints who the device is, its screen state, the application on
// screen, the playback state, the volume and the installed applications. It
// changes nothing on the device: no key press, no launch, no setting — only
// the read commands of src/tv/commands.js.
//
// --raw   also prints the raw outputs, to turn into test fixtures. They hold
//         the serial number and the MAC addresses: anonymize them first.
// --key   the private key to use (created if missing). Default:
//         ~/.gladys-androidtv-adb-probe.key, so the device asks only once.
// -----------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AdbConnection, DEFAULT_PORT } from '../src/adb/connection.js';
import { generatePrivateKey, keyFingerprint } from '../src/adb/keys.js';
import { appName } from '../src/tv/apps.js';
import { INFO_COMMAND, STATE_COMMAND, installedAppsCommand } from '../src/tv/commands.js';
import {
  isFireTv,
  parseInfo,
  parseInstalledApps,
  parseState,
  platformId,
} from '../src/tv/parse.js';

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--key');
const raw = args.includes('--raw');
const keyPath = args.includes('--key')
  ? args[args.indexOf('--key') + 1]
  : join(homedir(), '.gladys-androidtv-adb-probe.key');

if (!target) {
  console.error('Usage: node scripts/probe.mjs <ip[:port]> [--raw] [--key <file>]');
  process.exit(2);
}

const [host, portText] = target.split(':');
const port = portText ? Number(portText) : DEFAULT_PORT;

async function loadKey() {
  try {
    return await readFile(keyPath, 'utf8');
  } catch {
    const key = generatePrivateKey();
    await writeFile(keyPath, key, { mode: 0o600 });
    console.log(`New key written to ${keyPath}`);
    return key;
  }
}

const privateKey = await loadKey();
console.log(`Key fingerprint (compare with the screen): ${keyFingerprint(privateKey)}`);
console.log(`Connecting to ${host}:${port}… accept the prompt on the screen if it shows.`);

const connection = new AdbConnection({ host, port, privateKey, connectTimeoutMs: 8000 });
try {
  const { banner } = await connection.connect({ sendPublicKey: true, authTimeoutMs: 120_000 });
  const infoOutput = await connection.shell(INFO_COMMAND);
  const info = parseInfo(infoOutput);
  const started = Date.now();
  const stateOutput = await connection.shell(STATE_COMMAND, { timeoutMs: 15_000 });
  const readMs = Date.now() - started;
  const state = parseState(stateOutput);
  const appsOutput = await connection.shell(installedAppsCommand(isFireTv(info)), {
    timeoutMs: 15_000,
  });
  const apps = parseInstalledApps(appsOutput);

  console.log('');
  console.log(
    `Device        ${info.manufacturer} ${info.model} (Android ${info.androidVersion}, API ${info.sdk})`,
  );
  console.log(`Platform id   ${platformId(info) ?? '(none: no serial nor MAC)'}`);
  console.log(`Fire TV       ${isFireTv(info) ? 'yes' : 'no'}`);
  console.log(
    `Screen        ${state.screenOn === null ? 'unknown' : state.screenOn ? 'on' : 'off'} (${state.wakefulness ?? '?'})`,
  );
  console.log(
    `Application   ${state.app ? `${appName(state.app, 'en')} (${state.app})` : 'unknown'}`,
  );
  console.log(`Playback      ${state.playback}`);
  console.log(
    `Volume        ${state.audio.percent === null ? 'not readable' : `${state.audio.percent} % (${state.audio.index}/${state.audio.max})`}${state.audio.muted ? ', muted' : ''}`,
  );
  console.log(
    `Launchable    ${apps.launchable.length} (query-activities ${apps.launchable.length ? 'works' : 'gave nothing'})`,
  );
  console.log(`Packages      ${apps.packages.length}`);
  console.log(`State read    ${readMs} ms`);
  if (raw) {
    console.log('\n--- banner ---\n' + banner);
    console.log('--- INFO_COMMAND ---\n' + infoOutput);
    console.log('--- STATE_COMMAND ---\n' + stateOutput);
    console.log('--- installed apps ---\n' + appsOutput);
    console.log('(anonymize the serial number and the MAC addresses before committing these)');
  }
} catch (err) {
  console.error(`Failed: ${err.code ?? ''} ${err.message}`);
  process.exitCode = 1;
} finally {
  connection.close();
}

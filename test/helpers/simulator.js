// -----------------------------------------------------------------------------
// A simulated Android TV behind the fake adbd: it answers the commands of
// src/tv/commands.js in the output format of its profile
// (test/fixtures/devices.js), and the keys, launches and volume commands
// change its state like the real device would.
// -----------------------------------------------------------------------------

import { INFO_COMMAND, STATE_COMMAND } from '../../src/tv/commands.js';
import { ACTIVITIES } from '../fixtures/devices.js';

const activityOf = (pkg) => ACTIVITIES[pkg] ?? '.MainActivity';

function powerLines(state) {
  const wakefulness = state.screenOn ? (state.dreaming ? 'Dreaming' : 'Awake') : 'Asleep';
  return [`  mWakefulness=${wakefulness}`, `Display Power: state=${state.screenOn ? 'ON' : 'OFF'}`];
}

function appLines(profile, state) {
  const record = `ActivityRecord{6b2e6c1 u0 ${state.app}/${activityOf(state.app)} t1123}`;
  switch (profile.dialect.activity) {
    case 'android12':
      return [
        `        topResumedActivity=${record}`,
        `        ResumedActivity: ${record}`,
        `  ResumedActivity: ${record}`,
      ];
    case 'window':
      // Activity dump not matched: the window lines (python-androidtv tests).
      return [
        `  mCurrentFocus=Window{e74bb23 u0 ${state.app}/${state.app}${activityOf(state.app)}}`,
        `  mFocusedApp=AppWindowToken{c791eb8 token=Token{a6bad1b ActivityRecord{35dbb2a u0 ${state.app}/${activityOf(state.app)} t2719}}}`,
      ];
    default:
      return [`    mResumedActivity: ${record}`, `  ResumedActivity: ${record}`];
  }
}

const STATE_NAMES = { 0: 'NONE', 1: 'STOPPED', 2: 'PAUSED', 3: 'PLAYING', 6: 'BUFFERING' };

function mediaLines(profile, state) {
  return state.sessions.flatMap((session) => {
    const code =
      profile.dialect.media === 'named'
        ? `${STATE_NAMES[session.state] ?? 'NONE'}(${session.state})`
        : `${session.state}`;
    return [
      `      package=${session.package}`,
      `      active=${session.active}`,
      `      state=PlaybackState {state=${code}, position=1234567, buffered position=0, speed=1.0, updated=98765432, actions=3669, custom actions=[], active item id=-1, error=null}`,
    ];
  });
}

function audioLines(profile, state) {
  const { device, max, layout } = profile.audio;
  const index = state.volumeIndex;
  if (layout === 'sony') {
    // python-androidtv tests/test_androidtv_async.py STREAM_MUSIC_ON
    return [
      '- STREAM_MUSIC:',
      `   Muted: ${state.muted}`,
      '   Min: 0',
      `   Max: ${max}`,
      `   Current: 2 (speaker): 20, 40000 (hmdi_arc): ${index}, 40000000 (default): 15`,
      `   Devices: ${device}`,
      '- STREAM_ALARM:',
      '   Muted: false',
      '   Min: 0',
      '   Max: 7',
      '   Current: 2 (speaker): 3, 40000 (hmdi_arc): 3, 40000000 (default): 2',
      '   Devices: speaker',
    ];
  }
  const lines = ['- STREAM_MUSIC:', `   Muted: ${state.muted}`];
  if (layout === 'android11') {
    lines.push('   Muted Internally: false');
  }
  lines.push('   Min: 0', `   Max: ${max}`);
  if (layout === 'android11') {
    lines.push(`   streamVolume:${index}`);
  }
  lines.push(
    `   Current: 2 (speaker): 9, 400 (${device}): ${index}, 40000000 (default): 9`,
    `   Devices: ${device}`,
    '- STREAM_ALARM:',
    '   Muted: false',
    '   Min: 1',
    '   Max: 7',
  );
  return lines;
}

/**
 * @param {object} profile a profile of test/fixtures/devices.js
 * @param {object} [initial] { screenOn, app, sessions, volumeIndex, muted }
 */
export function simulateDevice(profile, initial = {}) {
  const state = {
    screenOn: true,
    dreaming: false,
    app: profile.launcher,
    sessions: [],
    volumeIndex: profile.audio.index,
    muted: profile.audio.muted,
    ...initial,
  };
  const log = { keys: [], launches: [], urls: [], volumes: [] };

  function info() {
    const { manufacturer, model, serial, release, sdk, eth, wlan } = profile.info;
    const ether = (mac) => (mac ? `    link/ether ${mac} brd ff:ff:ff:ff:ff:ff` : '');
    return [
      `manufacturer=${manufacturer}`,
      `model=${model}`,
      `serial=${serial}`,
      `release=${release}`,
      `sdk=${sdk}`,
      `eth=${ether(eth)}`,
      `wlan=${ether(wlan)}`,
      '',
    ].join('\n');
  }

  function stateOutput() {
    return [
      '##power',
      ...powerLines(state),
      '##app',
      ...appLines(profile, state),
      '##media',
      ...mediaLines(profile, state),
      '##audio',
      ...audioLines(profile, state),
      '##end',
      '',
    ].join('\n');
  }

  function apps() {
    const launchable = profile.installed.filter((pkg) => !profile.services.includes(pkg));
    return [
      '##launchable',
      ...(profile.queryComponents ? launchable.map((pkg) => `${pkg}/${activityOf(pkg)}`) : []),
      '##packages',
      ...profile.installed.map((pkg) => `package:${pkg}`),
      '',
    ].join('\n');
  }

  function press(code) {
    log.keys.push(code);
    if (code === 26) {
      state.screenOn = !state.screenOn;
    } else if (code === 223) {
      state.screenOn = false;
    } else if (code === 224) {
      state.screenOn = true;
    } else if (code === 3) {
      state.app = profile.launcher;
    } else if (code === 164) {
      state.muted = !state.muted;
    }
  }

  function respond(command) {
    if (command === INFO_COMMAND) {
      return info();
    }
    if (command === STATE_COMMAND) {
      return stateOutput();
    }
    if (command.includes('##launchable')) {
      return apps();
    }
    // powerCommand: "<screen on test> || <wake keys>" / "<screen on test> && <sleep key>".
    if (command.startsWith('(dumpsys power')) {
      const [, operator, keys] = command.match(/\) (\|\||&&) (.*)$/);
      if ((operator === '||') !== state.screenOn) {
        for (const code of keys.match(/\d+/g)) {
          press(Number(code));
        }
      }
      return '';
    }
    const launch = command.match(/^monkey -p (\S+) -c (\S+) /);
    if (launch) {
      const [, pkg, category] = launch;
      log.launches.push({ pkg, category });
      if (
        category === profile.launchCategory &&
        profile.installed.includes(pkg) &&
        !profile.services.includes(pkg)
      ) {
        state.app = pkg;
        state.screenOn = true;
        return 'Events injected: 1\n## Network stats: elapsed time=12ms (0ms mobile, 0ms wifi, 12ms not connected)\n';
      }
      return '** No activities found to run, monkey aborted.\n';
    }
    const url = command.match(/^am start -a android\.intent\.action\.VIEW -d '(.*)'( \S+)? 2>&1$/);
    if (url) {
      log.urls.push({ url: url[1], pkg: url[2]?.trim() });
      if (url[1].startsWith('rtmp:')) {
        return `Starting: Intent { act=android.intent.action.VIEW dat=${url[1]} }\nError: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW dat=${url[1]} flg=0x10000000 }\n`;
      }
      if (/youtube\.com|youtu\.be/.test(url[1])) {
        state.app = profile.installed.find((pkg) => pkg.includes('youtube')) ?? state.app;
      }
      return `Starting: Intent { act=android.intent.action.VIEW dat=${url[1]} }\n`;
    }
    const volume = command.match(/volume --show --stream 3 --set (\d+)$/);
    if (volume) {
      log.volumes.push({ index: Number(volume[1]), command });
      state.volumeIndex = Number(volume[1]);
      return '';
    }
    const keys = command.match(/input keyevent (\d+)/g);
    if (keys) {
      for (const key of keys) {
        press(Number(key.match(/\d+/)[0]));
      }
      return '';
    }
    return `/system/bin/sh: unexpected command\n`;
  }

  return { state, log, respond };
}

// -----------------------------------------------------------------------------
// Reading the device outputs (per model) and building the shell commands
// (fixed templates only: nothing a user types can become shell code).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INFO_COMMAND,
  STATE_COMMAND,
  isValidPackage,
  keyCommand,
  launchCommand,
  normalizeUrl,
  openUrlCommand,
  powerCommand,
  volumeCommand,
} from '../src/tv/commands.js';
import {
  currentPlayback,
  parseAudio,
  parseCurrentApp,
  parseInfo,
  parseInstalledApps,
  parseMediaSessions,
  parsePower,
  parseState,
  platformId,
  playbackFromCode,
} from '../src/tv/parse.js';
import { ANDROID13, BRAVIA, CHROMECAST, FIRE_TV, PROFILES, SHIELD } from './fixtures/devices.js';
import { simulateDevice } from './helpers/simulator.js';

for (const profile of PROFILES) {
  test(`${profile.label}: identity, foreground app, playback and volume are read`, () => {
    const playing = profile.installed.find((pkg) => pkg === 'com.netflix.ninja');
    const device = simulateDevice(profile, {
      app: playing,
      sessions: [
        { package: 'com.spotify.tv.android', active: false, state: 2 },
        { package: playing, active: true, state: 3 },
      ],
    });
    const info = parseInfo(device.respond(INFO_COMMAND));
    assert.equal(info.manufacturer, profile.info.manufacturer);
    assert.equal(info.model, profile.info.model);
    assert.match(platformId(info), /^[a-z0-9]{4,}$/);

    const state = parseState(device.respond(STATE_COMMAND));
    assert.equal(state.screenOn, true);
    assert.equal(state.wakefulness, 'Awake');
    assert.equal(state.app, 'com.netflix.ninja');
    assert.equal(state.playback, 'playing');
    assert.equal(state.audio.max, profile.audio.max);
    assert.equal(state.audio.index, profile.audio.index);
    assert.equal(state.audio.muted, profile.audio.muted);
    assert.equal(state.audio.percent, Math.round((profile.audio.index / profile.audio.max) * 100));

    device.state.screenOn = false;
    assert.equal(parseState(device.respond(STATE_COMMAND)).screenOn, false);

    const { launchable, packages } = parseInstalledApps(device.respond('##launchable'));
    assert.deepEqual(packages, profile.installed);
    if (profile.queryComponents) {
      assert.ok(launchable.includes('com.netflix.ninja'));
      for (const service of profile.services) {
        assert.ok(!launchable.includes(service), `${service} has no launcher`);
      }
    } else {
      assert.deepEqual(launchable, []);
    }
  });
}

test('the platform id is the serial, else the Ethernet then Wi-Fi MAC', () => {
  assert.equal(
    platformId(parseInfo(simulateDevice(SHIELD).respond(INFO_COMMAND))),
    '0423119000001',
  );
  assert.equal(
    platformId(parseInfo(simulateDevice(FIRE_TV).respond(INFO_COMMAND))),
    'g070vm0000000001',
  );
  // No serial (empty getprop): the Ethernet MAC.
  assert.equal(
    platformId(parseInfo(simulateDevice(ANDROID13).respond(INFO_COMMAND))),
    '00005e005307',
  );
  assert.equal(platformId(parseInfo('serial=\neth=\nwlan=\n')), null);
  // The SDK patterns: a Wi-Fi MAC only (python-androidtv WIFIMAC_OUTPUT1 shape).
  const info = parseInfo(
    'serial=unknown\neth=\nwlan=    link/ether 00:00:5e:00:53:aa brd ff:ff:ff:ff:ff:ff\n',
  );
  assert.equal(platformId(info), '00005e0053aa');
});

test('the foreground app, from the python-androidtv samples', () => {
  // tests/test_constants.py: test_current_app_extraction_atv_launcher
  assert.equal(
    parseCurrentApp(`
            mCurrentFocus=Window{e74bb23 u0 com.google.android.tvlauncher/com.google.android.tvlauncher.MainActivity}
            mFocusedApp=AppWindowToken{c791eb8 token=Token{a6bad1b ActivityRecord{35dbb2a u0 com.google.android.tvlauncher/.MainActivity t2719}}}
        `),
    'com.google.android.tvlauncher',
  );
  // ..._atv_launcher_google_tv
  assert.equal(
    parseCurrentApp(
      '            mResumedActivity: ActivityRecord{35dbb2a u0 com.google.android.tvlauncher/.MainActivity t2719}',
    ),
    'com.google.android.tvlauncher',
  );
  // ..._sony_picture_off: the focused app wins over a system overlay window.
  assert.equal(
    parseCurrentApp(`
            mCurrentFocus=Window{c52eaa8 u0 com.sony.dtv.sonysystemservice}
            mFocusedApp=AppWindowToken{11da138 token=Token{19ea99b ActivityRecord{c4d9aa u0 tunein.player/tunein.ui.leanback.ui.activities.TvHomeActivity t2424}}}
        `),
    'tunein.player',
  );
  // ..._intent_with_no_activity
  assert.equal(
    parseCurrentApp('            mCurrentFocus=Window{c52eaa8 u0 com.sony.dtv.sonysystemservice}'),
    'com.sony.dtv.sonysystemservice',
  );
  assert.equal(parseCurrentApp('  mCurrentFocus=null\n  mFocusedApp=null'), null);
  assert.equal(parseCurrentApp(''), null);
});

test('the top resumed activity wins over the other stacks (Android 12+)', () => {
  assert.equal(
    parseCurrentApp(
      [
        '    mResumedActivity: ActivityRecord{1 u0 com.google.android.apps.mediashell/.MainActivity t9}',
        '        topResumedActivity=ActivityRecord{2 u0 com.netflix.ninja/.MainActivity t10}',
      ].join('\n'),
    ),
    'com.netflix.ninja',
  );
});

test('screen state: Display Power, then mScreenOn, then the display service', () => {
  assert.deepEqual(parsePower('  mWakefulness=Dreaming\nDisplay Power: state=ON'), {
    screenOn: true,
    wakefulness: 'Dreaming',
  });
  assert.equal(parsePower('  mWakefulness=Asleep\nDisplay Power: state=OFF').screenOn, false);
  assert.equal(parsePower('  mWakefulness=Awake\nDisplay Power: state=DOZE').screenOn, false);
  assert.equal(parsePower('mScreenOn=true').screenOn, true);
  assert.equal(parsePower('  mWakefulness=Awake\n    mScreenState=OFF').screenOn, false);
  assert.equal(parsePower('  mWakefulness=Asleep').screenOn, false);
  assert.equal(parsePower('').screenOn, null);
});

test('playback: the session of the foreground app, else one playing in the background', () => {
  // python-androidtv tests/test_basetv_sync.py MEDIA_SESSION_STATE_OUTPUT (state=2)
  const fireLauncher = parseMediaSessions(
    '      package=com.amazon.tv.launcher\nstate=PlaybackState {state=2, position=0, buffered position=0, speed=0.0, updated=65749, actions=240640, custom actions=[], active item id=-1, error=null}',
  );
  assert.equal(currentPlayback(fireLauncher, 'com.amazon.tv.launcher'), 'paused');
  const sessions = parseMediaSessions(
    [
      '      package=com.spotify.tv.android',
      '      active=true',
      '      state=PlaybackState {state=3, position=1, buffered position=0, speed=1.0, updated=1, actions=1, custom actions=[], active item id=-1, error=null}',
      '      package=com.netflix.ninja',
      '      active=false',
      '      state=PlaybackState {state=PAUSED(2), position=1, buffered position=0, speed=0.0, updated=1, actions=1, custom actions=[], active item id=-1, error=null}',
    ].join('\n'),
  );
  assert.equal(currentPlayback(sessions, 'com.netflix.ninja'), 'paused');
  assert.equal(
    currentPlayback(sessions, 'com.google.android.tvlauncher'),
    'playing',
    'music in the background',
  );
  assert.equal(currentPlayback([], 'com.netflix.ninja'), 'idle');
  assert.equal(playbackFromCode(6), 'transient', 'buffering keeps the previous state');
  assert.equal(playbackFromCode(1), 'stopped');
  assert.equal(playbackFromCode(7), 'stopped');
});

test('volume: the current output device, Android 11 streamVolume, no block at all', () => {
  // python-androidtv STREAM_MUSIC_OFF: the speaker is the current device.
  const off = parseAudio(`- STREAM_MUSIC:
   Muted: false
   Min: 0
   Max: 60
   Current: 2 (speaker): 20, 40000 (hmdi_arc): 27, 40000000 (default): 15
   Devices: speaker
- STREAM_ALARM:
   Muted: true
   Min: 0
   Max: 7
   Current: 2 (speaker): 3, 40000 (hmdi_arc): 3, 40000000 (default): 2
   Devices: speaker`);
  assert.deepEqual(off, { muted: false, index: 20, max: 60, percent: 33 });
  // python-androidtv STREAM_MUSIC_NO_VOLUME
  const noVolume = parseAudio(`- STREAM_MUSIC:
   Muted: false
   Min: 0
   Max: 60
   Devices: speaker
- STREAM_ALARM:
   Muted: true`);
  assert.deepEqual(noVolume, { muted: false, index: null, max: 60, percent: null });
  assert.equal(parseAudio('- STREAM_MUSIC:\n \n- STREAM').percent, null);
  assert.equal(parseAudio('').percent, null);
});

test('an output cut before its end is not taken for a state', () => {
  const output = simulateDevice(CHROMECAST).respond(STATE_COMMAND);
  assert.throws(() => parseState(output.slice(0, output.indexOf('##end'))), /incomplete/);
});

test('the Sony BRAVIA without query-activities still gets its known apps', () => {
  const { launchable, packages } = parseInstalledApps(
    simulateDevice(BRAVIA).respond('##launchable'),
  );
  assert.deepEqual(launchable, []);
  assert.ok(packages.includes('com.netflix.ninja'));
});

// --- Commands -----------------------------------------------------------------

test('package names follow the Java grammar, nothing else', () => {
  for (const ok of ['com.netflix.ninja', 'tv.twitch.android.app', 'org.xbmc.kodi', 'a.b']) {
    assert.ok(isValidPackage(ok), ok);
  }
  for (const bad of [
    'netflix',
    'com.netflix.ninja; reboot',
    'com.netflix.ninja && rm -rf /',
    '$(reboot).x',
    'com..double',
    '.com.start',
    'com.example`id`',
    'com.example\nreboot',
    '',
    null,
    42,
  ]) {
    assert.ok(!isValidPackage(bad), String(bad));
  }
  assert.throws(() => launchCommand('x; reboot', 'android.intent.category.LAUNCHER'));
});

test('URLs: http(s), rtsp and rtmp only, single-quoted, no whitespace nor control characters', () => {
  assert.equal(
    openUrlCommand('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'),
    "am start -a android.intent.action.VIEW -d 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42' 2>&1",
  );
  assert.equal(
    openUrlCommand("https://example.org/it's", 'org.videolan.vlc'),
    "am start -a android.intent.action.VIEW -d 'https://example.org/it'\\''s' org.videolan.vlc 2>&1",
  );
  for (const bad of [
    'file:///sdcard/secret',
    'javascript:alert(1)',
    'intent:#Intent;end',
    'content://settings/secure',
    "https://x.org/' ; reboot ; '",
    'https://x.org/\nreboot',
    'not a url',
    `https://x.org/${'a'.repeat(2000)}`,
    '',
  ]) {
    assert.equal(normalizeUrl(bad), null, bad);
    assert.throws(() => openUrlCommand(bad));
  }
  assert.throws(() => openUrlCommand('https://x.org', 'bad package'));
});

test('keys, power and volume commands', () => {
  assert.equal(keyCommand(3), 'input keyevent 3');
  assert.equal(keyCommand(22, 3), 'input keyevent 22; input keyevent 22; input keyevent 22');
  assert.equal(keyCommand(22, 500).split(';').length, 20, 'capped');
  assert.throws(() => keyCommand('3; reboot'));
  assert.match(powerCommand(true, false), /\|\| input keyevent 26$/);
  assert.match(powerCommand(false, false), /&& input keyevent 26$/);
  assert.match(powerCommand(true, true), /\|\| \(input keyevent 26 && input keyevent 3\)$/);
  assert.match(powerCommand(false, true), /&& input keyevent 223$/);
  assert.equal(volumeCommand(7, 30), 'cmd media_session volume --show --stream 3 --set 7');
  assert.equal(volumeCommand(7, 28), 'media volume --show --stream 3 --set 7');
  assert.throws(() => volumeCommand(-1, 30));
  assert.throws(() => volumeCommand('7; reboot', 30));
});

test('the read commands fit in one legacy ADB packet', () => {
  for (const command of [INFO_COMMAND, STATE_COMMAND]) {
    assert.ok(Buffer.byteLength(`shell:${command}\0`) <= 4096);
  }
});

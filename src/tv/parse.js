// -----------------------------------------------------------------------------
// Reading the outputs of the commands of src/tv/commands.js.
//
// The formats are those of AOSP `dumpsys`, which vary across Android versions
// and vendors: every reader tolerates missing lines and answers null rather
// than guessing. The patterns follow python-androidtv (MIT, Jeff Irion), whose
// tests hold real outputs of Shield, Fire TV, Sony and Chromecast devices.
// -----------------------------------------------------------------------------

const PACKAGE = '[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)+';

/** Splits the `##name` sections of a command output. */
export function splitSections(output) {
  const sections = {};
  let current = null;
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const marker = line.match(/^##(\w+)\s*$/);
    if (marker) {
      current = marker[1];
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  return Object.fromEntries(
    Object.entries(sections).map(([key, lines]) => [key, lines.join('\n')]),
  );
}

/** `key=value` lines (the INFO command). */
export function parseInfo(output) {
  const values = {};
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) {
      values[match[1]] = match[2].trim();
    }
  }
  const mac = (text) => text?.match(/link\/ether ([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i)?.[1];
  const sdk = Number.parseInt(values.sdk, 10);
  return {
    manufacturer: values.manufacturer || null,
    model: values.model || null,
    serial: values.serial && values.serial !== 'unknown' ? values.serial : null,
    androidVersion: values.release || null,
    sdk: Number.isFinite(sdk) ? sdk : null,
    ethMac: mac(values.eth)?.toLowerCase() ?? null,
    wlanMac: mac(values.wlan)?.toLowerCase() ?? null,
  };
}

/**
 * The stable id of a device: its serial number, else a MAC address. Lower
 * case letters and digits only, as it goes into the Gladys external ids.
 * @returns {string|null}
 */
export function platformId(info) {
  const raw = info.serial ?? info.ethMac ?? info.wlanMac;
  if (!raw) {
    return null;
  }
  const id = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return id.length >= 4 ? id : null;
}

/** Fire OS is Android with Amazon's launcher and key handling. */
export function isFireTv(info) {
  return /amazon/i.test(info.manufacturer ?? '');
}

/**
 * `dumpsys power` (and `dumpsys display` as a fallback).
 * @returns {{ screenOn: boolean|null, wakefulness: string|null }}
 */
export function parsePower(text) {
  const wakefulness = text.match(/mWakefulness=(\w+)/)?.[1] ?? null;
  const display = text.match(/Display Power: state=(\w+)/)?.[1];
  const screenOnFlag = text.match(/mScreenOn=(true|false)/)?.[1];
  const screenState = text.match(/mScreenState=(\w+)/)?.[1];
  let screenOn = null;
  if (display) {
    screenOn = display === 'ON';
  } else if (screenOnFlag) {
    screenOn = screenOnFlag === 'true';
  } else if (screenState) {
    screenOn = screenState === 'ON';
  } else if (wakefulness) {
    screenOn = wakefulness === 'Awake' || wakefulness === 'Dreaming';
  }
  return { screenOn, wakefulness };
}

const RECORD = new RegExp(`ActivityRecord\\{\\S+ \\S+ (${PACKAGE})/`);
const WINDOW = new RegExp(`Window\\{\\S+ \\S+ (${PACKAGE})[/} ]`);

/**
 * The foreground package, from `dumpsys activity activities` (resumed
 * activity) or `dumpsys window windows` (focused window).
 * @returns {string|null}
 */
export function parseCurrentApp(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const fromLines = (test, pattern) => {
    for (const line of lines) {
      if (test.test(line)) {
        const found = line.match(pattern)?.[1];
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  return (
    // Android 10+: the activity on top of everything.
    fromLines(/topResumedActivity/, RECORD) ??
    // The global resumed activity, then the first stack's one.
    fromLines(/(^|\s)ResumedActivity:/, RECORD) ??
    fromLines(/mResumedActivity/, RECORD) ??
    // The window fallback: the focused app record, then the focused window.
    fromLines(/mFocusedApp/, RECORD) ??
    fromLines(/mCurrentFocus/, WINDOW)
  );
}

/**
 * `dumpsys media_session`, filtered on the package, active and state lines.
 * @returns {{ package: string, active: boolean|null, state: number|null }[]}
 */
export function parseMediaSessions(text) {
  const sessions = [];
  let session = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const pkg = line.match(new RegExp(`^\\s*package=(${PACKAGE})`))?.[1];
    if (pkg) {
      session = { package: pkg, active: null, state: null };
      sessions.push(session);
      continue;
    }
    if (!session) {
      continue;
    }
    const active = line.match(/^\s*active=(true|false)/)?.[1];
    if (active) {
      session.active = active === 'true';
    }
    // `state=3` up to Android 12, `state=PLAYING(3)` since Android 13.
    const state = line.match(/state=PlaybackState \{state=(?:[A-Z_]+\()?(\d+)/)?.[1];
    if (state !== undefined && session.state === null) {
      session.state = Number(state);
    }
  }
  return sessions;
}

// android.media.session.PlaybackState: 3 playing, 4/5 seeking, 2 paused,
// 1 stopped, 7 error, 0 none; 6, 8–11 are transient (buffering, connecting,
// skipping) and keep the previous state, so an episode change is not a stop.
const PLAYBACK_BY_CODE = new Map([
  [0, 'idle'],
  [1, 'stopped'],
  [2, 'paused'],
  [3, 'playing'],
  [4, 'playing'],
  [5, 'playing'],
  [7, 'stopped'],
]);

/** @returns {'playing'|'paused'|'stopped'|'idle'|'transient'} */
export function playbackFromCode(code) {
  if (code === null || code === undefined) {
    return 'idle';
  }
  return PLAYBACK_BY_CODE.get(code) ?? 'transient';
}

/**
 * The playback state that matters on a TV: the session of the foreground app,
 * else a session playing in the background (music while on the home screen).
 * @returns {'playing'|'paused'|'stopped'|'idle'|'transient'}
 */
export function currentPlayback(sessions, app) {
  const own = sessions.filter((s) => s.package === app);
  const chosen =
    own.find((s) => s.active !== false && s.state !== null) ??
    own.find((s) => s.state !== null) ??
    sessions.find((s) => s.active !== false && playbackFromCode(s.state) === 'playing');
  return playbackFromCode(chosen?.state ?? null);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The STREAM_MUSIC block of `dumpsys audio`.
 * @returns {{ muted: boolean|null, index: number|null, max: number|null, percent: number|null }}
 */
export function parseAudio(text) {
  const empty = { muted: null, index: null, max: null, percent: null };
  const start = String(text ?? '').indexOf('- STREAM_MUSIC:');
  if (start < 0) {
    return empty;
  }
  const rest = text.slice(start + '- STREAM_MUSIC:'.length);
  const end = rest.search(/\n\s*- STREAM_/);
  const block = end < 0 ? rest : rest.slice(0, end);
  const muted = block.match(/^\s*Muted: (true|false)/m)?.[1];
  const max = Number(block.match(/^\s*Max: (\d+)/m)?.[1]);
  const device = block.match(/^\s*Devices: ([\w-]+)/m)?.[1];
  let index = null;
  if (device) {
    const value = block.match(new RegExp(`\\(${escapeRegExp(device)}\\): (\\d+)`))?.[1];
    index = value === undefined ? null : Number(value);
  }
  if (index === null) {
    const value = block.match(/streamVolume:\s*(\d+)/)?.[1];
    index = value === undefined ? null : Number(value);
  }
  const validMax = Number.isFinite(max) && max > 0 ? max : null;
  return {
    muted: muted === undefined ? null : muted === 'true',
    index,
    max: validMax,
    percent:
      index !== null && validMax !== null
        ? Math.max(0, Math.min(100, Math.round((index / validMax) * 100)))
        : null,
  };
}

/**
 * Reads one poll (STATE_COMMAND).
 * @returns {{ screenOn: boolean|null, wakefulness: string|null, app: string|null,
 *   playback: string, audio: object }}
 */
export function parseState(output) {
  const sections = splitSections(output);
  if (sections.end === undefined) {
    throw new Error('incomplete state output');
  }
  const { screenOn, wakefulness } = parsePower(sections.power ?? '');
  const app = parseCurrentApp(sections.app ?? '');
  const playback = currentPlayback(parseMediaSessions(sections.media ?? ''), app);
  return { screenOn, wakefulness, app, playback, audio: parseAudio(sections.audio ?? '') };
}

/**
 * Reads the installed applications (installedAppsCommand): the launchable
 * packages, and every package name.
 * @returns {{ launchable: string[], packages: string[] }}
 */
export function parseInstalledApps(output) {
  const sections = splitSections(output);
  const component = new RegExp(`^\\s*(${PACKAGE})/\\S+\\s*$`);
  const launchable = new Set();
  for (const line of (sections.launchable ?? '').split(/\r?\n/)) {
    const pkg = line.match(component)?.[1];
    if (pkg) {
      launchable.add(pkg);
    }
  }
  const packages = new Set();
  for (const line of (sections.packages ?? '').split(/\r?\n/)) {
    const pkg = line.match(new RegExp(`^package:(${PACKAGE})\\s*$`))?.[1];
    if (pkg) {
      packages.add(pkg);
    }
  }
  return { launchable: [...launchable], packages: [...packages] };
}

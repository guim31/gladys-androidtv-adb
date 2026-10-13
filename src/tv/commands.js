// -----------------------------------------------------------------------------
// Every shell command the integration sends to a device.
//
// They are fixed templates: the only variable parts are a key code from the
// table of src/tv/keys.js, a volume index, a package name checked against the
// Java package grammar, and a URL checked and single-quoted. There is no way
// to send free shell text from Gladys, on purpose: ADB is a root-like access
// to the device (Home Assistant offers `adb_command`, this integration does
// not).
//
// The read commands come from python-androidtv (androidtv/constants.py, MIT,
// Jeff Irion), regrouped so one poll is one shell command, and with the
// parsing done here in JavaScript (src/tv/parse.js) rather than in sh.
// -----------------------------------------------------------------------------

const PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const URL_SCHEMES = new Set(['http:', 'https:', 'rtsp:', 'rtmp:']);
const MAX_URL_LENGTH = 2000;

export const LEANBACK_LAUNCHER = 'android.intent.category.LEANBACK_LAUNCHER';
export const LAUNCHER = 'android.intent.category.LAUNCHER';

/** @param {unknown} value */
export function isValidPackage(value) {
  return typeof value === 'string' && value.length <= 255 && PACKAGE_PATTERN.test(value);
}

/**
 * @param {unknown} value
 * @returns {string|null} the URL to open, or null when it is not one we send
 */
export function normalizeUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  // No whitespace nor control character: a URL never needs one, a shell trick does.
  if (!text || text.length > MAX_URL_LENGTH || /[\s\p{Cc}]/u.test(text)) {
    return null;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  return URL_SCHEMES.has(url.protocol) ? text : null;
}

/** Single-quotes a value for sh: nothing inside is interpreted. */
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Device properties, read once per connection. */
export const INFO_COMMAND = [
  'echo "manufacturer=$(getprop ro.product.manufacturer)"',
  'echo "model=$(getprop ro.product.model)"',
  'echo "serial=$(getprop ro.serialno)"',
  'echo "release=$(getprop ro.build.version.release)"',
  'echo "sdk=$(getprop ro.build.version.sdk)"',
  'echo "eth=$(ip addr show eth0 2>/dev/null | grep -m 1 ether)"',
  'echo "wlan=$(ip addr show wlan0 2>/dev/null | grep -m 1 ether)"',
].join('; ');

// Screen state: `Display Power: state=` (Android 5+), else `mScreenOn=`
// (older), else the display service (python-androidtv CMD_SCREEN_ON).
const POWER_PART = [
  "P=$(dumpsys power | grep -E 'mWakefulness=|Display Power: state=|mScreenOn=')",
  'echo "$P"',
  "echo \"$P\" | grep -qE 'Display Power|mScreenOn' || dumpsys display | grep -m 1 -E 'mScreenState='",
].join('; ');

// Foreground application: the resumed activity, else the focused window
// (python-androidtv picks one of them per Android version and model).
const APP_PART = [
  "A=$(dumpsys activity activities | grep -E 'ResumedActivity')",
  'echo "$A"',
  '[ -n "$A" ] || dumpsys window windows | grep -E \'mCurrentFocus|mFocusedApp\'',
].join('; ');

/** One poll: power, foreground app, media sessions, music stream volume. */
export const STATE_COMMAND = [
  "echo '##power'",
  POWER_PART,
  "echo '##app'",
  APP_PART,
  "echo '##media'",
  "dumpsys media_session | grep -E '^ *(package=|active=|state=PlaybackState)'",
  "echo '##audio'",
  "dumpsys audio | grep '\\- STREAM_MUSIC:' -A 14",
  "echo '##end'",
].join('; ');

/** @param {boolean} fireTv */
export function installedAppsCommand(fireTv) {
  const query = (category) =>
    `cmd package query-activities --components -a android.intent.action.MAIN -c ${category} 2>/dev/null`;
  return [
    "echo '##launchable'",
    query(LEANBACK_LAUNCHER),
    ...(fireTv ? [query(LAUNCHER)] : []),
    "echo '##packages'",
    'pm list packages 2>/dev/null',
  ].join('; ');
}

// Same screen test as the state command, as an sh condition.
const SCREEN_ON =
  "(dumpsys power | grep 'Display Power' | grep -q 'state=ON' || dumpsys power | grep -q 'mScreenOn=true' || dumpsys display | grep -q 'mScreenState=ON')";

/**
 * Wake up / put to sleep, only when needed: POWER is a toggle (python-androidtv
 * CMD_TURN_ON_*, CMD_TURN_OFF_*). Fire TV sleeps with SLEEP and wakes on the
 * home screen.
 * @param {boolean} on
 * @param {boolean} fireTv
 */
export function powerCommand(on, fireTv) {
  if (on) {
    return fireTv
      ? `${SCREEN_ON} || (input keyevent 26 && input keyevent 3)`
      : `${SCREEN_ON} || input keyevent 26`;
  }
  return `${SCREEN_ON} && input keyevent ${fireTv ? 223 : 26}`;
}

/**
 * @param {number} code an Android key code from src/tv/keys.js
 * @param {number} [count] presses, 1 to 20
 */
export function keyCommand(code, count = 1) {
  if (!Number.isInteger(code) || code < 0 || code > 999) {
    throw new Error(`invalid key code ${code}`);
  }
  const times = Math.min(Math.max(Math.trunc(count) || 1, 1), 20);
  return Array.from({ length: times }, () => `input keyevent ${code}`).join('; ');
}

/**
 * Sets the music stream volume (STREAM_MUSIC = 3), showing the volume bar.
 * @param {number} index 0 to the stream maximum
 * @param {number} sdk Android API level (`media` was replaced in Android 11, API 30)
 */
export function volumeCommand(index, sdk) {
  if (!Number.isInteger(index) || index < 0 || index > 1000) {
    throw new Error(`invalid volume index ${index}`);
  }
  return sdk >= 30
    ? `cmd media_session volume --show --stream 3 --set ${index}`
    : `media volume --show --stream 3 --set ${index}`;
}

/**
 * Starts the launcher activity of a package (python-androidtv CMD_LAUNCH_APP).
 * @param {string} pkg
 * @param {string} category LEANBACK_LAUNCHER or LAUNCHER
 */
export function launchCommand(pkg, category) {
  if (!isValidPackage(pkg)) {
    throw new Error(`invalid package name ${pkg}`);
  }
  return `monkey -p ${pkg} -c ${category} --pct-syskeys 0 1 2>&1`;
}

/**
 * Opens a URL (intent VIEW): a YouTube link opens YouTube, a stream URL the
 * default player, or the given package.
 * @param {string} url checked by normalizeUrl
 * @param {string} [pkg]
 */
export function openUrlCommand(url, pkg) {
  const safe = normalizeUrl(url);
  if (!safe) {
    throw new Error('invalid URL');
  }
  if (pkg !== undefined && !isValidPackage(pkg)) {
    throw new Error(`invalid package name ${pkg}`);
  }
  return `am start -a android.intent.action.VIEW -d ${shellQuote(safe)}${pkg ? ` ${pkg}` : ''} 2>&1`;
}

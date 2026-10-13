// -----------------------------------------------------------------------------
// The devices at run time: one loop per configured address.
//
// Each loop reads its device on its own timer — the core cannot be trusted to
// call onPoll (GladysAssistant/Gladys#3198), onPoll only runs a read when the
// timer is late:
//   - screen on: every `poll_interval` seconds (10 by default), over one ADB
//     connection kept open, so a key press is immediate;
//   - standby or unreachable: every 60 s, and the connection is closed after
//     each read. An open ADB connection holds no wake lock, but a device
//     asleep should not keep a socket from Gladys either, nor be read often.
// One read is one shell command (src/tv/commands.js STATE_COMMAND). Only the
// devices added to Gladys are read; the others are identified once (serial,
// model, applications) so they can be offered in Discovery.
//
// The "Allow debugging?" prompt is opened by the first connection to an
// address after a start or a configuration change, then only by the
// "Connect the devices" action: never in a loop.
// -----------------------------------------------------------------------------

import { AdbConnection, AdbError } from './adb/connection.js';
import { keyFingerprint } from './adb/keys.js';
import { STANDBY_INTERVAL } from './config.js';
import {
  buildDevice,
  defaultName,
  deviceIds,
  playbackValue,
  stateValues,
  uidFromExternalId,
} from './devices.js';
import { CONNECT_TEXT, ERROR_TEXT, STATUS_TEXT, localize, localizedError } from './i18n.js';
import { IssueLog } from './issues.js';
import { appName, findAppByKey, findAppByPackage } from './tv/apps.js';
import {
  INFO_COMMAND,
  LAUNCHER,
  LEANBACK_LAUNCHER,
  STATE_COMMAND,
  installedAppsCommand,
  isValidPackage,
  keyCommand,
  launchCommand,
  normalizeUrl,
  openUrlCommand,
  powerCommand,
  volumeCommand,
} from './tv/commands.js';
import { findKey } from './tv/keys.js';
import { isFireTv, parseInfo, parseInstalledApps, parseState, platformId } from './tv/parse.js';

export const WIDGET_KEY = 'remote';
export const SCENE_TRIGGERS = ['app_opened', 'playback_changed'];

/** Re-sends unchanged states this often, so Gladys never shows them as stale. */
export const HEARTBEAT_MS = 6 * 3600 * 1000;
/** Reads the installed applications again this often (screen on only). */
export const APPS_REFRESH_MS = 6 * 3600 * 1000;
/** Waits this long for the user to accept the prompt on the screen. */
export const PROMPT_TIMEOUT_MS = 90_000;
/** After a command, reads the device again this soon, to show its effect. */
export const AFTER_COMMAND_MS = 1500;
/** Failed reads in a row before a device is shown off (one miss is noise). */
const FAILURES_BEFORE_OFF = 2;

const HOME_PACKAGES = new Set(findAppByKey('home').packages);

class Tv {
  constructor({ host, port, address }, uid) {
    this.host = host;
    this.port = port;
    this.address = address;
    this.uid = uid;
    /** @type {AdbConnection|null} */
    this.connection = null;
    /** unknown | online | unreachable | unauthorized | tls | error */
    this.status = 'unknown';
    this.prompted = false;
    this.snapshot = null;
    this.failures = 0;
    this.lastReadAt = null;
    this.appsReadAt = null;
    this.timer = null;
    this.queue = Promise.resolve();
    this.removed = false;
  }
}

export class Hub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {import('./store.js').Store} options.store
   * @param {object} options.logger
   * @param {boolean} [options.timers] run the loops' timers (tests may turn them off)
   * @param {() => number} [options.now]
   * @param {number} [options.promptTimeoutMs] how long the prompt waits for the user
   */
  constructor({
    gladys,
    store,
    logger,
    timers = true,
    now = () => Date.now(),
    promptTimeoutMs = PROMPT_TIMEOUT_MS,
  }) {
    this.gladys = gladys;
    this.promptTimeoutMs = promptTimeoutMs;
    this.store = store;
    this.logger = logger;
    this.timers = timers;
    this.now = now;
    this.issues = new IssueLog(logger);
    this.config = null;
    /** @type {Map<string, Tv>} by address */
    this.tvs = new Map();
    this.lastStatus = null;
    this.stopped = false;
  }

  // ---------------------------------------------------------------------------
  // Configuration and lifecycle
  // ---------------------------------------------------------------------------

  /**
   * (Re)starts with a configuration: new addresses get a loop (and may open
   * the prompt once), removed ones are closed, everything is read now.
   */
  async apply(config) {
    this.stopped = false;
    this.config = config;
    // After a reconnection Gladys may show a stale status: send it again.
    this.lastStatus = null;
    const wanted = new Set(config.hosts.map((h) => h.address));
    for (const [address, tv] of this.tvs) {
      if (!wanted.has(address)) {
        this.removeTv(tv);
      }
    }
    for (const host of config.hosts) {
      if (!this.tvs.has(host.address)) {
        this.tvs.set(host.address, new Tv(host, this.store.findByAddress(host.address)?.uid));
      }
    }
    await this.publishDevices();
    await Promise.all([...this.tvs.values()].map((tv) => this.read(tv, { force: true })));
    await this.updateConnectionStatus();
  }

  removeTv(tv) {
    tv.removed = true;
    clearTimeout(tv.timer);
    this.closeConnection(tv);
    this.issues.recover(tv.address);
    this.tvs.delete(tv.address);
  }

  stop() {
    this.stopped = true;
    for (const tv of this.tvs.values()) {
      clearTimeout(tv.timer);
      tv.timer = null;
      this.closeConnection(tv);
    }
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  /** The identified devices of the configured addresses, as store entries. */
  knownEntries() {
    return [...this.tvs.values()]
      .filter((tv) => tv.uid && this.store.get(tv.uid))
      .map((tv) => this.store.get(tv.uid));
  }

  discoveredDevices() {
    return this.knownEntries().map((entry) => buildDevice(this.gladys, entry, this.config));
  }

  /** Publishes the identified devices (Discovery, and the options of the created ones). */
  async publishDevices() {
    if (!this.config || this.gladys.connected === false) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
      this.issues.recover('publish', 'Gladys accepts the devices again');
    } catch (err) {
      this.issues.fail('publish', 'publish', `Publishing the devices failed (${err.message})`);
    }
  }

  /** The connection status of the Configuration screen, sent when it changes. */
  async updateConnectionStatus() {
    if (!this.config || this.gladys.connected === false) {
      return;
    }
    const problems = [];
    if (this.config.invalidHosts.length > 0) {
      problems.push(['invalid', this.config.invalidHosts.join(', ')]);
    }
    const list = (status) =>
      [...this.tvs.values()]
        .filter((tv) => tv.status === status && (status !== 'unreachable' || !tv.uid))
        .map((tv) => tv.address)
        .join(', ');
    for (const status of ['unauthorized', 'tls', 'unreachable']) {
      const addresses = list(status);
      if (addresses) {
        problems.push([status, addresses]);
      }
    }
    if (this.config.hosts.length === 0) {
      problems.unshift(['noDevice']);
    }
    const key = JSON.stringify(problems);
    if (key === this.lastStatus) {
      return;
    }
    const message =
      problems.length === 0
        ? undefined
        : localize((lang) =>
            problems
              .map(([kind, arg]) => {
                const text = STATUS_TEXT[kind][lang];
                return typeof text === 'function' ? text(arg) : text;
              })
              .join(' '),
          );
    try {
      await this.gladys.setConnectionStatus(problems.length === 0, message);
      this.lastStatus = key;
    } catch (err) {
      this.logger.debug(`setConnectionStatus failed (${err.message})`);
    }
  }

  // ---------------------------------------------------------------------------
  // Devices known by Gladys
  // ---------------------------------------------------------------------------

  /** @param {string|null} uid */
  isCreated(uid) {
    if (!uid) {
      return false;
    }
    const externalId = deviceIds(this.gladys, uid).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  deviceName(uid) {
    const externalId = deviceIds(this.gladys, uid).device;
    const created = (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
    return created?.name ?? defaultName(this.store.get(uid) ?? {});
  }

  /** The loop of a device external id (or of one of its features). */
  tvFor(externalId) {
    const uid = uidFromExternalId(this.gladys, externalId);
    if (!uid) {
      return null;
    }
    return [...this.tvs.values()].find((tv) => tv.uid === uid) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Reading a device
  // ---------------------------------------------------------------------------

  /** Runs `task` alone on this device (reads and commands never interleave). */
  exclusive(tv, task) {
    const run = tv.queue.then(task, task);
    tv.queue = run.catch(() => {});
    return run;
  }

  schedule(tv, delayMs) {
    clearTimeout(tv.timer);
    tv.timer = null;
    if (!this.timers || this.stopped || tv.removed) {
      return;
    }
    tv.timer = setTimeout(() => {
      tv.timer = null;
      this.read(tv).catch((err) => this.logger.error(`${tv.address}: read failed`, err));
    }, delayMs);
  }

  /** The current period of a device: fast while its screen is on. */
  periodMs(tv) {
    if (tv.status === 'online' && tv.snapshot?.screenOn) {
      return this.config.pollInterval * 1000;
    }
    if (tv.status === 'unauthorized') {
      return 5 * STANDBY_INTERVAL * 1000;
    }
    return STANDBY_INTERVAL * 1000;
  }

  /**
   * One read of a device, then the next one is scheduled.
   * @param {object} [options]
   * @param {boolean} [options.force] read even if read less than half a period ago
   * @param {number} [options.minGap] fraction of the period under which a read is skipped
   */
  async read(tv, { force = false, minGap = 0.5 } = {}) {
    if (tv.removed || this.stopped) {
      return;
    }
    if (
      !force &&
      tv.lastReadAt !== null &&
      this.now() - tv.lastReadAt < this.periodMs(tv) * minGap
    ) {
      this.logger.debug(`${tv.address}: read ${this.now() - tv.lastReadAt} ms ago, skipped`);
      return;
    }
    await this.exclusive(tv, () => this.readNow(tv));
    this.schedule(tv, this.periodMs(tv));
    await this.updateConnectionStatus();
  }

  async readNow(tv) {
    if (this.gladys.connected === false) {
      this.logger.debug(`${tv.address}: Gladys unreachable, read skipped`);
      return;
    }
    // Identified, but not added to Gladys: nothing to read.
    if (tv.uid && this.store.get(tv.uid) && !this.isCreated(tv.uid)) {
      this.closeConnection(tv);
      return;
    }
    tv.lastReadAt = this.now();
    try {
      const connection = await this.connect(tv, { prompt: !tv.prompted });
      if (!this.isCreated(tv.uid)) {
        // Just identified: it waits in Discovery, nothing to read.
        this.closeConnection(tv);
        return;
      }
      const snapshot = parseState(await connection.shell(STATE_COMMAND, { timeoutMs: 8000 }));
      tv.failures = 0;
      await this.onSnapshot(tv, snapshot);
      if (snapshot.screenOn && this.isDue(tv.appsReadAt, APPS_REFRESH_MS)) {
        await this.readApps(tv, connection);
      }
      if (!snapshot.screenOn) {
        this.closeConnection(tv);
      }
    } catch (err) {
      await this.onFailure(tv, err);
    }
  }

  isDue(at, period) {
    return at === null || this.now() - at >= period;
  }

  /**
   * The open connection of a device, or a new one (identified on the way).
   * @param {Tv} tv
   * @param {{ prompt?: boolean }} options
   */
  async connect(tv, { prompt = false } = {}) {
    if (tv.connection?.connected) {
      return tv.connection;
    }
    this.closeConnection(tv);
    const connection = new AdbConnection({
      host: tv.host,
      port: tv.port,
      privateKey: this.store.privateKey,
    });
    if (prompt) {
      tv.prompted = true;
    }
    tv.connection = connection;
    connection.onClose(() => {
      if (tv.connection === connection) {
        tv.connection = null;
      }
    });
    try {
      await connection.connect({ sendPublicKey: prompt, authTimeoutMs: this.promptTimeoutMs });
      await this.identify(tv, connection);
    } catch (err) {
      connection.close();
      throw err;
    }
    return connection;
  }

  closeConnection(tv) {
    const connection = tv.connection;
    tv.connection = null;
    connection?.close();
  }

  /** Reads who the device is; a new or moved device is published. */
  async identify(tv, connection) {
    const info = parseInfo(await connection.shell(INFO_COMMAND));
    const uid = platformId(info);
    if (!uid) {
      throw new AdbError('PROTOCOL', `${tv.address}: no serial number nor MAC address`);
    }
    const known = this.store.get(uid);
    const changed = this.store.update(uid, {
      address: tv.address,
      manufacturer: info.manufacturer,
      model: info.model,
      androidVersion: info.androidVersion,
      sdk: info.sdk,
      fireTv: isFireTv(info),
    });
    const wasOnline = tv.status === 'online';
    tv.uid = uid;
    tv.status = 'online';
    if (!known) {
      // First contact: is the volume readable, which applications are there.
      // Both shape the device, so they are known before it is published.
      const snapshot = parseState(await connection.shell(STATE_COMMAND, { timeoutMs: 8000 }));
      this.store.update(uid, { volume: snapshot.audio.percent !== null });
      await this.readApps(tv, connection, { publish: false });
    }
    if (!wasOnline) {
      const entry = this.store.get(uid);
      const recovered = this.issues.recover(
        tv.address,
        `${tv.address}: ${defaultName(entry)} is back`,
      );
      if (!recovered) {
        this.logger.info(
          `${tv.address}: connected to ${defaultName(entry)} (Android ${entry.androidVersion ?? '?'})`,
        );
      }
    }
    if (changed || !known) {
      await this.publishDevices();
    }
  }

  /** Reads the installed applications; publishes the new options when they changed. */
  async readApps(tv, connection, { publish = true } = {}) {
    const entry = this.store.get(tv.uid);
    const { launchable, packages } = parseInstalledApps(
      await connection.shell(installedAppsCommand(entry.fireTv), { timeoutMs: 8000 }),
    );
    const known = packages.filter((pkg) => findAppByPackage(pkg));
    const apps = [...new Set([...launchable, ...known])].sort();
    tv.appsReadAt = this.now();
    // A failed query (empty list) keeps what was known.
    if (apps.length > 0 && this.store.update(tv.uid, { apps }) && publish) {
      await this.publishDevices();
    }
  }

  /** What changed since the last read: states, scene events, widget. */
  async onSnapshot(tv, raw) {
    const previous = tv.snapshot;
    // A transient playback state (buffering, skipping) keeps the previous one.
    const playback = raw.playback === 'transient' ? (previous?.playback ?? 'idle') : raw.playback;
    const snapshot = { ...raw, playback };
    tv.snapshot = snapshot;
    tv.status = 'online';

    const entry = this.store.get(tv.uid);
    if (
      snapshot.app &&
      isValidPackage(snapshot.app) &&
      !(entry.apps ?? []).includes(snapshot.app)
    ) {
      // An application missing from the selector: add it, so it shows.
      this.store.update(tv.uid, { apps: [...(entry.apps ?? []), snapshot.app].sort() });
      await this.publishDevices();
    }
    await this.publishStates(tv, stateValues(this.gladys, tv.uid, snapshot, entry));

    if (previous) {
      await this.fireEvents(tv, previous, snapshot);
      const visible = (s) =>
        JSON.stringify([playbackValue(s), s.app, s.audio?.percent, s.audio?.muted]);
      if (visible(previous) !== visible(snapshot)) {
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      }
    }
  }

  async publishStates(tv, states) {
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      this.issues.recover('states', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('states', 'states', `Publishing the states failed (${err.message})`);
    }
  }

  async fireEvents(tv, previous, snapshot) {
    const ids = deviceIds(this.gladys, tv.uid);
    const common = {
      device: ids.device,
      device_name: this.deviceName(tv.uid),
      package: snapshot.app,
      app_name: snapshot.app ? appName(snapshot.app, this.language) : null,
    };
    if (snapshot.screenOn && snapshot.app && snapshot.app !== previous.app) {
      await this.publishEvent('app_opened', {
        ...common,
        app: findAppByPackage(snapshot.app)?.key ?? snapshot.app,
      });
    }
    if (
      snapshot.screenOn &&
      snapshot.playback !== previous.playback &&
      ['playing', 'paused', 'stopped'].includes(snapshot.playback)
    ) {
      await this.publishEvent('playback_changed', { ...common, state: snapshot.playback });
    }
  }

  async publishEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.recover(`event:${key}`, `Gladys accepts the "${key}" events again`);
    } catch (err) {
      this.issues.fail(`event:${key}`, 'event', `Scene event "${key}" refused (${err.message})`);
    }
  }

  async onFailure(tv, err) {
    this.closeConnection(tv);
    tv.failures += 1;
    const code = err instanceof AdbError ? err.code : 'ERROR';
    if (code === 'UNAUTHORIZED' || code === 'AUTH_PENDING') {
      tv.status = 'unauthorized';
      this.issues.fail(
        tv.address,
        'unauthorized',
        `${tv.address}: Gladys is not allowed yet, accept the debugging prompt on the screen ("Always allow")`,
      );
    } else if (code === 'TLS_REQUIRED') {
      tv.status = 'tls';
      this.issues.fail(tv.address, 'tls', err.message);
    } else if (['UNREACHABLE', 'TIMEOUT', 'CLOSED'].includes(code)) {
      tv.status = 'unreachable';
      // A device whose network sleeps with it is unreachable every night:
      // that is its standby, not an error.
      this.issues.fail(
        tv.address,
        'unreachable',
        `${tv.address}: unreachable (${err.message}), off or network debugging disabled`,
        'info',
      );
    } else {
      tv.status = 'error';
      this.issues.fail(tv.address, 'error', `${tv.address}: read failed (${err.message})`);
    }
    if (tv.uid && this.isCreated(tv.uid) && tv.failures >= FAILURES_BEFORE_OFF) {
      // Unreachable for a while: shown off, which is what it most likely is.
      const off = { screenOn: false, wakefulness: null, app: null, playback: 'idle', audio: null };
      if (tv.snapshot?.screenOn !== false) {
        tv.snapshot = { ...(tv.snapshot ?? off), screenOn: false };
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      }
      await this.publishStates(tv, stateValues(this.gladys, tv.uid, off, { volume: false }));
    }
  }

  // ---------------------------------------------------------------------------
  // Gladys asking
  // ---------------------------------------------------------------------------

  /** The core's onPoll (fallback): reads unless the timer did lately. */
  async pollFromCore(device) {
    const tv = this.tvFor(device.external_id);
    if (!tv) {
      this.logger.debug(`onPoll ignored for ${device.external_id}`);
      return;
    }
    await this.read(tv, { minGap: 0.9 });
  }

  /** A device was just added: send its states now, refresh the widget. */
  async deviceCreated(device) {
    const tv = this.tvFor(device.external_id);
    if (tv) {
      await this.read(tv, { force: true });
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /**
   * Runs a command on a device, then reads it again shortly after.
   * @param {string} externalId device (or feature) external id
   * @param {string} label for the log line
   * @param {(connection: AdbConnection, tv: Tv, entry: object) => Promise<any>} task
   */
  async command(externalId, label, task) {
    const tv = this.tvFor(externalId);
    const entry = tv?.uid ? this.store.get(tv.uid) : null;
    if (!tv || !entry) {
      throw localizedError(ERROR_TEXT.unknownDevice, this.language);
    }
    const result = await this.exclusive(tv, async () => {
      let connection;
      try {
        connection = await this.connect(tv);
      } catch (err) {
        await this.onFailure(tv, err);
        throw localizedError(
          err.code === 'UNAUTHORIZED' ? ERROR_TEXT.unauthorized : ERROR_TEXT.unreachable,
          this.language,
        );
      }
      const value = await task(connection, tv, entry);
      this.logger.info(`${this.deviceName(tv.uid)}: ${label}`);
      return value;
    });
    // Show the effect soon; a device woken up gets its fast period back.
    clearTimeout(tv.timer);
    if (this.timers && !this.stopped) {
      tv.timer = setTimeout(() => {
        tv.timer = null;
        this.read(tv, { force: true }).catch(() => {});
      }, AFTER_COMMAND_MS);
    }
    return result;
  }

  /** onSetValue: power, application, volume, keys. */
  async setValue(device, feature, value) {
    const tv = this.tvFor(device.external_id);
    const suffix = tv?.uid
      ? feature.external_id.slice(deviceIds(this.gladys, tv.uid).device.length + 1)
      : null;
    if (suffix === 'power') {
      const on = Number(value) === 1;
      return this.command(
        device.external_id,
        on ? 'turn on' : 'turn off',
        (connection, _tv, entry) => connection.shell(powerCommand(on, entry.fireTv)),
      );
    }
    if (suffix === 'app') {
      return this.launchPackage(device.external_id, String(value));
    }
    if (suffix === 'volume') {
      return this.setVolume(device.external_id, Number(value));
    }
    if (suffix?.startsWith('key-')) {
      return this.sendKey(device.external_id, suffix.slice('key-'.length));
    }
    throw new Error(`No command for ${feature.external_id}`);
  }

  async sendKey(externalId, keyId, count = 1) {
    const key = findKey(keyId);
    if (!key) {
      throw localizedError(ERROR_TEXT.unknownKey, this.language, keyId);
    }
    const times = Math.min(Math.max(Math.trunc(Number(count)) || 1, 1), 20);
    return this.command(externalId, `key ${key.id}${times > 1 ? ` x${times}` : ''}`, (connection) =>
      connection.shell(keyCommand(key.code, times)),
    );
  }

  async setVolume(externalId, percent) {
    return this.command(externalId, `volume ${percent} %`, async (connection, tv, entry) => {
      let max = tv.snapshot?.audio?.max;
      if (!max) {
        max = parseState(await connection.shell(STATE_COMMAND, { timeoutMs: 8000 })).audio.max;
      }
      if (!max) {
        throw localizedError(ERROR_TEXT.noVolume, this.language);
      }
      const index = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * max);
      await connection.shell(volumeCommand(index, entry.sdk ?? 0));
    });
  }

  /** Starts an application by package name. */
  async launchPackage(externalId, pkg) {
    if (!isValidPackage(pkg)) {
      throw localizedError(ERROR_TEXT.invalidPackage, this.language, pkg);
    }
    return this.command(externalId, `launch ${appName(pkg, 'en')}`, (connection, _tv, entry) =>
      this.launch(connection, entry, [pkg]),
    );
  }

  /**
   * Starts an application by key (one of APPS) or by package name: the first
   * package of the key that is installed, else each in turn.
   */
  async launchApp(externalId, { app, pkg }) {
    if (pkg) {
      return this.launchPackage(externalId, pkg);
    }
    const known = findAppByKey(app);
    if (!known) {
      throw localizedError(ERROR_TEXT.noApp, this.language);
    }
    return this.command(
      externalId,
      `launch ${appName(known.packages[0], 'en')}`,
      (connection, _tv, entry) => {
        const installed = known.packages.filter((p) => (entry.apps ?? []).includes(p));
        return this.launch(connection, entry, installed.length > 0 ? installed : known.packages);
      },
    );
  }

  /** @returns {Promise<string>} the package started */
  async launch(connection, entry, candidates) {
    for (const pkg of candidates) {
      if (HOME_PACKAGES.has(pkg)) {
        await connection.shell(keyCommand(findKey('home').code));
        return pkg;
      }
      // Fire TV lists its applications under LAUNCHER, Android TV under LEANBACK_LAUNCHER.
      const categories = entry.fireTv
        ? [LAUNCHER, LEANBACK_LAUNCHER]
        : [LEANBACK_LAUNCHER, LAUNCHER];
      for (const category of categories) {
        const output = await connection.shell(launchCommand(pkg, category), { timeoutMs: 15_000 });
        if (/Events injected: 1/.test(output)) {
          return pkg;
        }
      }
    }
    throw localizedError(
      ERROR_TEXT.notLaunchable,
      this.language,
      appName(candidates[0], this.language),
    );
  }

  async openUrl(externalId, url, pkg) {
    if (!normalizeUrl(url)) {
      throw localizedError(ERROR_TEXT.invalidUrl, this.language);
    }
    if (pkg && !isValidPackage(pkg)) {
      throw localizedError(ERROR_TEXT.invalidPackage, this.language, pkg);
    }
    return this.command(externalId, 'open an address', async (connection) => {
      const output = await connection.shell(openUrlCommand(url, pkg || undefined), {
        timeoutMs: 15_000,
      });
      if (/^Error/m.test(output)) {
        throw localizedError(ERROR_TEXT.urlRefused, this.language);
      }
    });
  }

  /**
   * The "Connect the devices" action: connects to every address now, opening
   * the prompt where the key is unknown, and reports.
   * @returns {Promise<object>} a multi-language message
   */
  async connectAll() {
    if (!this.config || this.config.hosts.length === 0) {
      return CONNECT_TEXT.none;
    }
    const lines = [
      localize((lang) => CONNECT_TEXT.fingerprint[lang](keyFingerprint(this.store.privateKey))),
    ];
    // In parallel: each device may wait for its prompt, within the action timeout.
    const reports = [...this.tvs.values()].map(async (tv) => {
      const line = await this.exclusive(tv, async () => {
        try {
          this.closeConnection(tv);
          await this.connect(tv, { prompt: true });
          const entry = this.store.get(tv.uid);
          this.issues.recover(tv.address);
          const name = defaultName(entry);
          return localize((lang) => CONNECT_TEXT.connected[lang](tv.address, name));
        } catch (err) {
          await this.onFailure(tv, err);
          const kind = { unauthorized: 'unauthorized', unreachable: 'unreachable', tls: 'tls' }[
            tv.status
          ];
          return localize((lang) =>
            kind
              ? CONNECT_TEXT[kind][lang](tv.address)
              : CONNECT_TEXT.failed[lang](tv.address, err.message),
          );
        }
      });
      this.schedule(tv, 0);
      return line;
    });
    lines.push(...(await Promise.all(reports)), CONNECT_TEXT.scan);
    await this.publishDevices();
    await this.updateConnectionStatus();
    return localize((lang) => lines.map((line) => line[lang]).join(' '));
  }

  /** A scan from Discovery: tries the addresses not identified yet, publishes. */
  async rescan() {
    await Promise.all(
      [...this.tvs.values()]
        .filter((tv) => !tv.uid || !this.store.get(tv.uid))
        .map((tv) => this.read(tv, { force: true })),
    );
    await this.publishDevices();
  }

  /** What the widget shows of a device. */
  widgetState(externalId) {
    const tv = this.tvFor(externalId);
    if (!tv) {
      return null;
    }
    return {
      name: this.deviceName(tv.uid),
      status: tv.status,
      snapshot: tv.snapshot,
    };
  }
}

// -----------------------------------------------------------------------------
// What the integration keeps under /data, the only writable volume:
//
// - `adbkey`: the private RSA key the devices authorized ("Always allow from
//   this computer"). Losing it means approving the prompt again on every
//   device. Mode 0600, never logged, never sent anywhere but as signatures.
// - `androidtv-adb.json`: the devices identified so far (address, serial or
//   MAC, model, Android version, whether the volume is readable, installed
//   applications), so they are published to Gladys even while they are off.
//
// A read-only or missing /data is not fatal: the integration runs from
// memory and says it once (the key then changes at every restart).
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatePrivateKey } from './adb/keys.js';

const STATE_VERSION = 1;

export class Store {
  /**
   * @param {object} options
   * @param {string} options.dir usually /data
   * @param {object} options.logger
   */
  constructor({ dir, logger }) {
    this.dir = dir;
    this.logger = logger;
    this.privateKey = null;
    /** @type {Record<string, object>} identified devices, by platform id */
    this.devices = {};
    this.writing = Promise.resolve();
    this.writeFailed = false;
  }

  get keyPath() {
    return join(this.dir, 'adbkey');
  }

  get statePath() {
    return join(this.dir, 'androidtv-adb.json');
  }

  /** Loads the key (or creates it) and the known devices. */
  async load() {
    try {
      this.privateKey = await readFile(this.keyPath, 'utf8');
    } catch {
      this.privateKey = null;
    }
    if (!this.privateKey?.includes('PRIVATE KEY')) {
      this.privateKey = generatePrivateKey();
      try {
        await mkdir(this.dir, { recursive: true });
        await writeFile(this.keyPath, this.privateKey, { mode: 0o600 });
        this.logger.info('New ADB key created: each device asks once to allow it');
      } catch (err) {
        this.logger.warn(
          `Cannot save the ADB key under ${this.dir} (${err.code ?? err.message}): devices will ask again after a restart`,
        );
      }
    }
    try {
      const saved = JSON.parse(await readFile(this.statePath, 'utf8'));
      if (saved?.version === STATE_VERSION && saved.devices && typeof saved.devices === 'object') {
        this.devices = saved.devices;
      }
    } catch {
      this.devices = {};
    }
  }

  /** @param {string} address host:port */
  findByAddress(address) {
    const entry = Object.entries(this.devices).find(([, device]) => device.address === address);
    return entry ? { uid: entry[0], ...entry[1] } : null;
  }

  /** @param {string} uid */
  get(uid) {
    const device = this.devices[uid];
    return device ? { uid, ...device } : null;
  }

  /**
   * Merges what is known of a device, and saves when something changed.
   * Another device that had the same address loses it (DHCP moved them).
   * @returns {boolean} true when something changed
   */
  update(uid, values) {
    const previous = this.devices[uid] ?? {};
    const next = { ...previous, ...values };
    let changed = JSON.stringify(previous) !== JSON.stringify(next);
    if (values.address) {
      for (const [otherUid, other] of Object.entries(this.devices)) {
        if (otherUid !== uid && other.address === values.address) {
          this.devices[otherUid] = { ...other, address: null };
          changed = true;
        }
      }
    }
    if (changed) {
      this.devices[uid] = next;
      this.save();
    }
    return changed;
  }

  /** Writes the state file (atomically, one write at a time). */
  save() {
    const content = JSON.stringify({ version: STATE_VERSION, devices: this.devices }, null, 2);
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(this.dir, { recursive: true });
        const temporary = `${this.statePath}.tmp`;
        await writeFile(temporary, content);
        await rename(temporary, this.statePath);
        if (this.writeFailed) {
          this.writeFailed = false;
          this.logger.info(`${this.statePath} is writable again`);
        }
      } catch (err) {
        if (!this.writeFailed) {
          this.writeFailed = true;
          this.logger.warn(`Cannot write ${this.statePath} (${err.code ?? err.message})`);
        }
      }
    });
    return this.writing;
  }

  /** Resolves once the pending writes are done (shutdown, tests). */
  flush() {
    return this.writing;
  }
}

// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT } from './adb/connection.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  hosts: '',
  poll_interval: 10,
  language: 'fr',
};

/** Seconds between two reads of a device that is on (bounds of the manifest field). */
export const MIN_POLL_INTERVAL = 5;
export const MAX_POLL_INTERVAL = 60;

/** Seconds between two reads of a device in standby or unreachable. */
export const STANDBY_INTERVAL = 60;

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const MAX_HOSTS = 32;

/**
 * Parses the device list: IP addresses (or resolvable names), with an
 * optional port, separated by commas, semicolons, spaces or new lines.
 * @param {unknown} raw
 * @returns {{ hosts: { host: string, port: number, address: string }[], invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const entries = typeof raw === 'string' ? raw.split(/[\s,;]+/) : [];
  for (const entry of entries) {
    const text = entry
      .trim()
      .replace(/^(adb|tcp|https?):\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (!text) {
      continue;
    }
    const parsed = parseHost(text);
    if (!parsed) {
      invalid.push(entry.trim());
    } else if (!hosts.some((h) => h.address === parsed.address) && hosts.length < MAX_HOSTS) {
      hosts.push(parsed);
    }
  }
  return { hosts, invalid };
}

function parseHost(text) {
  const match = text.match(/^(.+?)(?::(\d{1,5}))?$/);
  const host = match[1];
  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2]);
  if (port < 1 || port > 65535) {
    return null;
  }
  const ipv4 = host.match(IPV4_PATTERN);
  if (ipv4) {
    if (!ipv4.slice(1).every((part) => Number(part) <= 255)) {
      return null;
    }
  } else if (/^[\d.]+$/.test(host) || !NAME_PATTERN.test(host)) {
    // Digits and dots only: a mistyped address, not a name.
    return null;
  }
  return { host, port, address: `${host}:${port}` };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(
    typeof source.hosts === 'string' ? source.hosts : DEFAULT_CONFIG.hosts,
  );
  const interval = Math.round(Number(source.poll_interval ?? DEFAULT_CONFIG.poll_interval));
  return {
    hosts,
    invalidHosts: invalid,
    pollInterval: Number.isFinite(interval)
      ? Math.min(Math.max(interval, MIN_POLL_INTERVAL), MAX_POLL_INTERVAL)
      : DEFAULT_CONFIG.poll_interval,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

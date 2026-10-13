// -----------------------------------------------------------------------------
// An Android TV / Fire TV device seen by Gladys: one device per TV or box,
// identified by its serial number (else its MAC address), never by its IP
// address, which DHCP may change.
//
// Features (the `key` after the device external id never changes):
//   power         television/binary  screen on (1) or in standby (0); on/off
//   app           text/select        foreground application; choosing one launches it
//   playback      text/select (read) playing, paused, stopped, idle, screensaver, off
//   volume        television/volume  music stream volume, in %, when the device reports it
//   key-<id>      television push buttons (src/tv/keys.js)
//
// The devices are published with `should_poll` and a 30 s `poll_frequency`
// for the core's fallback onPoll, but the integration reads them itself
// (src/hub.js, GladysAssistant/Gladys#3198).
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { appName, findAppByPackage } from './tv/apps.js';
import { FEATURE_KEYS } from './tv/keys.js';

export const DEVICE_TYPE = 'androidtv';

/** Feature names, frozen at creation in the language of the config. */
export const NAMES = {
  en: { power: 'Power', app: 'Application', playback: 'Playback state', volume: 'Volume' },
  fr: { power: 'Alimentation', app: 'Application', playback: 'État de lecture', volume: 'Volume' },
  de: { power: 'Ein/Aus', app: 'App', playback: 'Wiedergabestatus', volume: 'Lautstärke' },
  es: {
    power: 'Encendido',
    app: 'Aplicación',
    playback: 'Estado de reproducción',
    volume: 'Volumen',
  },
};

/** Values of the `playback` feature, with their labels. */
export const PLAYBACK_STATES = {
  en: {
    playing: 'Playing',
    paused: 'Paused',
    stopped: 'Stopped',
    idle: 'Nothing playing',
    screensaver: 'Screensaver',
    off: 'Standby',
  },
  fr: {
    playing: 'Lecture en cours',
    paused: 'En pause',
    stopped: 'Arrêtée',
    idle: 'Aucune lecture',
    screensaver: "Économiseur d'écran",
    off: 'En veille',
  },
  de: {
    playing: 'Wiedergabe läuft',
    paused: 'Pausiert',
    stopped: 'Gestoppt',
    idle: 'Keine Wiedergabe',
    screensaver: 'Bildschirmschoner',
    off: 'Standby',
  },
  es: {
    playing: 'Reproduciendo',
    paused: 'En pausa',
    stopped: 'Detenida',
    idle: 'Sin reproducción',
    screensaver: 'Salvapantallas',
    off: 'En espera',
  },
};

export const PLAYBACK_VALUES = Object.keys(PLAYBACK_STATES.en);

// The core's fallback poll; the integration reads on its own timer.
const FALLBACK_POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_30_SECONDS;

// More applications than this in the selector is a list nobody scrolls.
const MAX_APP_OPTIONS = 80;

/** @param {object} gladys @param {string} uid platform id */
export function deviceIds(gladys, uid) {
  return gladys.externalIds(DEVICE_TYPE, uid);
}

/** The platform id inside a device (or feature) external id, or null. */
export function uidFromExternalId(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

/** "NVIDIA SHIELD Android TV", "Amazon AFTMM", or the address. */
export function defaultName(entry) {
  const { manufacturer, model, address } = entry;
  if (model && manufacturer && !model.toLowerCase().includes(manufacturer.toLowerCase())) {
    return `${manufacturer} ${model}`;
  }
  return model || manufacturer || `Android TV ${address}`;
}

/**
 * The application options: the launchable applications, the known ones first,
 * plus the foreground one (so the selector can show it).
 * @param {object} entry a store entry
 * @param {string} language
 */
export function appOptions(entry, language) {
  const packages = new Set(entry.apps ?? []);
  if (entry.currentApp) {
    packages.add(entry.currentApp);
  }
  const sorted = [...packages].sort((a, b) => {
    const knownA = findAppByPackage(a) ? 0 : 1;
    const knownB = findAppByPackage(b) ? 0 : 1;
    return (
      knownA - knownB || appName(a, language).localeCompare(appName(b, language), language) || 0
    );
  });
  return sorted.slice(0, MAX_APP_OPTIONS).map((pkg, index) => ({
    value: pkg,
    label: appName(pkg, language),
    sort_order: index,
  }));
}

/**
 * The discovery payload of one device.
 * @param {object} gladys
 * @param {object} entry a store entry ({ uid, address, manufacturer, model, volume, apps… })
 * @param {{ language: string }} config
 */
export function buildDevice(gladys, entry, config) {
  const ids = deviceIds(gladys, entry.uid);
  const names = NAMES[config.language];
  const feature = (key, values) => ({
    external_id: ids.feature(key),
    selector: ids.feature(key),
    ...values,
  });
  const features = [
    feature('power', {
      name: names.power,
      category: 'television',
      type: 'binary',
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    }),
    feature('app', {
      name: names.app,
      category: 'text',
      type: 'select',
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: appOptions(entry, config.language),
    }),
    feature('playback', {
      name: names.playback,
      category: 'text',
      type: 'select',
      min: 0,
      max: 0,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      supported_options: PLAYBACK_VALUES.map((value, index) => ({
        value,
        label: PLAYBACK_STATES[config.language][value],
        sort_order: index,
      })),
    }),
  ];
  if (entry.volume) {
    features.push(
      feature('volume', {
        name: names.volume,
        category: 'television',
        type: 'volume',
        unit: 'percent',
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      }),
    );
  }
  for (const key of FEATURE_KEYS) {
    features.push(
      feature(`key-${key.id}`, {
        name: key.name[config.language],
        category: 'television',
        type: key.type,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: false,
        keep_history: false,
      }),
    );
  }
  return {
    name: entry.name ?? defaultName(entry),
    external_id: ids.device,
    selector: ids.device,
    model: entry.model ?? undefined,
    should_poll: true,
    poll_frequency: FALLBACK_POLL_FREQUENCY,
    features,
    params: [{ name: 'ADB_ADDRESS', value: entry.address ?? '' }],
  };
}

/**
 * The `playback` value of a snapshot.
 * @param {{ screenOn: boolean|null, wakefulness: string|null, playback: string }} snapshot
 */
export function playbackValue(snapshot) {
  if (!snapshot.screenOn) {
    return 'off';
  }
  if (snapshot.wakefulness === 'Dreaming') {
    return 'screensaver';
  }
  return PLAYBACK_VALUES.includes(snapshot.playback) ? snapshot.playback : 'idle';
}

/**
 * The states of one snapshot, in the publishChangedStates format.
 * @param {object} gladys
 * @param {string} uid
 * @param {object} snapshot { screenOn, wakefulness, app, playback, audio }
 * @param {{ volume: boolean }} entry
 */
export function stateValues(gladys, uid, snapshot, entry) {
  const ids = deviceIds(gladys, uid);
  const states = [];
  if (snapshot.screenOn !== null) {
    states.push({
      device_feature_external_id: ids.feature('power'),
      state: snapshot.screenOn ? 1 : 0,
    });
  }
  if (snapshot.app) {
    states.push({ device_feature_external_id: ids.feature('app'), text: snapshot.app });
  }
  states.push({
    device_feature_external_id: ids.feature('playback'),
    text: playbackValue(snapshot),
  });
  if (entry.volume && snapshot.audio?.percent !== null && snapshot.audio?.percent !== undefined) {
    states.push({
      device_feature_external_id: ids.feature('volume'),
      state: snapshot.audio.percent,
    });
  }
  return states;
}

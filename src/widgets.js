// -----------------------------------------------------------------------------
// The "ADB remote" dashboard widget: the state of one device (on, standby,
// foreground application, playback, volume) and four buttons the user picks
// in the widget settings (four is the core's button budget per widget).
//
// The buttons are `action` buttons: they reach onWidgetAction, which presses
// the key over ADB; the core then pulls the content again by itself.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { PLAYBACK_STATES, playbackValue } from './devices.js';
import { appName } from './tv/apps.js';
import { findKey } from './tv/keys.js';

export const DEFAULT_BUTTONS = ['back', 'home', 'play_pause', 'power'];

export const TEXT = {
  state: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  app: { en: 'Application', fr: 'Application', de: 'App', es: 'Aplicación' },
  playback: { en: 'Playback', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproducción' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  muted: { en: 'Muted', fr: 'Muet', de: 'Stumm', es: 'Silenciado' },
  on: { en: 'On', fr: 'Allumé', de: 'An', es: 'Encendido' },
  screensaver: {
    en: 'Screensaver',
    fr: "Économiseur d'écran",
    de: 'Bildschirmschoner',
    es: 'Salvapantallas',
  },
  standby: { en: 'Standby', fr: 'En veille', de: 'Standby', es: 'En espera' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inalcanzable' },
  unauthorized: { en: 'Not allowed', fr: 'Non autorisé', de: 'Nicht erlaubt', es: 'No autorizado' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  pick: {
    en: 'Choose a device in the settings of this widget.',
    fr: 'Choisissez un appareil dans les réglages de ce widget.',
    de: 'Wähle ein Gerät in den Einstellungen dieses Widgets.',
    es: 'Elija un dispositivo en los ajustes de este widget.',
  },
  missing: {
    en: 'This device is no longer in the configuration of the integration.',
    fr: "Cet appareil n'est plus dans la configuration de l'intégration.",
    de: 'Dieses Gerät ist nicht mehr in der Konfiguration der Integration.',
    es: 'Este dispositivo ya no está en la configuración de la integración.',
  },
};

const lang = (language) => (['en', 'fr', 'de', 'es'].includes(language) ? language : 'en');

/** The state row: its label and colour. */
function stateRow(state, language) {
  const { status, snapshot } = state;
  let key = 'unknown';
  let color = WIDGET_COLORS.NEUTRAL;
  if (status === 'unauthorized') {
    [key, color] = ['unauthorized', WIDGET_COLORS.WARNING];
  } else if (status === 'unreachable' && !snapshot) {
    [key, color] = ['unreachable', WIDGET_COLORS.DANGER];
  } else if (snapshot?.screenOn === false || status === 'unreachable') {
    [key, color] = ['standby', WIDGET_COLORS.NEUTRAL];
  } else if (snapshot?.wakefulness === 'Dreaming') {
    [key, color] = ['screensaver', WIDGET_COLORS.INFO];
  } else if (snapshot?.screenOn) {
    [key, color] = ['on', WIDGET_COLORS.SUCCESS];
  }
  return { label: TEXT.state[language], value: TEXT[key][language], color };
}

/**
 * @param {import('./hub.js').Hub} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function remoteContent(hub, { settings = {}, language }) {
  const l = lang(language);
  if (!settings.device) {
    return { ttl_seconds: 300, components: [{ type: 'text', text: TEXT.pick[l] }] };
  }
  const state = hub.widgetState(settings.device);
  if (!state) {
    return { ttl_seconds: 300, components: [{ type: 'text', text: TEXT.missing[l] }] };
  }
  const { snapshot } = state;
  const items = [stateRow(state, l)];
  if (snapshot?.screenOn) {
    if (snapshot.app) {
      items.push({ label: TEXT.app[l], value: appName(snapshot.app, l).slice(0, 40) });
    }
    items.push({
      label: TEXT.playback[l],
      value: PLAYBACK_STATES[l][playbackValue(snapshot)],
      color: snapshot.playback === 'playing' ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
    if (snapshot.audio?.muted) {
      items.push({ label: TEXT.volume[l], value: TEXT.muted[l] });
    } else if (snapshot.audio?.percent !== null && snapshot.audio?.percent !== undefined) {
      items.push({ label: TEXT.volume[l], value: `${snapshot.audio.percent} %` });
    }
  }
  const buttons = DEFAULT_BUTTONS.map((fallback, index) => {
    const key = findKey(settings[`button_${index + 1}`]) ?? findKey(fallback);
    return {
      type: 'button',
      label: key.name[l],
      icon: key.icon,
      style: 'secondary',
      // Numbered keys: the core drops a button whose action key is taken.
      action: { key: `press_${index + 1}`, params: { key: key.id } },
    };
  });
  return {
    ttl_seconds: 30,
    components: [
      { type: 'text', variant: 'heading', text: state.name.slice(0, 40) },
      { type: 'status', items },
      ...buttons,
    ],
  };
}

export const WIDGETS = {
  remote: {
    get: (hub, request) => remoteContent(hub, request),
    action: (hub, { params, settings }) =>
      hub.sendKey(settings?.device, params?.key).then(() => undefined),
  },
};

// -----------------------------------------------------------------------------
// The remote keys: Android key codes (android.view.KeyEvent), the television
// feature type Gladys draws for them, a Feather icon for the widget buttons,
// and their names in the four languages.
//
// The ids are stored by users (scene action `send_key`, widget settings, the
// feature external ids `key-<id>`): they never change.
// -----------------------------------------------------------------------------

/**
 * `type`: the Gladys television push-button type, or null when the key is
 * only offered by the scene action and the widget (no feature).
 */
export const KEYS = [
  {
    id: 'home',
    code: 3,
    type: 'exit',
    icon: 'home',
    name: { en: 'Home', fr: 'Accueil', de: 'Startseite', es: 'Inicio' },
  },
  {
    id: 'back',
    code: 4,
    type: 'return',
    icon: 'corner-up-left',
    name: { en: 'Back', fr: 'Retour', de: 'Zurück', es: 'Atrás' },
  },
  {
    id: 'up',
    code: 19,
    type: 'up',
    icon: 'chevron-up',
    name: { en: 'Up', fr: 'Haut', de: 'Hoch', es: 'Arriba' },
  },
  {
    id: 'down',
    code: 20,
    type: 'down',
    icon: 'chevron-down',
    name: { en: 'Down', fr: 'Bas', de: 'Runter', es: 'Abajo' },
  },
  {
    id: 'left',
    code: 21,
    type: 'left',
    icon: 'chevron-left',
    name: { en: 'Left', fr: 'Gauche', de: 'Links', es: 'Izquierda' },
  },
  {
    id: 'right',
    code: 22,
    type: 'right',
    icon: 'chevron-right',
    name: { en: 'Right', fr: 'Droite', de: 'Rechts', es: 'Derecha' },
  },
  {
    id: 'ok',
    code: 23,
    type: 'enter',
    icon: 'circle',
    name: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  },
  {
    id: 'menu',
    code: 82,
    type: 'menu',
    icon: 'menu',
    name: { en: 'Menu', fr: 'Menu', de: 'Menü', es: 'Menú' },
  },
  {
    id: 'play_pause',
    code: 85,
    type: null,
    icon: 'play-circle',
    name: { en: 'Play/Pause', fr: 'Lecture/Pause', de: 'Wiedergabe/Pause', es: 'Reproducir/Pausa' },
  },
  {
    id: 'play',
    code: 126,
    type: 'play',
    icon: 'play',
    name: { en: 'Play', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproducir' },
  },
  {
    id: 'pause',
    code: 127,
    type: 'pause',
    icon: 'pause',
    name: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  },
  {
    id: 'stop',
    code: 86,
    type: 'stop',
    icon: 'square',
    name: { en: 'Stop', fr: 'Stop', de: 'Stopp', es: 'Detener' },
  },
  {
    id: 'next',
    code: 87,
    type: 'next',
    icon: 'skip-forward',
    name: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  },
  {
    id: 'previous',
    code: 88,
    type: 'previous',
    icon: 'skip-back',
    name: { en: 'Previous', fr: 'Précédent', de: 'Zurück (Titel)', es: 'Anterior' },
  },
  {
    id: 'rewind',
    code: 89,
    type: 'rewind',
    icon: 'rewind',
    name: { en: 'Rewind', fr: 'Retour rapide', de: 'Zurückspulen', es: 'Retroceder' },
  },
  {
    id: 'fast_forward',
    code: 90,
    type: 'forward',
    icon: 'fast-forward',
    name: { en: 'Fast forward', fr: 'Avance rapide', de: 'Vorspulen', es: 'Avanzar' },
  },
  {
    id: 'volume_up',
    code: 24,
    type: 'volume-up',
    icon: 'volume-2',
    name: { en: 'Volume up', fr: 'Volume +', de: 'Lauter', es: 'Subir volumen' },
  },
  {
    id: 'volume_down',
    code: 25,
    type: 'volume-down',
    icon: 'volume-1',
    name: { en: 'Volume down', fr: 'Volume -', de: 'Leiser', es: 'Bajar volumen' },
  },
  {
    id: 'mute',
    code: 164,
    type: 'volume-mute',
    icon: 'volume-x',
    name: { en: 'Mute', fr: 'Muet', de: 'Stumm', es: 'Silencio' },
  },
  {
    id: 'power',
    code: 26,
    type: null,
    icon: 'power',
    name: { en: 'Power', fr: 'Marche/Arrêt', de: 'Ein/Aus', es: 'Encendido' },
  },
  {
    id: 'settings',
    code: 176,
    type: null,
    icon: 'settings',
    name: { en: 'Settings', fr: 'Paramètres', de: 'Einstellungen', es: 'Ajustes' },
  },
  {
    id: 'search',
    code: 84,
    type: null,
    icon: 'search',
    name: { en: 'Search', fr: 'Recherche', de: 'Suche', es: 'Buscar' },
  },
];

export const KEY_IDS = KEYS.map((key) => key.id);

/** @param {string} id */
export function findKey(id) {
  return KEYS.find((key) => key.id === id);
}

/** The keys published as television features, in this order. */
export const FEATURE_KEYS = KEYS.filter((key) => key.type !== null);

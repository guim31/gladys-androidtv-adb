// -----------------------------------------------------------------------------
// Readable names of the common Android TV / Fire TV applications.
//
// An application is known by its package name (com.netflix.ninja), and the
// same service often ships several packages (YouTube for Android TV, for Fire
// TV…): `key` groups them. The keys are stored by users (scene action
// `launch_app`, trigger filter `app_opened`): they never change.
//
// Package names come from python-androidtv (androidtv/constants.py, MIT,
// Jeff Irion), completed with French services. Only the names are kept.
// -----------------------------------------------------------------------------

export const APPS = [
  { key: 'netflix', name: 'Netflix', packages: ['com.netflix.ninja'] },
  {
    key: 'youtube',
    name: 'YouTube',
    packages: ['com.google.android.youtube.tv', 'com.amazon.firetv.youtube'],
  },
  {
    key: 'prime_video',
    name: 'Prime Video',
    packages: [
      'com.amazon.amazonvideo.livingroom',
      'com.amazon.firebat',
      'com.amazon.avod.thirdpartyclient',
      'com.amazon.avod',
    ],
  },
  { key: 'disney_plus', name: 'Disney+', packages: ['com.disney.disneyplus'] },
  {
    key: 'apple_tv',
    name: 'Apple TV',
    packages: [
      'com.apple.atve.android.appletv',
      'com.apple.atve.amazon.appletv',
      'com.apple.atve.sony.appletv',
    ],
  },
  { key: 'max', name: 'Max', packages: ['com.wbd.stream', 'com.hbo.hbonow'] },
  { key: 'paramount_plus', name: 'Paramount+', packages: ['com.cbs.ott'] },
  { key: 'canal_plus', name: 'myCANAL', packages: ['com.canal.android.canal'] },
  { key: 'molotov', name: 'Molotov', packages: ['tv.molotov.app'] },
  { key: 'france_tv', name: 'france.tv', packages: ['fr.francetv.pluzz'] },
  { key: 'arte', name: 'Arte', packages: ['tv.arte.plus7'] },
  { key: 'spotify', name: 'Spotify', packages: ['com.spotify.tv.android'] },
  { key: 'deezer', name: 'Deezer', packages: ['deezer.android.tv'] },
  { key: 'youtube_music', name: 'YouTube Music', packages: ['com.google.android.youtube.tvmusic'] },
  {
    key: 'youtube_kids',
    name: 'YouTube Kids',
    packages: ['com.google.android.youtube.tvkids', 'com.amazon.firetv.youtube.kids'],
  },
  {
    key: 'twitch',
    name: 'Twitch',
    packages: ['tv.twitch.android.app', 'tv.twitch.android.viewer'],
  },
  { key: 'plex', name: 'Plex', packages: ['com.plexapp.android'] },
  { key: 'jellyfin', name: 'Jellyfin', packages: ['org.jellyfin.androidtv'] },
  { key: 'emby', name: 'Emby', packages: ['tv.emby.embyatv'] },
  { key: 'kodi', name: 'Kodi', packages: ['org.xbmc.kodi'] },
  { key: 'vlc', name: 'VLC', packages: ['org.videolan.vlc'] },
  { key: 'steam_link', name: 'Steam Link', packages: ['com.valvesoftware.steamlink'] },
  { key: 'google_cast', name: 'Google Cast', packages: ['com.google.android.apps.mediashell'] },
  { key: 'play_store', name: 'Google Play', packages: ['com.android.vending'] },
  { key: 'appstore', name: 'Amazon Appstore', packages: ['com.amazon.venezia'] },
  {
    key: 'settings',
    name: { en: 'Settings', fr: 'Paramètres', de: 'Einstellungen', es: 'Ajustes' },
    packages: ['com.android.tv.settings', 'com.amazon.tv.settings', 'com.amazon.tv.settings.v2'],
  },
  {
    key: 'home',
    name: {
      en: 'Home screen',
      fr: "Écran d'accueil",
      de: 'Startbildschirm',
      es: 'Pantalla de inicio',
    },
    packages: [
      'com.google.android.tvlauncher',
      'com.google.android.apps.tv.launcherx',
      'com.google.android.leanbacklauncher',
      'com.amazon.tv.launcher',
    ],
  },
];

export const APP_KEYS = APPS.map((app) => app.key);

const BY_PACKAGE = new Map(APPS.flatMap((app) => app.packages.map((pkg) => [pkg, app])));

/** @param {string} pkg */
export function findAppByPackage(pkg) {
  return BY_PACKAGE.get(pkg);
}

/** @param {string} key */
export function findAppByKey(key) {
  return APPS.find((app) => app.key === key);
}

/**
 * The readable name of a package: the known name, else the package itself.
 * @param {string} pkg
 * @param {string} language
 */
export function appName(pkg, language) {
  const app = BY_PACKAGE.get(pkg);
  if (!app) {
    return pkg;
  }
  return typeof app.name === 'string' ? app.name : app.name[language];
}

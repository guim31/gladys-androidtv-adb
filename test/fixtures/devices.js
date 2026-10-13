// -----------------------------------------------------------------------------
// Device profiles: what each model answers to the commands of
// src/tv/commands.js. See test/fixtures/README.md for where every format
// comes from. Serial numbers and MAC addresses are invented (MACs in the
// documentation range 00:00:5e:00:53:xx, RFC 7042).
// -----------------------------------------------------------------------------

/** NVIDIA SHIELD TV (2019), Android 11 — the model tested for real after the PR. */
export const SHIELD = {
  label: 'NVIDIA SHIELD Android TV (Android 11)',
  info: {
    manufacturer: 'NVIDIA',
    model: 'SHIELD Android TV',
    serial: '0423119000001',
    release: '11',
    sdk: '30',
    eth: '00:00:5e:00:53:01',
    wlan: '00:00:5e:00:53:02',
  },
  dialect: { activity: 'android9', media: 'numeric' },
  launcher: 'com.google.android.tvlauncher',
  launchCategory: 'android.intent.category.LEANBACK_LAUNCHER',
  queryComponents: true,
  installed: [
    'com.google.android.tvlauncher',
    'com.android.tv.settings',
    'com.android.vending',
    'com.netflix.ninja',
    'com.google.android.youtube.tv',
    'com.amazon.amazonvideo.livingroom',
    'com.disney.disneyplus',
    'com.plexapp.android',
    'com.spotify.tv.android',
    'com.nvidia.ota',
    'org.videolan.vlc',
  ],
  // Packages with no launcher activity (services): never offered.
  services: ['com.nvidia.ota'],
  audio: { device: 'hdmi', max: 15, index: 15, muted: false, layout: 'android11' },
};

/** Amazon Fire TV Stick 4K (AFTMM), Fire OS 7 (Android 9). */
export const FIRE_TV = {
  label: 'Amazon Fire TV Stick 4K (Fire OS 7)',
  info: {
    manufacturer: 'Amazon',
    model: 'AFTMM',
    serial: 'G070VM0000000001',
    release: '9',
    sdk: '28',
    eth: null,
    wlan: '00:00:5e:00:53:03',
  },
  dialect: { activity: 'android9', media: 'numeric' },
  launcher: 'com.amazon.tv.launcher',
  launchCategory: 'android.intent.category.LAUNCHER',
  queryComponents: true,
  installed: [
    'com.amazon.tv.launcher',
    'com.amazon.tv.settings.v2',
    'com.amazon.venezia',
    'com.amazon.firebat',
    'com.netflix.ninja',
    'com.amazon.firetv.youtube',
    'com.canal.android.canal',
    'org.xbmc.kodi',
  ],
  services: [],
  audio: { device: 'hdmi', max: 15, index: 11, muted: false, layout: 'android9' },
};

/** Chromecast with Google TV, Android 12 (Google TV launcher). */
export const CHROMECAST = {
  label: 'Chromecast with Google TV (Android 12)',
  info: {
    manufacturer: 'Google',
    model: 'Chromecast',
    serial: '29031HFDD00001',
    release: '12',
    sdk: '31',
    eth: null,
    wlan: '00:00:5e:00:53:04',
  },
  dialect: { activity: 'android12', media: 'numeric' },
  launcher: 'com.google.android.apps.tv.launcherx',
  launchCategory: 'android.intent.category.LEANBACK_LAUNCHER',
  queryComponents: true,
  installed: [
    'com.google.android.apps.tv.launcherx',
    'com.android.tv.settings',
    'com.google.android.youtube.tv',
    'com.netflix.ninja',
    'com.google.android.apps.mediashell',
    'tv.molotov.app',
  ],
  services: ['com.google.android.apps.mediashell'],
  audio: { device: 'hdmi', max: 25, index: 10, muted: false, layout: 'android11' },
};

/**
 * Sony BRAVIA (Android TV 9): the volume block and the focused-window lines
 * are those of python-androidtv's tests; its activity dump is not grepped
 * (the window fallback is), and `query-activities --components` is missing.
 */
export const BRAVIA = {
  label: 'Sony BRAVIA 4K GB (Android 9)',
  info: {
    manufacturer: 'Sony',
    model: 'BRAVIA 4K GB',
    serial: 'SONYTV0000001',
    release: '9',
    sdk: '28',
    eth: '00:00:5e:00:53:05',
    wlan: '00:00:5e:00:53:06',
  },
  dialect: { activity: 'window', media: 'numeric' },
  launcher: 'com.google.android.tvlauncher',
  launchCategory: 'android.intent.category.LEANBACK_LAUNCHER',
  queryComponents: false,
  installed: [
    'com.google.android.tvlauncher',
    'com.sony.dtv.tvx',
    'com.netflix.ninja',
    'com.google.android.youtube.tv',
    'tunein.player',
  ],
  services: [],
  audio: { device: 'hmdi_arc', max: 60, index: 22, muted: false, layout: 'sony' },
};

/** Android 13 TV box: `state=PLAYING(3)` in media_session, imeLayering lines. */
export const ANDROID13 = {
  label: 'Generic Android TV 13 box',
  info: {
    manufacturer: 'Xiaomi',
    model: 'MIBOX4',
    serial: '',
    release: '13',
    sdk: '33',
    eth: '00:00:5e:00:53:07',
    wlan: null,
  },
  dialect: { activity: 'android12', media: 'named' },
  launcher: 'com.google.android.tvlauncher',
  launchCategory: 'android.intent.category.LEANBACK_LAUNCHER',
  queryComponents: true,
  installed: ['com.google.android.tvlauncher', 'com.netflix.ninja', 'com.spotify.tv.android'],
  services: [],
  audio: { device: 'hdmi', max: 15, index: 6, muted: true, layout: 'android11' },
};

export const PROFILES = [SHIELD, FIRE_TV, CHROMECAST, BRAVIA, ANDROID13];

/** The main activity of the packages the profiles start. */
export const ACTIVITIES = {
  'com.google.android.tvlauncher': '.MainActivity',
  'com.google.android.apps.tv.launcherx': '.home.HomeActivity',
  'com.amazon.tv.launcher': '.ui.HomeActivity_vNext',
  'com.netflix.ninja': '.MainActivity',
  'com.google.android.youtube.tv': 'com.google.android.apps.youtube.tv.activity.ShellActivity',
  'com.amazon.firetv.youtube': 'dev.cobalt.app.MainActivity',
  'com.spotify.tv.android': '.SpotifyTVActivity',
};

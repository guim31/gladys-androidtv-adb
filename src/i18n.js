// -----------------------------------------------------------------------------
// Every text the integration produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js checks it).
// Brands are not translated.
// -----------------------------------------------------------------------------

/** Builds a { en, fr, de, es } object from a function of the language. */
export function localize(build) {
  return Object.fromEntries(['en', 'fr', 'de', 'es'].map((lang) => [lang, build(lang)]));
}

/** Connection status shown in the Configuration screen. */
export const STATUS_TEXT = {
  noDevice: {
    en: 'Type the IP address of your Android TV or Fire TV in the configuration.',
    fr: "Saisissez l'adresse IP de votre Android TV ou Fire TV dans la configuration.",
    de: 'Gib die IP-Adresse deines Android TV oder Fire TV in der Konfiguration ein.',
    es: 'Introduzca la dirección IP de su Android TV o Fire TV en la configuración.',
  },
  invalid: {
    en: (list) => `Not an IP address: ${list}.`,
    fr: (list) => `Adresse IP non valide : ${list}.`,
    de: (list) => `Keine gültige IP-Adresse: ${list}.`,
    es: (list) => `Dirección IP no válida: ${list}.`,
  },
  unauthorized: {
    en: (list) =>
      `Allow debugging on the screen of ${list} (tick "Always allow"), or run "Connect the devices".`,
    fr: (list) =>
      `Autorisez le débogage sur l'écran de ${list} (cochez « Toujours autoriser »), ou lancez « Connecter les appareils ».`,
    de: (list) =>
      `Erlaube das Debugging auf dem Bildschirm von ${list} („Immer zulassen“ ankreuzen) oder starte „Geräte verbinden“.`,
    es: (list) =>
      `Autorice la depuración en la pantalla de ${list} (marque «Permitir siempre») o ejecute «Conectar los dispositivos».`,
  },
  unreachable: {
    en: (list) =>
      `Never reached: ${list}. Check the address, that the device is on and that network debugging is enabled.`,
    fr: (list) =>
      `Jamais joint : ${list}. Vérifiez l'adresse, que l'appareil est allumé et que le débogage réseau est activé.`,
    de: (list) =>
      `Nie erreicht: ${list}. Prüfe die Adresse, ob das Gerät eingeschaltet und das Netzwerk-Debugging aktiv ist.`,
    es: (list) =>
      `Nunca alcanzado: ${list}. Compruebe la dirección, que el dispositivo esté encendido y que la depuración por red esté activada.`,
  },
  tls: {
    en: (list) =>
      `${list}: this is a wireless debugging (pairing) port. Use network ADB on port 5555 instead.`,
    fr: (list) =>
      `${list} : c'est un port de débogage sans fil (appairage). Utilisez l'ADB réseau sur le port 5555.`,
    de: (list) =>
      `${list}: Das ist ein Port für kabelloses Debugging (Kopplung). Nutze stattdessen Netzwerk-ADB auf Port 5555.`,
    es: (list) =>
      `${list}: es un puerto de depuración inalámbrica (emparejamiento). Use ADB por red en el puerto 5555.`,
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Protokollen der Integration nach.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

/** Lines of the report of the "Connect the devices" action. */
export const CONNECT_TEXT = {
  none: STATUS_TEXT.noDevice,
  fingerprint: {
    en: (fp) => `Key of Gladys: ${fp}.`,
    fr: (fp) => `Clé de Gladys : ${fp}.`,
    de: (fp) => `Schlüssel von Gladys: ${fp}.`,
    es: (fp) => `Clave de Gladys: ${fp}.`,
  },
  connected: {
    en: (address, name) => `${address}: connected to ${name}.`,
    fr: (address, name) => `${address} : connecté à ${name}.`,
    de: (address, name) => `${address}: mit ${name} verbunden.`,
    es: (address, name) => `${address}: conectado a ${name}.`,
  },
  unauthorized: {
    en: (address) =>
      `${address}: not allowed. Accept the prompt on the screen and tick "Always allow".`,
    fr: (address) =>
      `${address} : non autorisé. Acceptez la demande à l'écran et cochez « Toujours autoriser ».`,
    de: (address) =>
      `${address}: nicht erlaubt. Bestätige die Anfrage auf dem Bildschirm und kreuze „Immer zulassen“ an.`,
    es: (address) =>
      `${address}: no autorizado. Acepte la solicitud en la pantalla y marque «Permitir siempre».`,
  },
  unreachable: {
    en: (address) => `${address}: unreachable. Is it on, with network debugging enabled?`,
    fr: (address) => `${address} : injoignable. Est-il allumé, avec le débogage réseau activé ?`,
    de: (address) =>
      `${address}: nicht erreichbar. Ist es eingeschaltet und das Netzwerk-Debugging aktiv?`,
    es: (address) =>
      `${address}: inalcanzable. ¿Está encendido y con la depuración por red activada?`,
  },
  tls: STATUS_TEXT.tls,
  failed: {
    en: (address, reason) => `${address}: failed (${reason}).`,
    fr: (address, reason) => `${address} : échec (${reason}).`,
    de: (address, reason) => `${address}: fehlgeschlagen (${reason}).`,
    es: (address, reason) => `${address}: error (${reason}).`,
  },
  scan: {
    en: 'Then open Discovery to add the devices.',
    fr: "Ouvrez ensuite l'onglet Découverte pour ajouter les appareils.",
    de: 'Öffne danach den Reiter „Entdecken“, um die Geräte hinzuzufügen.',
    es: 'Abra después la pestaña «Descubrir» para añadir los dispositivos.',
  },
};

/** Errors shown when a command fails (ack of a control, scene action, widget). */
export const ERROR_TEXT = {
  unknownDevice: {
    en: 'Unknown device: run "Connect the devices" in the configuration.',
    fr: 'Appareil inconnu : lancez « Connecter les appareils » dans la configuration.',
    de: 'Unbekanntes Gerät: Starte „Geräte verbinden“ in der Konfiguration.',
    es: 'Dispositivo desconocido: ejecute «Conectar los dispositivos» en la configuración.',
  },
  unreachable: {
    en: 'The device does not answer (off, or network debugging disabled).',
    fr: "L'appareil ne répond pas (éteint, ou débogage réseau désactivé).",
    de: 'Das Gerät antwortet nicht (aus oder Netzwerk-Debugging deaktiviert).',
    es: 'El dispositivo no responde (apagado o depuración por red desactivada).',
  },
  unauthorized: {
    en: 'Gladys is not allowed on this device yet: accept the prompt on the screen.',
    fr: "Gladys n'est pas encore autorisé sur cet appareil : acceptez la demande à l'écran.",
    de: 'Gladys ist auf diesem Gerät noch nicht erlaubt: Bestätige die Anfrage auf dem Bildschirm.',
    es: 'Gladys aún no está autorizado en este dispositivo: acepte la solicitud en la pantalla.',
  },
  notLaunchable: {
    en: (app) => `${app} is not installed, or cannot be opened from the home screen.`,
    fr: (app) => `${app} n'est pas installée, ou ne s'ouvre pas depuis l'écran d'accueil.`,
    de: (app) => `${app} ist nicht installiert oder lässt sich nicht vom Startbildschirm öffnen.`,
    es: (app) => `${app} no está instalada o no se puede abrir desde la pantalla de inicio.`,
  },
  noApp: {
    en: 'Choose an application, or type its package name.',
    fr: 'Choisissez une application, ou saisissez son nom de paquet.',
    de: 'Wähle eine App oder gib ihren Paketnamen ein.',
    es: 'Elija una aplicación o introduzca su nombre de paquete.',
  },
  invalidPackage: {
    en: (pkg) => `"${pkg}" is not a package name (e.g. com.netflix.ninja).`,
    fr: (pkg) => `« ${pkg} » n'est pas un nom de paquet (ex. com.netflix.ninja).`,
    de: (pkg) => `„${pkg}“ ist kein Paketname (z. B. com.netflix.ninja).`,
    es: (pkg) => `«${pkg}» no es un nombre de paquete (p. ej. com.netflix.ninja).`,
  },
  invalidUrl: {
    en: 'Only http, https, rtsp and rtmp addresses can be opened.',
    fr: 'Seules les adresses http, https, rtsp et rtmp peuvent être ouvertes.',
    de: 'Nur http-, https-, rtsp- und rtmp-Adressen können geöffnet werden.',
    es: 'Solo se pueden abrir direcciones http, https, rtsp y rtmp.',
  },
  urlRefused: {
    en: 'No application of the device opens this address.',
    fr: "Aucune application de l'appareil n'ouvre cette adresse.",
    de: 'Keine App des Geräts öffnet diese Adresse.',
    es: 'Ninguna aplicación del dispositivo abre esta dirección.',
  },
  unknownKey: {
    en: (key) => `Unknown key "${key}".`,
    fr: (key) => `Touche « ${key} » inconnue.`,
    de: (key) => `Unbekannte Taste „${key}“.`,
    es: (key) => `Tecla «${key}» desconocida.`,
  },
  noVolume: {
    en: 'The volume of this device is not readable: use the volume keys.',
    fr: "Le volume de cet appareil n'est pas lisible : utilisez les touches de volume.",
    de: 'Die Lautstärke dieses Geräts ist nicht lesbar: Nutze die Lautstärketasten.',
    es: 'El volumen de este dispositivo no es legible: use las teclas de volumen.',
  },
};

/** Builds an Error whose message is in the given language. */
export function localizedError(entry, language, ...args) {
  const text = entry[language] ?? entry.en;
  const error = new Error(typeof text === 'function' ? text(...args) : text);
  return error;
}

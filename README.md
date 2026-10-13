# Android TV / Fire TV (ADB) for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that controls **Android TV, Google
TV, NVIDIA SHIELD, Android boxes and Amazon Fire TV** over the local network with **ADB** (the Android Debug
Bridge, network debugging on port 5555). No cloud, no account, nothing installed on the device.

> **Developed without the hardware: feedback welcome.** The integration is built and tested against simulated
> devices answering in the formats of real ones (collected from the Home Assistant libraries and the Android
> sources), not yet against a physical TV. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-androidtv-adb/issues).

It complements [Android TV Remote](https://github.com/guim31/gladys-integration-android-tv-remote) (the Google
TV remote protocol), which does not work on Fire TV, cannot open any installed application and does not know
which application is on screen. Both can run side by side.

## Features

- **One device per TV or box**, identified by its serial number (else its MAC address), added by IP address:
  - **Power**: screen on or in standby (screensaver counted as on); waking up and putting to sleep.
  - **Application**: the application on screen, with a readable name for the common ones (Netflix, YouTube,
    Prime Video, Disney+, myCANAL, Molotov, france.tv, Arte, Spotify, Plex, Kodi, VLC…); choosing another one in
    the list opens it.
  - **Playback state**: playing, paused, stopped, nothing playing, screensaver, standby (from
    `dumpsys media_session`).
  - **Volume** (when the device reports it) and **remote keys**: home, back, arrows, OK, menu, play, pause,
    stop, next, previous, rewind, fast forward, volume up/down, mute.
- **Scene triggers**: _An application comes to the screen_ (filter by device, application or package name),
  _Playback starts, pauses or stops_.
- **Scene actions**: _Open an application on the TV_ (from the list, or any package name), _Press a remote key_
  (1 to 20 presses), _Open an address on the TV_ (intent VIEW: a YouTube video, a web page, a stream URL).
- **Dashboard widget** _ADB remote_: state, application on screen, playback, volume, and four keys chosen in its
  settings.

There is **no free shell command**, on purpose: an ADB shell can install, remove or read anything on the device,
and a scene is editable by every Gladys administrator. Home Assistant's `androidtv` integration offers
`adb_command`; this one only sends fixed commands, with validated parameters (key codes, package names, URLs).

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- The device on the same local network, with a fixed IP address, developer options and **network debugging**
  enabled (Fire TV: _ADB debugging_). Android 11+ _wireless debugging_ (pairing code) is not supported.

## Installation

1. In Gladys: **Integrations → Install from GitHub**, with `https://github.com/guim31/gladys-androidtv-adb`
   (or from the catalog once it is published there).
2. **Configuration**: type the IP address of each TV or box, save.
3. On the TV, accept **"Allow USB debugging?"** and tick **"Always allow from this computer"**. Missed it? Run
   the **Connect the devices** action with the screen on.
4. **Discovery**: add the devices.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──TCP 5555 (ADB: CNXN, AUTH with its RSA key, shell streams)──▶ TV / box
   every 10 s while the screen is on (one connection kept open), every 60 s in standby (closed after each read)
   one read = one shell command: dumpsys power | activity | media_session | audio (filtered on the device)
```

- **ADB in plain JavaScript** ([`src/adb/`](src/adb)): the wire protocol and the RSA authentication are ported
  from [adb_shell](https://github.com/JeffLIrion/adb_shell) to `node:crypto`, about 400 lines with no
  dependency. The `adb` binary was not added to the image: it would weigh several megabytes, start a server
  daemon inside the 256 MB sandbox, and want to write `~/.android` on a read-only root filesystem. The
  [Tango](https://github.com/yume-chan/ya-webadb) packages (MIT) were considered: built around WebUSB and web
  streams, they still need a TCP transport written for Node, and add a tree of pre-1.0 packages.
- The key pair is generated at the first start and kept in `/data/adbkey` (mode 0600); the identified devices in
  `/data/androidtv-adb.json`, so they stay in Discovery while they are off.
- The integration reads its devices **on its own timer** (Gladys#3198: the core cannot be trusted to poll an
  external device), with `onPoll` as a fallback. It publishes only the values that change, plus a heartbeat every
  six hours.
- The "Allow debugging?" prompt is opened by the first connection after a start or a configuration change, then
  only by the _Connect the devices_ action, never in a loop.
- No mDNS discovery: adbd can announce `_adb._tcp` (and `_adb-tls-connect._tcp` for Android 11 wireless
  debugging, TLS pairing, not supported here), but whether the network debugging switches of TV devices
  announce it could not be checked without hardware, and the announcement carries no more than the address the
  user types anyway. Mediated discovery can be added once a real device shows it.

## Limitations

- **Developed without the hardware**: see above. `scripts/probe.mjs <ip>` prints what the integration reads on a
  device, without changing anything on it (`--raw` dumps the outputs for test fixtures).
- A TV whose network sleeps in standby cannot be woken by Gladys (no Wake-on-LAN here).
- The playback state needs the application to publish a media session (most streaming apps do).
- On a box connected by HDMI, the volume is usually fixed (the TV's volume is controlled over HDMI-CEC): use the
  volume keys.
- Some devices accept one ADB connection at a time: while a screen is on, Gladys holds one.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests, fake adbd on 127.0.0.1, simulated devices
npm run lint
npm run format:check
node scripts/probe.mjs 192.168.1.50   # read a real device (changes nothing on it)
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js              SDK wiring (src/app.js registers the handlers)
src/app.js            every SDK handler -> the hub
src/hub.js            one loop per device: connection, reads, states, events, commands
src/adb/              ADB in JavaScript: wire format, RSA keys, TCP connection
src/tv/               shell commands (fixed templates), output parsers, keys, app names
src/devices.js        device payload, feature names, state values
src/scenes.js         scene actions          src/widgets.js   "ADB remote" widget
scripts/probe.mjs     read a real device from a computer
test/                 node --test; SDK fake Gladys, fake adbd, simulated devices per model
```

`test/gladys-rules.test.js` checks every discovered device against the category/type table extracted from the
Gladys core. To run the integration outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="androidtv-adb" \
DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit the versions by hand. A
hand-pushed `vX.Y.Z` tag also builds the image and the GitHub Release, but then `version` in `package.json` and
in the manifest (with the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [JeffLIrion/adb_shell](https://github.com/JeffLIrion/adb_shell) (Apache-2.0) — the ADB protocol and
  authentication, ported to JavaScript in `src/adb/`.
- [JeffLIrion/python-androidtv](https://github.com/JeffLIrion/python-androidtv) (MIT) — the `dumpsys` commands,
  the key codes, the application names and the real outputs used as test fixtures.
- The Home Assistant [`androidtv`](https://www.home-assistant.io/integrations/androidtv/) integration
  (Apache-2.0), for its behaviour and its troubleshooting notes.
- [AOSP](https://source.android.com) (Apache-2.0) — `packages/modules/adb/protocol.txt` and the `dumpsys` formats.

## License

[Apache-2.0](LICENSE).

This integration is not affiliated with Google, Amazon or NVIDIA. Android, Google TV, Fire TV and SHIELD are
trademarks of their owners.

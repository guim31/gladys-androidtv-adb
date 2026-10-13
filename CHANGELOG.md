# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Control of Android TV, Google TV, NVIDIA SHIELD, Android boxes and Amazon Fire
  TV over network ADB (port 5555), in plain JavaScript: no `adb` binary, no
  cloud. Devices are added by IP address and identified by their serial number.
- One device per TV or box: power (screen on or standby, wake and sleep), the
  application on screen with a readable name (choosing one opens it), the
  playback state, the volume when the device reports it, and the remote keys.
- The "Allow USB debugging?" prompt opens at the first connection, then through
  the _Connect the devices_ action, which also shows the key fingerprint.
- Scene triggers: _An application comes to the screen_ and _Playback starts,
  pauses or stops_.
- Scene actions: _Open an application on the TV_, _Press a remote key_ and
  _Open an address on the TV_. No free shell command, on purpose.
- Dashboard widget _ADB remote_: state, application, playback, volume and four
  keys of your choice.
- The integration reads its devices on its own timer (every 10 s while on,
  every minute in standby, connection closed in standby), and publishes only
  what changes.
- Texts in English, French, German and Spanish, and the documentation in the
  four languages.
- `scripts/probe.mjs`, to check what the integration reads on a real device.

[Unreleased]: https://github.com/guim31/gladys-androidtv-adb/commits/main

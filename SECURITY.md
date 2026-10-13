# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes,
in particular:

- **The ADB key** (`/data/adbkey`): the RSA private key the devices authorized.
  Whoever holds it and reaches a device on the network can run commands on it
  as the ADB shell user. It is created with mode 0600, never logged, never sent
  anywhere (only signatures leave the container). A leak of it, or a path that
  logs it, is a vulnerability.
- **The commands sent to the devices**: only fixed templates
  (`src/tv/commands.js`) with validated parameters (key codes, package names,
  `http`/`https`/`rtsp`/`rtmp` URLs, single-quoted). Any way to make the
  integration run other shell code on a device (through a scene action, a
  widget, a device control or the configuration) is a vulnerability.
- **`/data/androidtv-adb.json`**: device addresses, serial numbers or MAC
  addresses, models, installed applications. No secret.
- **Network**: the integration only opens TCP connections to the addresses
  typed in its configuration (port 5555 by default) and to Gladys. No cloud, no
  listening port.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the devices and their ADB daemon (enabling network debugging exposes a device
to its whole local network: that is Android's design), and the third-party
services the devices talk to.

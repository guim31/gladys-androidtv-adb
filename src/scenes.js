// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`): what a scene can make a device do.
// The fields arrive resolved and validated by the core (scene variables
// substituted in the `string` fields, defaults applied).
//
// There is deliberately no "run a shell command" action: an ADB shell can
// install, uninstall or read anything on the device, and a scene is editable
// by every Gladys administrator and readable by every user.
// -----------------------------------------------------------------------------

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export const SCENE_ACTIONS = {
  /** Opens an application: a known one (select) or any package name. */
  launch_app: (hub, fields) =>
    hub
      .launchApp(fields.device, { app: text(fields.app), pkg: text(fields.package) })
      .then(() => undefined),

  /** Presses a remote key, once or a few times. */
  send_key: (hub, fields) =>
    hub.sendKey(fields.device, text(fields.key), fields.count ?? 1).then(() => undefined),

  /** Opens an address (intent VIEW): a video, a stream, a web page. */
  open_url: (hub, fields) =>
    hub.openUrl(fields.device, text(fields.url), text(fields.package)).then(() => undefined),
};

// -----------------------------------------------------------------------------
// Every SDK handler, wired to the hub (src/hub.js). Used by index.js, and by
// the tests on the SDK's fake Gladys.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Hub, WIDGET_KEY } from './hub.js';
import { STATUS_TEXT } from './i18n.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { WIDGETS } from './widgets.js';

export const ACTION_KEYS = ['connect'];

/**
 * @param {object} gladys GladysIntegration (or createFakeGladys())
 * @param {object} [options]
 * @param {string} [options.dataDir] the writable volume (/data)
 * @param {boolean} [options.timers] run the reading timers (tests may turn them off)
 * @param {() => number} [options.now]
 * @param {number} [options.promptTimeoutMs] how long the debugging prompt waits for the user
 * @param {object} [options.logger]
 */
export function registerHandlers(gladys, options = {}) {
  const logger = options.logger ?? createLogger({ name: 'androidtv-adb' });
  const store = new Store({ dir: options.dataDir ?? process.env.DATA_DIR ?? '/data', logger });
  const hub = new Hub({
    gladys,
    store,
    logger,
    timers: options.timers ?? true,
    now: options.now,
    promptTimeoutMs: options.promptTimeoutMs,
  });
  const loaded = store.load();
  let config = normalizeConfig();

  gladys.onScanRequest(async () => {
    await loaded;
    await hub.rescan();
  });

  gladys.onSetValue(async (device, feature, value) => {
    await loaded;
    await hub.setValue(device, feature, value);
  });

  gladys.onPoll((device) => hub.pollFromCore(device));
  gladys.onDeviceCreated((device) => hub.deviceCreated(device));
  // The SDK forgets the states of an updated device: send them again.
  gladys.onDeviceUpdated((device) => hub.deviceCreated(device));

  gladys.onAction('connect', async () => {
    await loaded;
    logger.info('Action: connect the devices');
    return hub.connectAll();
  });

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, async (fields) => {
      await loaded;
      return handler(hub, fields);
    });
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(hub, request));
    gladys.onWidgetAction(key, (actionKey, params, extra) =>
      widget.action(hub, { actionKey, params, ...extra }),
    );
  }

  gladys.onConfigUpdated(async (raw) => {
    logger.info('Configuration updated');
    config = normalizeConfig(raw);
    await loaded;
    await hub.apply(config);
    gladys.requestWidgetRefresh(WIDGET_KEY);
  });

  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      await loaded;
      await hub.apply(config);
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys.setConnectionStatus(false, STATUS_TEXT.initFailed).catch(() => {});
    }
  });

  return {
    hub,
    store,
    ready: loaded,
    /** Stops the timers and closes the ADB connections, then waits for /data. */
    async stop() {
      hub.stop();
      await store.flush();
    },
  };
}

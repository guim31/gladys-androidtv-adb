// -----------------------------------------------------------------------------
// The "ADB remote" widget: content within the core vocabulary and budget (as
// the SDK validates it), in every language and state, and its buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FIRE_TV, SHIELD } from './fixtures/devices.js';
import { createWorld } from './helpers/world.js';

const get = (world, settings, language = 'fr') =>
  world.gladys.fake.widgetGet('remote', { settings, language, units: 'metric' });

test('the content fits the core vocabulary in every language and state', async (t) => {
  const world = await createWorld(t, {
    initial: {
      app: 'com.netflix.ninja',
      sessions: [{ package: 'com.netflix.ninja', active: true, state: 3 }],
    },
  });
  const device = world.gladysDevice(world.devices[0]);
  const [{ sim }] = world.devices;
  const states = [
    () => {},
    () => {
      sim.state.dreaming = true;
    },
    () => {
      sim.state.screenOn = false;
    },
  ];
  for (const change of states) {
    change();
    await world.readAll();
    for (const language of ['en', 'fr', 'de', 'es']) {
      const ack = await get(world, { device: device.external_id }, language);
      assert.equal(ack.success, true, ack.error);
      assert.deepEqual(validateWidgetContent(ack.data.content), [], language);
      const buttons = ack.data.content.components.filter((c) => c.type === 'button');
      assert.equal(buttons.length, 4, 'the core budget is four buttons');
      assert.deepEqual(
        buttons.map((b) => b.action.key),
        ['press_1', 'press_2', 'press_3', 'press_4'],
        'unique action keys',
      );
    }
  }
});

test('what the widget shows: name, state, application, playback, volume', async (t) => {
  const world = await createWorld(t, {
    initial: {
      app: 'com.netflix.ninja',
      sessions: [{ package: 'com.netflix.ninja', active: true, state: 2 }],
    },
  });
  const device = world.gladysDevice(world.devices[0]);
  const ack = await get(world, { device: device.external_id });
  const [heading, status] = ack.data.content.components;
  assert.equal(heading.text, 'NVIDIA SHIELD Android TV');
  assert.deepEqual(
    status.items.map((i) => [i.label, i.value]),
    [
      ['État', 'Allumé'],
      ['Application', 'Netflix'],
      ['Lecture', 'En pause'],
      ['Volume', '100 %'],
    ],
  );
});

test('the buttons are the ones chosen in the settings, and press their key', async (t) => {
  const world = await createWorld(t, { profiles: [FIRE_TV] });
  const device = world.gladysDevice(world.devices[0]);
  const [{ sim }] = world.devices;
  const settings = { device: device.external_id, button_1: 'up', button_2: 'nonsense' };
  const ack = await get(world, settings, 'de');
  const buttons = ack.data.content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.action.params.key]),
    [
      ['Hoch', 'up'],
      ['Startseite', 'home'],
      ['Wiedergabe/Pause', 'play_pause'],
      ['Ein/Aus', 'power'],
    ],
  );
  const pressed = await world.gladys.fake.widgetAction(
    'remote',
    'press_1',
    { key: 'up' },
    { settings },
  );
  assert.equal(pressed.success, true, pressed.error);
  assert.deepEqual(sim.log.keys, [19]);
});

test('no device chosen, or a device gone from the configuration', async (t) => {
  const world = await createWorld(t, { profiles: [SHIELD] });
  const none = await get(world, {}, 'es');
  assert.match(none.data.content.components[0].text, /Elija un dispositivo/);
  const gone = await get(world, { device: 'ext:test-integration:androidtv:unknown' }, 'en');
  assert.match(gone.data.content.components[0].text, /no longer in the configuration/);
  assert.deepEqual(validateWidgetContent(gone.data.content), []);
});

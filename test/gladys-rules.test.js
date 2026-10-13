// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: NVIDIA SHIELD (Android 11), Fire TV Stick 4K (Fire OS 7),
// Chromecast with Google TV (Android 12), Sony BRAVIA (Android 9), an
// Android 13 box without serial number — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PROFILES } from './fixtures/devices.js';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

for (const language of ['fr', 'en', 'de', 'es']) {
  test(`every discovered device follows the Gladys rules (names in "${language}")`, async (t) => {
    const world = await createWorld(t, { profiles: PROFILES, create: false, config: { language } });
    const devices = world.gladys.fake.discoveredDevices;
    assert.equal(devices.length, PROFILES.length);
    assert.equal(new Set(devices.map((d) => d.external_id)).size, devices.length);

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }
        assert.ok(feature.external_id.startsWith(`${device.external_id}:`), `${at}: external_id`);
        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);

        if (feature.type === 'select') {
          assert.ok(feature.supported_options.length > 0, `${at}: a select without options`);
          const values = feature.supported_options.map((o) => o.value);
          assert.equal(new Set(values).size, values.length, `${at}: duplicate option`);
          for (const option of feature.supported_options) {
            assert.equal(typeof option.value, 'string', `${at}: option values are strings`);
            assert.ok(option.label, `${at}: option without label`);
          }
        }
      }
    }
  });
}

test('the published states fit their features (a number, or a text option of the select)', async (t) => {
  const world = await createWorld(t, { profiles: PROFILES });
  const features = new Map(
    world.gladys.fake.discoveredDevices.flatMap((d) => d.features).map((f) => [f.external_id, f]),
  );
  assert.ok(world.gladys.fake.states.length >= PROFILES.length * 3);
  for (const state of world.gladys.fake.states) {
    const feature = features.get(state.device_feature_external_id);
    assert.ok(feature, `${state.device_feature_external_id}: state of an unknown feature`);
    if (feature.category === 'text') {
      assert.equal(typeof state.text, 'string');
      assert.ok(state.text.length > 0, 'a text state is never empty');
      assert.ok(
        feature.supported_options.some((o) => o.value === state.text),
        `${feature.name}: "${state.text}" is not one of its options`,
      );
    } else {
      assert.ok(
        state.state >= feature.min && state.state <= feature.max,
        `${feature.name}: ${state.state}`,
      );
    }
  }
});

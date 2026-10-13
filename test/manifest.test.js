// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers, nor which option values the
// code understands — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTION_KEYS } from '../src/app.js';
import { DEFAULT_CONFIG, LANGUAGES, MAX_POLL_INTERVAL, MIN_POLL_INTERVAL } from '../src/config.js';
import { SCENE_TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { APP_KEYS } from '../src/tv/apps.js';
import { KEY_IDS } from '../src/tv/keys.js';
import { DEFAULT_BUTTONS, WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const fieldOf = (list, key, fieldKey) =>
  list
    .find((entry) => entry.key === key)
    [list === manifest.widgets ? 'settings' : 'fields'].find((field) => field.key === fieldKey);

test('identity: name, catalog, image, transports', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Android TV / Fire TV (ADB)');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.deepEqual(manifest.categories, ['multimedia']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.equal(manifest.docker_image, `ghcr.io/guim31/gladys-androidtv-adb:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/guim31\/gladys-androidtv-adb\//,
  );
  // No mediated discovery: adbd does not announce the network debugging port
  // reliably (see CLAUDE.md), the addresses are typed.
  assert.equal(manifest.network_discovery, undefined);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0', () => {
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions), ACTION_KEYS);
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    // Actions get no default and cannot fill a secret (Gladys#3154, #3155).
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.equal(field.default, undefined);
    }
  }
});

test('every scene action has a handler, and every trigger is fired, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGERS].sort());
  assert.deepEqual(keysOf(manifest.widgets), Object.keys(WIDGETS));
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
});

test('the option lists are the tables of the code', () => {
  for (const [list, key] of [
    [manifest.scene_triggers, 'app_opened'],
    [manifest.scene_actions, 'launch_app'],
  ]) {
    assert.deepEqual(optionValues(fieldOf(list, key, 'app')), APP_KEYS);
  }
  assert.deepEqual(optionValues(fieldOf(manifest.scene_actions, 'send_key', 'key')), KEY_IDS);
  assert.deepEqual(optionValues(fieldOf(manifest.scene_triggers, 'playback_changed', 'state')), [
    'playing',
    'paused',
    'stopped',
  ]);
  const [widget] = manifest.widgets;
  DEFAULT_BUTTONS.forEach((def, index) => {
    const setting = widget.settings.find((s) => s.key === `button_${index + 1}`);
    assert.deepEqual(optionValues(setting), KEY_IDS);
    assert.equal(setting.default, def);
  });
  const language = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(optionValues(language), LANGUAGES);
});

test('the event data carries every declared filter and variable', () => {
  // src/hub.js fireEvents: device, device_name, package, app_name, and app or state.
  const sent = {
    app_opened: ['device', 'device_name', 'package', 'app_name', 'app'],
    playback_changed: ['device', 'device_name', 'package', 'app_name', 'state'],
  };
  for (const trigger of manifest.scene_triggers) {
    for (const entry of [...trigger.fields, ...trigger.variables]) {
      assert.ok(sent[trigger.key].includes(entry.key), `${trigger.key}.${entry.key} never sent`);
    }
    assert.ok(trigger.fields.length <= 10 && trigger.variables.length <= 20);
    for (const field of trigger.fields) {
      assert.ok(['string', 'number', 'select', 'multi_select'].includes(field.type));
    }
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
  const interval = manifest.config_schema.find((f) => f.key === 'poll_interval');
  assert.equal(interval.min, MIN_POLL_INTERVAL);
  assert.equal(interval.max, MAX_POLL_INTERVAL);
  // Number fields have no `step`: integer bounds and default only.
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const value of [field.min, field.max, field.default].filter((v) => v !== undefined)) {
      assert.ok(Number.isInteger(value), `${field.key}: ${value} is not an integer`);
    }
  }
});

test('section fields are purely presentational, with https links', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000);
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamic.length >= 6);
  for (const field of dynamic) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('the widget fits the core budget declaration', () => {
  const [widget] = manifest.widgets;
  assert.match(widget.key, /^[a-z0-9_]+$/);
  assert.ok(widget.settings.length <= 10);
  for (const setting of widget.settings) {
    assert.ok(['string', 'number', 'boolean', 'select', 'multi_select'].includes(setting.type));
  }
});

test('texts are multi-language objects, never plain strings', () => {
  for (const field of allFields) {
    for (const key of ['label', 'description', 'placeholder']) {
      if (field[key] !== undefined) {
        assert.equal(typeof field[key], 'object', `${field.key}.${key}`);
      }
    }
  }
});

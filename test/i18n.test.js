// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names, and the documentation (same sections in the four
// files). German says "du", never the polite "Sie"; Spanish says "usted".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES, PLAYBACK_STATES } from '../src/devices.js';
import { CONNECT_TEXT, ERROR_TEXT, STATUS_TEXT } from '../src/i18n.js';
import { APPS } from '../src/tv/apps.js';
import { KEYS } from '../src/tv/keys.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const docs = Object.fromEntries(
  await Promise.all(
    ['en', 'fr', 'de', 'es'].map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;
// Spanish "tú" forms the texts must not use (usted is the rule).
const FAMILIAR_SPANISH =
  /(?<!\p{L})(tú|tu|tus|puedes|debes|tienes|introduce|elige|pulsa|activa)(?!\p{L})/iu;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  section: 1000,
  message: 400,
  short: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    const rendered = typeof text === 'function' ? text('192.0.2.10', 'Netflix') : text;
    found.push(...textProblems(rendered, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  if (lang === 'es' && FAMILIAR_SPANISH.test(text)) {
    found.push(`${path} uses the familiar form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key, parent) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key, parent));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      let max = MAX[key] ?? MAX.label;
      if (path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)) {
        max = MAX.catalog;
      } else if (/^manifest\.widgets\[\d+\]\.label$/.test(path)) {
        max = MAX.widgetLabel;
      } else if (key === 'description' && parent?.type === 'section') {
        max = MAX.section;
      }
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child, value);
    }
  };
  walk(root, 'manifest', null, null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  assert.deepEqual(Object.keys(PLAYBACK_STATES), LANGS);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 150, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, and the catalog description fits', () => {
  assert.equal(typeof manifest.name, 'string');
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('every message table of the code has the four languages', () => {
  const found = [
    ...Object.entries(STATUS_TEXT).flatMap(([key, value]) =>
      problems(value, `STATUS_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(CONNECT_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECT_TEXT.${key}`, MAX.message),
    ),
    ...Object.entries(ERROR_TEXT).flatMap(([key, value]) =>
      // A widget toast is cut at 200 characters.
      problems(value, `ERROR_TEXT.${key}`, 200),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(value, `TEXT.${key}`, ['pick', 'missing'].includes(key) ? 300 : MAX.short),
    ),
  ];
  assert.deepEqual(found, []);
});

test('feature names, playback values, keys and app names exist in every language', () => {
  const found = [];
  for (const lang of LANGS) {
    for (const [key, name] of Object.entries(NAMES[lang])) {
      found.push(...textProblems(name, `NAMES.${lang}.${key}`, lang, MAX.featureName));
    }
    for (const [key, name] of Object.entries(PLAYBACK_STATES[lang])) {
      found.push(...textProblems(name, `PLAYBACK_STATES.${lang}.${key}`, lang, MAX.short));
    }
  }
  for (const key of KEYS) {
    // A widget button label holds 24 characters.
    found.push(...problems(key.name, `KEYS.${key.id}`, 24));
  }
  for (const app of APPS.filter((a) => typeof a.name !== 'string')) {
    found.push(...problems(app.name, `APPS.${app.key}`, MAX.short));
  }
  assert.deepEqual(found, []);
});

test('the four documentation files have the same sections', () => {
  const outline = (text) =>
    text
      .split('\n')
      .filter((line) => /^#{1,3} /.test(line))
      .map((line) => line.match(/^#+/)[0].length);
  const reference = outline(docs.en);
  assert.ok(reference.length >= 12, `only ${reference.length} headings in docs/en.md`);
  for (const lang of LANGS) {
    assert.deepEqual(outline(docs[lang]), reference, `docs/${lang}.md sections differ from en`);
    assert.ok(docs[lang].length >= 3000, `docs/${lang}.md is too short`);
    assert.match(docs[lang], /Google|Amazon|NVIDIA/);
  }
  assert.match(docs.en, /not affiliated with Google, Amazon or NVIDIA/);
  assert.match(docs.de, /(?<!\p{L})du(?!\p{L})/u);
  assert.ok(!POLITE_GERMAN.test(docs.de.replace(/„[^“]*“/g, '')), 'docs/de.md: du, not Sie');
});

test('the guard catches a missing language, an empty text and the wrong forms of address', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: '', es: 'Luz' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre IP', 'mit Ihrem', 'Ihren', 'Ihrer']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  for (const familiar of ['Elige un dispositivo', 'tu televisor', 'Introduce la IP']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: familiar }, 'x', 60).length, 1);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[2].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[2].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

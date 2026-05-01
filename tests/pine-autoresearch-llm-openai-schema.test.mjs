import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildCandidateJsonSchema, buildStructuredOutputConfig } from '../scripts/lib/pine-autoresearch-llm-openai-schema.mjs';

const allowlist = {
  version: 1,
  parameters: {
    minPredSum: { type: 'number', min: 1.1, max: 3.5, step: 0.1, mutability: 'safe' },
    minBarsBetween: { type: 'integer', min: 1, max: 80, step: 1, mutability: 'safe' },
    useVolatilityFilter: { type: 'boolean', mutability: 'guarded' },
  },
};

const guardedOnlyAllowlist = {
  version: 1,
  parameters: {
    useVolatilityFilter: { type: 'boolean', mutability: 'guarded' },
  },
};

const defaultAllowlist = JSON.parse(
  await readFile(new URL('../config/pine-autoresearch-llm-allowlist.default.json', import.meta.url), 'utf8'),
);

test('buildCandidateJsonSchema supports repo default array allowlist and excludes forbidden params', () => {
  const schema = buildCandidateJsonSchema({ allowlist: defaultAllowlist });

  assert.equal(schema.type, 'object');
  assert.deepEqual(Object.keys(schema.properties.params.properties).sort(), [
    'divRsiLen',
    'minPredSum',
    'riskRewardRatio',
    'stopLossPct',
  ]);
  assert.deepEqual(schema.properties.params.properties.minPredSum, {
    type: 'number',
    minimum: 0,
    maximum: 5,
    multipleOf: 0.1,
  });
  assert.deepEqual(schema.properties.params.properties.divRsiLen, {
    type: 'integer',
    minimum: 5,
    maximum: 50,
    multipleOf: 1,
  });
  assert.deepEqual(schema.properties.params.properties.riskRewardRatio, {
    type: 'number',
    minimum: 0.5,
    maximum: 5,
    multipleOf: 0.1,
  });
  assert.deepEqual(schema.properties.params.properties.stopLossPct, {
    type: 'number',
    minimum: 0.1,
    maximum: 10,
    multipleOf: 0.1,
  });
  assert.equal(schema.properties.params.properties.useSignalFusion, undefined);
  assert.equal(schema.properties.params.properties.useFusionV4, undefined);
  assert.equal(schema.properties.params.properties.useTrailingStop, undefined);
});

test('buildCandidateJsonSchema creates one strict candidate object schema', () => {
  const schema = buildCandidateJsonSchema({ allowlist, allowGuarded: true });

  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['params', 'rationale']);
  assert.equal(schema.properties.params.type, 'object');
  assert.equal(schema.properties.params.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties.params.properties).sort(), [
    'minBarsBetween',
    'minPredSum',
    'useVolatilityFilter',
  ]);
  assert.deepEqual(schema.properties.params.properties.minPredSum, {
    type: 'number',
    minimum: 1.1,
    maximum: 3.5,
    multipleOf: 0.1,
  });
  assert.deepEqual(schema.properties.params.properties.minBarsBetween, {
    type: 'integer',
    minimum: 1,
    maximum: 80,
    multipleOf: 1,
  });
  assert.deepEqual(schema.properties.params.properties.useVolatilityFilter, { type: 'boolean' });
  assert.equal(schema.properties.rationale.type, 'string');
  assert.equal(schema.properties.rationale.maxLength, 2000);
});

test('buildCandidateJsonSchema excludes guarded parameters by default', () => {
  const schema = buildCandidateJsonSchema({ allowlist });

  assert.deepEqual(Object.keys(schema.properties.params.properties).sort(), ['minBarsBetween', 'minPredSum']);
});

test('buildCandidateJsonSchema includes guarded parameters when explicitly allowed', () => {
  const schema = buildCandidateJsonSchema({ allowlist, allowGuarded: true });

  assert.deepEqual(Object.keys(schema.properties.params.properties).sort(), [
    'minBarsBetween',
    'minPredSum',
    'useVolatilityFilter',
  ]);
});

test('buildCandidateJsonSchema rejects empty filtered allowlists', () => {
  assert.throws(() => buildCandidateJsonSchema({ allowlist: { parameters: {} } }), /zero properties/);
  assert.throws(() => buildCandidateJsonSchema({ allowlist: guardedOnlyAllowlist }), /zero properties/);
});

test('buildCandidateJsonSchema includes guarded-only allowlist when explicitly enabled', () => {
  const schema = buildCandidateJsonSchema({ allowlist: guardedOnlyAllowlist, allowGuarded: true });

  assert.deepEqual(Object.keys(schema.properties.params.properties), ['useVolatilityFilter']);
});

test('buildStructuredOutputConfig returns chat and responses wrappers with guarded excluded by default', () => {
  const chat = buildStructuredOutputConfig({ apiStyle: 'chat-completions', allowlist });
  assert.equal(chat.type, 'json_schema');
  assert.equal(chat.json_schema.name, 'pine_autoresearch_candidate');
  assert.equal(chat.json_schema.strict, true);
  assert.equal(chat.json_schema.schema.type, 'object');
  assert.deepEqual(Object.keys(chat.json_schema.schema.properties.params.properties).sort(), [
    'minBarsBetween',
    'minPredSum',
  ]);

  const responses = buildStructuredOutputConfig({ apiStyle: 'responses', allowlist });
  assert.equal(responses.type, 'json_schema');
  assert.equal(responses.name, 'pine_autoresearch_candidate');
  assert.equal(responses.strict, true);
  assert.equal(responses.schema.type, 'object');
  assert.deepEqual(Object.keys(responses.schema.properties.params.properties).sort(), [
    'minBarsBetween',
    'minPredSum',
  ]);
});

test('buildStructuredOutputConfig can include guarded parameters when explicitly enabled', () => {
  const chat = buildStructuredOutputConfig({ apiStyle: 'chat-completions', allowlist, allowGuarded: true });
  assert.deepEqual(Object.keys(chat.json_schema.schema.properties.params.properties).sort(), [
    'minBarsBetween',
    'minPredSum',
    'useVolatilityFilter',
  ]);

  const responses = buildStructuredOutputConfig({ apiStyle: 'responses', allowlist, allowGuarded: true });
  assert.deepEqual(Object.keys(responses.schema.properties.params.properties).sort(), [
    'minBarsBetween',
    'minPredSum',
    'useVolatilityFilter',
  ]);
});

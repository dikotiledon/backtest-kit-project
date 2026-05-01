function normalizeJsonSchemaType(type) {
  if (type === 'float') return 'number';
  if (type === 'int') return 'integer';
  if (type === 'bool') return 'boolean';
  return type;
}

function toJsonSchemaProperty(definition = {}) {
  const type = normalizeJsonSchemaType(definition.type);
  const property = {};

  if (type === 'number') property.type = 'number';
  else if (type === 'integer') property.type = 'integer';
  else if (type === 'boolean') property.type = 'boolean';
  else if (type === 'string') property.type = 'string';
  else throw new Error(`unsupported allowlist parameter type: ${String(type)}`);

  if (Number.isFinite(definition.min)) property.minimum = definition.min;
  if (Number.isFinite(definition.max)) property.maximum = definition.max;
  if (Number.isFinite(definition.step)) property.multipleOf = definition.step;
  if (Number.isInteger(definition.maxLength) && definition.maxLength > 0) property.maxLength = definition.maxLength;

  return property;
}

function isAllowedMutability(mutability, allowGuarded) {
  if (mutability === 'forbidden') return false;
  if (mutability === 'guarded') return Boolean(allowGuarded);
  if (mutability === 'safe' || mutability === 'tunable' || mutability === 'schedulable') return true;
  return false;
}

function normalizeAllowlistParameters(parameters) {
  if (!parameters) return [];

  if (Array.isArray(parameters)) {
    return parameters
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.key === 'string' && entry.key)
      .map((entry) => [entry.key, entry]);
  }

  if (typeof parameters === 'object') {
    return Object.entries(parameters);
  }

  return [];
}

export function buildCandidateJsonSchema({ allowlist, allowGuarded = false } = {}) {
  const parameters = allowlist?.parameters;
  if (!parameters || (typeof parameters !== 'object' && !Array.isArray(parameters))) {
    throw new Error('allowlist.parameters object or array required');
  }

  const paramProperties = {};
  for (const [name, definition] of normalizeAllowlistParameters(parameters).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isAllowedMutability(definition?.mutability, allowGuarded)) continue;
    paramProperties[name] = toJsonSchemaProperty(definition);
  }

  if (Object.keys(paramProperties).length === 0) {
    throw new Error('allowlist.parameters filtered to zero properties');
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['params', 'rationale'],
    properties: {
      params: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: paramProperties,
      },
      rationale: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
      },
    },
  };
}

export function buildStructuredOutputConfig({ apiStyle, allowlist, allowGuarded = false } = {}) {
  const schema = buildCandidateJsonSchema({ allowlist, allowGuarded });
  const name = 'pine_autoresearch_candidate';

  if (apiStyle === 'chat-completions') {
    return { type: 'json_schema', json_schema: { name, strict: true, schema } };
  }

  if (apiStyle === 'responses') {
    return { type: 'json_schema', name, strict: true, schema };
  }

  throw new Error(`unknown OpenAI API style: ${String(apiStyle)}`);
}

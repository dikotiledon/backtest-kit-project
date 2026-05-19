// tests/pine-feature-flags.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlagRegistry,
  getFlag,
  setFlag,
  withFlag,
  KNOWN_FLAGS,
} from '../scripts/lib/pine-feature-flags.mjs';

describe('pine-feature-flags', () => {
  describe('createFlagRegistry', () => {
    it('returns registry with all known flags defaulting to false', () => {
      const registry = createFlagRegistry();
      assert.equal(registry.get('USE_NEXT_BAR_OPEN_ENTRY'), false);
      assert.equal(registry.get('USE_COMPOUNDED_METRICS'), false);
      assert.equal(registry.get('USE_COST_MODEL'), false);
      assert.equal(registry.get('USE_STATISTICAL_SIGNIFICANCE'), false);
      assert.equal(registry.get('USE_WALK_FORWARD_GATE'), false);
      assert.equal(registry.get('USE_DATA_QUALITY_GATE'), false);
    });

    it('accepts initial overrides', () => {
      const registry = createFlagRegistry({ USE_COST_MODEL: true });
      assert.equal(registry.get('USE_COST_MODEL'), true);
      assert.equal(registry.get('USE_NEXT_BAR_OPEN_ENTRY'), false);
    });

    it('ignores unknown flags in overrides', () => {
      const registry = createFlagRegistry({ UNKNOWN_FLAG: true });
      assert.equal(registry.get('UNKNOWN_FLAG'), false);
    });
  });

  describe('getFlag / setFlag', () => {
    it('setFlag updates value', () => {
      const registry = createFlagRegistry();
      setFlag(registry, 'USE_COST_MODEL', true);
      assert.equal(getFlag(registry, 'USE_COST_MODEL'), true);
    });

    it('getFlag returns false for unknown flags', () => {
      const registry = createFlagRegistry();
      assert.equal(getFlag(registry, 'NONEXISTENT'), false);
    });
  });

  describe('withFlag', () => {
    it('executes fn only when flag is true', () => {
      const registry = createFlagRegistry({ USE_COST_MODEL: true });
      let called = false;
      const result = withFlag(registry, 'USE_COST_MODEL', () => { called = true; return 42; }, () => 0);
      assert.equal(called, true);
      assert.equal(result, 42);
    });

    it('executes fallback when flag is false', () => {
      const registry = createFlagRegistry();
      const result = withFlag(registry, 'USE_COST_MODEL', () => 42, () => 0);
      assert.equal(result, 0);
    });

    it('returns fallback value directly if not a function', () => {
      const registry = createFlagRegistry();
      const result = withFlag(registry, 'USE_COST_MODEL', () => 42, 99);
      assert.equal(result, 99);
    });
  });

  describe('KNOWN_FLAGS', () => {
    it('exports all flag names as frozen array', () => {
      assert.ok(Array.isArray(KNOWN_FLAGS));
      assert.ok(KNOWN_FLAGS.includes('USE_NEXT_BAR_OPEN_ENTRY'));
      assert.ok(KNOWN_FLAGS.includes('USE_COMPOUNDED_METRICS'));
      assert.ok(KNOWN_FLAGS.includes('USE_COST_MODEL'));
      assert.ok(KNOWN_FLAGS.includes('USE_STATISTICAL_SIGNIFICANCE'));
      assert.ok(KNOWN_FLAGS.includes('USE_WALK_FORWARD_GATE'));
      assert.ok(KNOWN_FLAGS.includes('USE_DATA_QUALITY_GATE'));
      assert.ok(Object.isFrozen(KNOWN_FLAGS));
    });
  });
});

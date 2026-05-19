import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSweepStatus, cancelSweep } from '../lib/sweep-runner.mjs';

describe('sweep-runner', () => {
  it('getSweepStatus returns idle when not running', () => {
    const status = getSweepStatus();
    assert.equal(status.running, false);
  });

  it('cancelSweep returns ok', async () => {
    const result = await cancelSweep();
    assert.deepStrictEqual(result, { ok: true });
  });

  it('exports expected functions', async () => {
    const mod = await import('../lib/sweep-runner.mjs');
    assert.ok(typeof mod.runSweep === 'function');
    assert.ok(typeof mod.getSweepStatus === 'function');
    assert.ok(typeof mod.cancelSweep === 'function');
  });
});

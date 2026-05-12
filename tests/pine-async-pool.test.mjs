import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../scripts/lib/pine-async-pool.mjs';

const defer = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('mapWithConcurrency preserves input order while bounding in-flight work', async () => {
  const releases = [defer(), defer(), defer(), defer()];
  const started = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const resultPromise = mapWithConcurrency([30, 10, 20, 40], 2, async (item, index) => {
    started.push(index);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await releases[index].promise;
    inFlight -= 1;
    return item * 2;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1]);
  releases[1].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  releases[0].resolve();
  releases[2].resolve();
  releases[3].resolve();

  assert.deepEqual(await resultPromise, [60, 20, 40, 80]);
  assert.equal(maxInFlight, 2);
});

test('mapWithConcurrency treats non-array input as empty and normalizes invalid limits', async () => {
  assert.deepEqual(await mapWithConcurrency(null, 2, async () => 'never'), []);

  let inFlight = 0;
  let maxInFlight = 0;
  const result = await mapWithConcurrency(['a', 'b'], 0, async (item) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return item.toUpperCase();
  });

  assert.deepEqual(result, ['A', 'B']);
  assert.equal(maxInFlight, 1);
});

test('mapWithConcurrency propagates mapper errors', async () => {
  await assert.rejects(
    () => mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('boom');
      return item;
    }),
    /boom/,
  );
});

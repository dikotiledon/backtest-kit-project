import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const sourcePath = new URL('../pine/test.pine', import.meta.url);

test('pine script declares context input groups and transparent defaults', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /useAvwapContext\s*=\s*input\.bool\(false,\s+title="Use AVWAP Context",\s+group="Phase 3: AVWAP Context"/);
  assert.match(source, /useChannelContext\s*=\s*input\.bool\(false,\s+title="Use Breakout Context",\s+group="Phase 3: Breakout Context"/);
  assert.match(source, /useContextAggregator\s*=\s*input\.bool\(false,\s+title="Use Context Aggregator",\s+group="Phase 3: Context Aggregator"/);
  assert.match(source, /useContextExitShaping\s*=\s*input\.bool\(false,\s+title="Use Context Exit Shaping",\s+group="Phase 3: Context Exit Shaping"/);
  assert.match(source, /contextLongQualify\s*=\s*not useContextAggregator \? true :/);
  assert.match(source, /contextLongBoost\s*=\s*not useContextAggregator \? 0\.0 :/);
});

test('pine script exports AVWAP and channel features via data window', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /plot\(featureAvwapBullBias, "Feature_AvwapBullBias", display=display\.data_window\)/);
  assert.match(source, /plot\(featureChannelCompressionScore, "Feature_ChannelCompressionScore", display=display\.data_window\)/);
  assert.match(source, /plot\(featureContextLongQualify, "Feature_ContextLongQualify", display=display\.data_window\)/);
  assert.match(source, /plot\(featureLongContextCaution, "Feature_LongContextCaution", display=display\.data_window\)/);
});

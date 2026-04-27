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

test('pine script gates final entries through asymmetric context policy', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /startLongTrade\s*=\s*baseStartLong[\s\S]*contextLongQualify[\s\S]*not contextLongBlocked/);
  assert.match(source, /startShortTrade\s*=\s*baseStartShort[\s\S]*contextShortQualify[\s\S]*not contextShortBlocked/);
  assert.match(source, /contextLongBlocked\s*=\s*useContextAggregator and \(/);
  assert.match(source, /contextShortBlocked\s*=\s*useContextAggregator and \(/);
});

test('pine script tightens exits from context caution without weakening hard risk controls', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(source, /if contextLongCaution and useContextExitShaping and contextTightenTrailOnCaution\r?\n\s+longTrailAtrMultInForce := math\.min\(longTrailAtrMultInForce, trailAtrMult \* contextTrailTightenFactor\)/);
  assert.match(source, /if contextShortCaution and useContextExitShaping and contextTightenTrailOnCaution\r?\n\s+shortTrailAtrMultInForce := math\.min\(shortTrailAtrMultInForce, trailAtrMult \* contextTrailTightenFactor\)/);
  assert.match(source, /endLongTrade\s*=\s*[\s\S]*\(contextAllowLongEarlyExit and endLongTradeDynamic\)/);
  assert.match(source, /endShortTrade\s*=\s*[\s\S]*\(contextAllowShortEarlyExit and endShortTradeDynamic\)/);
});

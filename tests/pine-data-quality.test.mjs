import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOhlcRow,
  validateDataset,
  detectGaps,
  buildDataQualityReport,
} from '../scripts/lib/pine-data-quality.mjs';

describe('pine-data-quality', () => {
  describe('validateOhlcRow', () => {
    it('passes valid OHLC row', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 105, Low: 98, Close: 103 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('fails when High < Low', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 95, Low: 98, Close: 97 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('High < Low')));
    });

    it('fails when Close outside High/Low range', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 105, Low: 98, Close: 110 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Close')));
    });

    it('fails when Open outside High/Low range', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: 90, High: 105, Low: 98, Close: 103 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Open')));
    });

    it('fails on missing timestamp', () => {
      const row = { Open: 100, High: 105, Low: 98, Close: 103 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
    });

    it('fails on non-finite price', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: NaN, High: 105, Low: 98, Close: 103 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
    });
  });

  describe('detectGaps', () => {
    it('detects missing bars in time series', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Close: 100 },
        { timestamp: '2026-01-01T00:15:00Z', Close: 101 },
        { timestamp: '2026-01-01T00:45:00Z', Close: 102 },
        { timestamp: '2026-01-01T01:00:00Z', Close: 103 },
      ];
      const gaps = detectGaps(rows, { expectedIntervalMs: 15 * 60 * 1000 });
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].afterIndex, 1);
      assert.equal(gaps[0].missedBars, 1);
    });

    it('returns empty for continuous data', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Close: 100 },
        { timestamp: '2026-01-01T00:15:00Z', Close: 101 },
        { timestamp: '2026-01-01T00:30:00Z', Close: 102 },
      ];
      const gaps = detectGaps(rows, { expectedIntervalMs: 15 * 60 * 1000 });
      assert.equal(gaps.length, 0);
    });
  });

  describe('validateDataset', () => {
    it('returns summary with error count and gap count', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 105, Low: 98, Close: 103 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 103, High: 95, Low: 98, Close: 100 }, // High<Low
        { timestamp: '2026-01-01T00:45:00Z', Open: 100, High: 102, Low: 99, Close: 101 }, // gap before
      ];
      const report = validateDataset(rows, { timeframeMinutes: 15 });
      assert.equal(report.totalRows, 3);
      assert.equal(report.invalidRows, 1);
      assert.equal(report.gaps, 1);
      assert.equal(report.valid, false);
    });
  });

  describe('buildDataQualityReport', () => {
    it('marks dataset valid when no issues', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 105, Low: 98, Close: 103 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 103, High: 106, Low: 101, Close: 104 },
      ];
      const report = buildDataQualityReport(rows, { timeframeMinutes: 15 });
      assert.equal(report.valid, true);
      assert.equal(report.invalidRows, 0);
      assert.equal(report.gaps, 0);
    });

    it('includes severity level based on error density', () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
        Open: 100, High: 105, Low: 98, Close: 103,
      }));
      // Corrupt 15% of rows (High < Low)
      for (let i = 0; i < 15; i++) {
        rows[i * 6].High = 90;
      }
      const report = buildDataQualityReport(rows, { timeframeMinutes: 15 });
      assert.equal(report.valid, false);
      assert.equal(report.severity, 'critical'); // >10% invalid = critical
    });
  });
});

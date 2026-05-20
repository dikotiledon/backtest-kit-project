import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TradingBot } from '../lib/trading-bot.mjs';
import { RiskManager } from '../lib/risk-manager.mjs';
import { PositionSizer } from '../lib/position-sizer.mjs';
import { SlippageEstimator } from '../lib/slippage-estimator.mjs';

describe('TradingBot enhanced stats', () => {
  it('tracks consecutive losses', () => {
    const bot = new TradingBot({ symbol: 'BTCUSDT', strategy: 'momentum' });
    bot.registerTradeResult(-10);
    bot.registerTradeResult(-5);
    bot.registerTradeResult(-8);
    assert.equal(bot.stats.consecutiveLosses, 3);
    assert.equal(bot.stats.consecutiveWins, 0);
    assert.equal(bot.stats.lastTradeWin, false);
  });

  it('resets consecutive losses on win', () => {
    const bot = new TradingBot({ symbol: 'BTCUSDT', strategy: 'momentum' });
    bot.registerTradeResult(-10);
    bot.registerTradeResult(-5);
    bot.registerTradeResult(20);
    assert.equal(bot.stats.consecutiveLosses, 0);
    assert.equal(bot.stats.consecutiveWins, 1);
    assert.equal(bot.stats.lastTradeWin, true);
  });

  it('calculates avgWinLossRatio', () => {
    const bot = new TradingBot({ symbol: 'BTCUSDT', strategy: 'momentum' });
    bot.registerTradeResult(20);
    bot.registerTradeResult(30);
    bot.registerTradeResult(-10);
    bot.registerTradeResult(-10);
    // avgWin = 25, avgLoss = 10, ratio = 2.5
    assert.equal(bot.stats.avgWinAmount, 25);
    assert.equal(bot.stats.avgLossAmount, 10);
    assert.equal(bot.stats.avgWinLossRatio, 2.5);
  });
});

describe('RiskManager order checks', () => {
  it('rejects when daily loss limit reached', () => {
    const rm = new RiskManager();
    rm.updateLimits({ maxDailyLossUSDT: 50 });
    rm._state.dailyPnl = -60;
    rm._state.date = new Date().toISOString().slice(0, 10);
    const check = rm.checkOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 100, leverage: 10 });
    assert.equal(check.allowed, false);
    assert(check.violations.some(v => v.includes('Daily loss limit')));
  });

  it('rejects when max positions reached', () => {
    const rm = new RiskManager();
    rm.updateLimits({ maxConcurrentPositions: 2 });
    rm._state.openPositions = 2;
    rm._state.date = new Date().toISOString().slice(0, 10);
    const check = rm.checkOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 100 });
    assert.equal(check.allowed, false);
    assert(check.violations.some(v => v.includes('Max concurrent positions')));
  });

  it('allows valid order', () => {
    const rm = new RiskManager();
    rm._state.date = new Date().toISOString().slice(0, 10);
    const check = rm.checkOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity: 0.001, price: 100, leverage: 10 });
    assert.equal(check.allowed, true);
    assert.equal(check.violations.length, 0);
  });
});

describe('PositionSizer modes', () => {
  it('fixed mode returns base allocation', () => {
    const ps = new PositionSizer();
    ps.setMode('fixed');
    const result = ps.calculateSize(100, { equity: 1000, peakEquity: 1000 });
    assert.equal(result.adjustedAllocation, 100);
    assert.equal(result.sizeFactor, 1.0);
  });

  it('drawdown mode reduces at 20% drawdown', () => {
    const ps = new PositionSizer();
    ps.setMode('drawdown');
    const result = ps.calculateSize(100, { equity: 800, peakEquity: 1000 });
    // 20% drawdown = tier 15-20 = factor 0.25
    assert(result.sizeFactor <= 0.25);
    assert(result.adjustedAllocation < 30);
  });

  it('drawdown mode full size at no drawdown', () => {
    const ps = new PositionSizer();
    ps.setMode('drawdown');
    const result = ps.calculateSize(100, { equity: 1000, peakEquity: 1000 });
    assert.equal(result.sizeFactor, 1.0);
    assert.equal(result.adjustedAllocation, 100);
  });
});

describe('SlippageEstimator', () => {
  it('estimates higher fill for buys', () => {
    const se = new SlippageEstimator();
    const result = se.estimateSlippage('BTCUSDT', 'usdm', 'BUY', 0.01, 50000);
    assert(result.estimatedFillPrice > 50000);
    assert(result.slippageBps > 0);
  });

  it('estimates lower fill for sells', () => {
    const se = new SlippageEstimator();
    const result = se.estimateSlippage('BTCUSDT', 'usdm', 'SELL', 0.01, 50000);
    assert(result.estimatedFillPrice < 50000);
  });

  it('records and retrieves stats', () => {
    const se = new SlippageEstimator();
    se.recordActualSlippage('BTCUSDT', 'usdm', 50000, 50005, 0.01);
    se.recordActualSlippage('BTCUSDT', 'usdm', 50000, 50010, 0.01);
    const stats = se.getStats('BTCUSDT', 'usdm');
    assert(stats.sampleCount === 2);
    assert(stats.avgSlippageBps > 0);
  });

  it('liquid pairs have lower base slippage', () => {
    const se = new SlippageEstimator();
    const liquid = se.estimateSlippage('BTCUSDT', 'usdm', 'BUY', 0.01, 50000);
    const illiquid = se.estimateSlippage('OBSCUREUSDT', 'usdm', 'BUY', 0.01, 1.0);
    assert(liquid.slippageBps < illiquid.slippageBps);
  });
});

describe('Bot lifecycle', () => {
  it('transitions through states correctly', () => {
    const bot = new TradingBot({ symbol: 'BTCUSDT', strategy: 'momentum' });
    assert.equal(bot.state, 'created');
    bot.start();
    assert.equal(bot.state, 'running');
    bot.pause();
    assert.equal(bot.state, 'paused');
    bot.resume();
    assert.equal(bot.state, 'running');
    bot.stop();
    assert.equal(bot.state, 'stopped');
  });
});

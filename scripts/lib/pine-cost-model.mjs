// scripts/lib/pine-cost-model.mjs

function finitePositive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function buildCostModel(config = {}) {
  if (config?.enabled === false) {
    return { enabled: false, commissionPct: 0, slippagePct: 0, spreadPct: 0, slippageStopMultiplier: 1 };
  }

  return {
    enabled: true,
    commissionPct: finitePositive(config.commissionPct, 0.04),
    slippagePct: finitePositive(config.slippagePct, 0.02),
    spreadPct: finitePositive(config.spreadPct, 0.01),
    slippageStopMultiplier: finitePositive(config.slippageStopMultiplier, 2.5),
  };
}

export function computeSlippage(model, { exitReason } = {}) {
  if (!model?.enabled) return 0;
  const base = model.slippagePct;
  if (exitReason === 'stopLoss') {
    return Number((base * (model.slippageStopMultiplier ?? 2.5)).toFixed(6));
  }
  return base;
}

export function computeTradeCost(model, { exitReason = 'takeProfit' } = {}) {
  if (!model?.enabled) return 0;
  const entrySlippage = model.slippagePct;
  const exitSlippage = computeSlippage(model, { exitReason });
  const entryCost = model.commissionPct + entrySlippage + model.spreadPct;
  const exitCost = model.commissionPct + exitSlippage;
  return Number((entryCost + exitCost).toFixed(6));
}

export function applyCostToTrade(trade, model) {
  if (!model?.enabled) return trade;
  const grossReturn = trade.returnPctExact ?? trade.returnPct ?? 0;
  const costPct = computeTradeCost(model, { exitReason: trade.exitReason });
  const netReturn = Number((grossReturn - costPct).toFixed(6));

  return {
    ...trade,
    grossReturnPct: grossReturn,
    returnPctExact: netReturn,
    returnPct: Number(netReturn.toFixed(2)),
    costPct,
  };
}

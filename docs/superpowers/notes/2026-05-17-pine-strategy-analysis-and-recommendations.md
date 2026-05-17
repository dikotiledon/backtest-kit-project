# Pine Strategy Analysis & Recommendations
## Date: 2026-05-17
## Context: Post-structural-fixes audit, pre-autoresearch cycle

---

## Part 1: How Trades Are Executed

### The Trade Decision Chain

A trade passes through a 7-layer gate cascade — every layer must pass:

```
Layer 1: ML Prediction (Lorentzian KNN)
  → Layer 2: Kernel Regression Filter
    → Layer 3: Signal Type Change (isDifferentSignalType)
      → Layer 4: Trend Confirmation (trendx)
        → Layer 5: Prediction Strength (effectiveLongStrength >= minPredSum)
          → Layer 6: Cooldown (minBarsBetween)
            → Layer 7: Signal Fusion + Supertrend + Context
              → ENTRY
```

Final entry conditions (line 606-607):

```pine
startLongTrade = baseStartLong
  and (not useTrendXConf or trendx == 1)
  and predLongStrengthPass
  and cooldownOk
  and longFusionPass
  and supertrendPassLong
  and contextLongQualify
  and not contextLongBlocked
```

---

## Part 2: Layer-by-Layer Breakdown

### Layer 1 — ML Model (Lorentzian Distance KNN)
- Uses `jdehorty/MLExtensions` library
- 5 features: RSI(14), WT(10,11), CCI(20), ADX(29), RSI(9)
- Classifies next 4 bars as long/short/neutral using K-nearest neighbors (default K=8)
- Distance metric: Lorentzian (log(1 + |diff|)) — not Euclidean
- Output: `prediction` (sum of K neighbor labels, range roughly -8 to +8)
- Filtered by: volatility filter, regime filter, ADX filter (threshold 20)

### Layer 2 — Kernel Regression (Nadaraya-Watson)
- Rational Quadratic kernel with lookback h=8, relative weighting r=8, regression level x=25
- `isBullish` = kernel rate is rising (yhat1[1] < yhat1)
- `isBearish` = kernel rate is falling
- This is the "trend direction" gate — ML prediction must align with kernel direction

### Layer 3 — Signal Change Detection
- `isNewBuySignal` = ML signal flipped to long AND is different from previous signal type
- Prevents re-entry on the same signal direction

### Layer 4 — Trend Confirmation (the "x" supertrend)
- A SECOND ATR-based supertrend with Multiplier2 = 1.6 (wider than the primary 0.8)
- `trendx == 1` means the wider supertrend confirms bullish
- When `useTrendXConf = true` (default), this must agree with the entry direction

### Layer 5 — Prediction Strength
- `effectiveLongStrength = prediction + fusionBonus - fusionPenalty + fusionV4Residual + contextBoost + squeezeBoost + divBoost`
- Must exceed `minPredSum` (default 1.8)
- This is where Fusion V4 residual layer adds/subtracts based on confirming signals

### Layer 6 — Cooldown
- `minBarsBetween = 1` — at least 1 bar between entries

### Layer 7 — Signal Fusion + Supertrend + Context
- **Signal Fusion V4** (active): When prediction is in range [2, 4], applies weighted residuals from ATR flip (-0.25 long, -0.5 short), engulfing (-0.25 long, -0.1 short), EMA cross (0)
- **Supertrend Filter** (active): Separate supertrend with ATR len=10, factor=1.5 must confirm direction
- **Squeeze Context** (active): Bollinger/Keltner squeeze detection, boosts strength by 0.25 on squeeze release
- **Divergence Context** (active): RSI divergence detection, boosts strength by 0.7 on bullish/bearish divergence

---

## Part 3: Trade Execution (Signal Engine)

Once `startLongTrade` or `startShortTrade` fires:

1. **Entry**: At current close price
2. **Stop Loss**: `close - slAtrMult * ATR(14)` — default `slAtrMult = 0.5` (very tight)
3. **Take Profit**: `close + tpAtrMult * ATR(14)` — default `tpAtrMult = 7.6` (wide, ~15:1 R:R)
4. **Trailing Stop**: Activates at `trailActivateR = 0.5` (50% of risk distance), trails at `trailAtrMult * ATR(14)`

Exit triggers (any one fires):
- Stop loss hit
- Take profit hit
- Trailing stop hit (once activated)
- Time stop (if enabled)
- Signal-based exit (if enabled)

---

## Part 4: The Signal Plots (Color Coding)

### Dark green / Light green (BUY signals):
- Line 1035: `plotshape(startLongTrade ? low : na, 'Buy', ...)` — colored by `ml.color_green(prediction)`
- Color intensity varies with prediction strength: **darker green = stronger ML prediction, lighter green = weaker prediction** (near threshold)
- This is the ACTUAL trade entry signal

### Dark red / Light red (SELL signals):
- Line 1036: `plotshape(startShortTrade ? high : na, 'Sell', ...)` — colored by `ml.color_red(-prediction)`
- Same logic: **darker red = stronger short prediction, lighter red = weaker**

The `ml.color_green(prediction)` and `ml.color_red(-prediction)` functions from the MLExtensions library create a gradient based on the prediction sum magnitude.

### Two SEPARATE supertrend signal layers:
- Lines 26-33: Primary supertrend (Multiplier 0.8) — green circles/labels for buy, red for sell
- Lines 47-52: Confirmation supertrend (Multiplier 1.6) — brighter green `rgb(0,255,0)` for confirmed buy, brighter red `rgb(255,0,0)` for confirmed sell

---

## Part 5: Indicators/Plots Present But NOT Used in Trade Decisions

| Indicator | Lines | What it does | Currently used for |
|---|---|---|---|
| **SuperTrend AI (K-Means Clustering)** | 1220-1400 | Clusters multiple supertrend factors, picks optimal via K-means | Display only (`showDash`) — NOT in entry logic |
| **Mean Reversion Channel (MRC)** | 1405-1640 | SuperSmoother-based channel with overbought/oversold zones, MTF analysis | Display only (`drawchannel`) — exported as `Feature_MRC_Condition` but not gated |
| **Market Structure Break (MSB)** | 1690-1870 | ZigZag-based structure breaks with order blocks (Bu-OB, Be-OB, Bu-BB, Be-BB) | Display only — exported as `Feature_MSB_Market` but not gated |
| **4 Smoothed Moving Averages** | 1060-1090 | SMMA(21/50/100/200) | Display only |
| **3 Line Strike** | 1100-1110 | Candlestick pattern detection | Used in Signal Fusion (if `use3LineConfirm=true`, currently **false**) |
| **Engulfing Candles** | 1120-1195 | Bullish/bearish engulfing detection | Used in Signal Fusion (`useEngulfingConfirm=true`) — **active** |
| **EMA Cross (38/62)** | 1140-1190 | Conservative entry arrows (B/S labels) | Display only — NOT in main entry logic |
| **Fibonacci Channel** | 60-63 | High/low range with fib levels | Display only |
| **EMA(20/50/100/200)** | 73-78 | Standard EMAs | Display only |
| **Cluster Performance Index** | ~1380 | Adaptive trailing stop based on cluster performance | Display only — exported as `Feature_Cluster_PerfIdx` |

---

## Part 6: Residual Uncertainty

1. The `ml.color_green(prediction)` function is from the external library — exact gradient mapping unknown, but maps prediction magnitude to color intensity.
2. The `Feature_*` exports (lines 916-940, 1880-1895) are data-window-only plots used by the autoresearch system for regime analysis — not visual signals but data feeds for the optimizer.
3. The Phase 4 exit-state parameters (`useFailedFollowThroughTighten`, `usePartialDerisk`, `useTimeStop`, etc.) are all defaulted to **false** in the current champion config — they exist in code but are not active. These are exactly what our expanded exit-state patch pool (Task 5) now explores.

---

## Part 7: Recommendations

### Priority 1: Let the fixes prove themselves (next 3-5 cycles)

The tiered ROI relaxation should promote the first candidate that hits PF >2x + DD improved + ROI regression ≤20%. The last challenger (PF 9.14, DD 1.19%) would have passed. Watch whether the system actually promotes something now.

### Priority 2: Exit-state research is the highest-ROI frontier

The expanded patch pool (13 patches, 6 families) explores exit management without touching entry logic. This is the safest path to improving the champion because:
- Entry logic is already strong (91.7% ROI, 261 trades)
- The tight stop (0.5 ATR) is the main ROI driver AND the main vulnerability
- Exit-state features (failed follow-through tighten, partial de-risk, adverse divergence tighten) can protect profits without reducing entry quality

**Don't touch entry gates yet.**

### Priority 3: Wire untapped indicators as CONTEXT signals, not entry gates

The MRC, MSB, and SuperTrend AI Clustering are already computed and exported as `Feature_*` plots. The right way to use them:

| Indicator | Best use | Why |
|---|---|---|
| **MRC Condition** | Exit shaping — tighten trail when overbought (condition ≥ 2) | Mean reversion pressure increases exit urgency, doesn't invalidate entries |
| **MSB Market** | Context boost/penalty to `effectiveStrength` | Structure break confirms or contradicts the ML signal direction |
| **SuperTrend AI Cluster** | Replace the fixed supertrend filter with the adaptive one | K-means picks optimal factor dynamically — strictly better than hardcoded 1.5 |

The pattern: **boost prediction strength or shape exits, don't add hard gates.** Hard gates reduce trade count. The champion already has 261 trades — losing trades to filtering is expensive when win rate is already good.

### Priority 4: What I would NOT do

- Don't add the EMA Cross (38/62) as an entry filter — it's redundant with the kernel regression
- Don't enable `use3LineConfirm` — candlestick patterns on 15m are noise
- Don't wire MRC as a hard entry block — overbought doesn't mean "don't enter," it means "manage the exit tighter"

---

## Part 8: The Structural Risk Nobody's Addressing

The system optimizes on a **single window** (XRPUSDT 15m, 10k bars, pinned). The diagnostic shadow evaluation we just added will reveal whether candidates that pass on XRP also pass on other assets. If shadows consistently fail, the champion is overfit to one regime and the real fix is multi-window primary evaluation — not more parameter tuning.

Watch the `diagnosticShadowResults` in the next few manifests. That data will tell you whether the search is finding generalizable improvements or XRP-specific artifacts.

---

## Part 9: Bottom Line Summary

The trade decision is made by a **Lorentzian KNN machine learning model** that predicts 4-bar price direction, gated by kernel regression trend, confirmation supertrend, prediction strength threshold (boosted by squeeze/divergence/fusion signals), and a separate supertrend filter. The color intensity of the Buy/Sell labels reflects ML prediction confidence. The strategy uses a tight stop (0.5 ATR) with a wide target (7.6 ATR) and an activating trailing stop — it's designed to catch rare high-conviction moves with asymmetric risk/reward.

The untapped indicators (SuperTrend AI Clustering, MRC, MSB/Order Blocks) are already computed and exported as features but not wired into the entry/exit logic — they represent the next research frontier.

---

## Structural Fixes Completed (2026-05-16)

| Commit | Task | What it does |
|---|---|---|
| `58ff753` | Task 1 | Tiered ROI relaxation — PF >2x + DD improved allows up to 20% ROI regression |
| `b9d37ae` | Task 3 | noScoreImprovementStreak only resets on primary lab pass, not raw score delta |
| `9f965b1` | Task 2 | Stagnation de-escalation — level drops by 1 after 2 consecutive productive cycles |
| `233ddf5` | Task 5 | Exit-state patch pool expanded from 3 to 13 patches across 6 feature families |
| `9828b13` | Task 4 | Diagnostic shadow evaluation — shadows run even on primary failure (best-effort) |
| `2c5f9d5` | Task 6 | Gate-aware filter — skips variants with slAtrMult below 50% of champion |
| `1ea0b6d` | Fix | Capture diagnosticShadowResults in evaluateMatrix destructuring |
| `df8366a` | Fix | De-escalation uses productive-cycle definition (excludes noScoreImprovementStreak) |

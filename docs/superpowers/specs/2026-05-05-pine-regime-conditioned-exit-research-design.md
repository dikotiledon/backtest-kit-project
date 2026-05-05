# Pine Regime-Conditioned Exit Research Design

## Status

Approved for spec writing on 2026-05-05. Not implemented yet.

## Goal

Upgrade Pine autoresearch from a mostly champion-local optimizer into a safer best-of-best discovery system by combining:

1. regime-conditioned shadow champion research
2. exit-state alpha research
3. controlled global all-parameter exploration
4. adversarial robustness validation

The system must preserve the current safe champion, matrix promotion gates, expectancy gates, lineage guardrails, and LLM lane isolation.

The design must also reduce RAM pressure. Comprehensive research stays intact, but heavy work must be streamed, staged, checkpointed, and bounded instead of loaded into one scheduler heap.

## Non-goals

- Do not switch live trading dynamically by regime in the first version.
- Do not loosen promotion gates when stagnation increases.
- Do not brute-force every parameter every cycle.
- Do not unfreeze forbidden architecture parameters unless explicitly configured.
- Do not merge the LLM lane into the non-LLM autoresearch lane.
- Do not replace the current global champion with a candidate that only wins one regime while hurting global expectancy.
- Do not store raw candles, raw JSONL rows, full cleaned rows, or full lab analysis objects inside manifests.
- Do not run all expensive validation layers for weak candidates that fail cheap prefilters.
- Do not require old manifests/history records to contain new fields.

## Current baseline

The current project has a strong global champion in the Pine V4 locked-window matrix. Recent evidence shows high ROI and profit factor, but challengers are still close to the champion family. The current loop already has good safety foundations:

- matrix validation
- expectancy-aware promotion gates
- promotion queue and autopromote controls
- lineage anti-ping-pong policy
- stagnation state and widening controls
- separated LLM research lane with review workflow

The main gap is alpha discovery depth. The entry stack is mature, and the loop can keep polishing near-duplicates instead of opening the highest-value frontiers: exit behavior, regime-specific performance, long/short asymmetry, and controlled all-parameter escape searches.

## Design summary

Add a new research layer named **Regime-Conditioned Exit Research**.

Each cycle allocates budget across four lanes:

| Lane | Default budget | Purpose |
|---|---:|---|
| Exploit | 25% | Keep improving near the current champion. |
| Exit/regime | 35% | Research exit families inside regime slices. |
| Global all-parameter | 25% | Periodic best-of-best escape across all tunable families. |
| Robustness/adversarial | 15% | Stress promising candidates before promotion. |

Stagnation widens search allocation, but never weakens promotion gates.

## Objective function

The ranking objective must be explicit. Win rate is not the main target.

Priority order:

1. **Profitability floor:** ROI must be meaningfully positive and above the configured floor.
2. **Expectancy:** average trade quality must not regress; fake win-rate gains are rejected.
3. **Profit factor:** profit factor must remain healthy after fees/slippage assumptions.
4. **Drawdown:** max drawdown must stay below cap and must not worsen beyond allowed delta.
5. **Trade count:** candidate must preserve enough trades globally and inside target regime.
6. **Robustness:** candidate must survive shadow, holdout, and adversarial checks.
7. **Win rate:** diagnostic only unless it improves without damaging expectancy.

Recommended candidate score shape:

```text
candidateUtility =
  roiComponent
  + expectancyComponent
  + profitFactorComponent
  - drawdownPenalty
  + tradeCountComponent
  + robustnessComponent
  + targetRegimeImprovement
  - complexityPenalty
  - multipleTestingPenalty
```

Promotion must use both absolute floors and incumbent-relative deltas. A candidate cannot promote from a pretty score if it fails a hard floor.

## Anti-overfit and leakage controls

### Walk-forward / leakage rule

Regime labels, regime thresholds, and scoring thresholds must be learned from the training/primary window only, then frozen before evaluating shadow and holdout labs.

Forbidden leakage patterns:

- choosing regime thresholds after seeing holdout performance
- changing target slice definitions per candidate
- using full-matrix outcomes to decide primary-window candidate generation
- promoting because a candidate happens to win a tiny post-hoc slice

### Multiple-testing guard

Global all-parameter search creates many attempts. Promotion margin must scale with search breadth.

Track per candidate batch:

- attempted candidate count
- valid candidate count
- mutation families touched
- regime slices evaluated
- exit families evaluated
- repeats / near-duplicates rejected

As search breadth rises, require extra evidence:

- higher minimum ROI delta
- higher minimum expectancy delta
- higher shadow pass count
- mandatory blind-holdout pass
- stricter drawdown delta

This prevents the system from rewarding the luckiest candidate from a large search batch.

## Architecture

### 1. Global champion anchor

The current global champion remains the only live promotion target for the first version. All candidates must prove they do not damage global performance before they can replace it.

### 2. Regime slices

Add deterministic regime labels for trades, windows, or validation slices:

- trend
- chop
- high volatility
- low volatility
- long-favored
- short-favored

Regime labels feed candidate scoring and shadow leaderboards. They do not directly change runtime behavior in version 1.

### 3. Exit-state candidate families

Generate structured exit candidates rather than random parameter soup. Families include:

- fixed ATR stop / take-profit
- trailing stop
- breakeven stop
- time stop
- partial take-profit
- long/short asymmetric exits

Each exit family owns bounded parameters, validation rules, and minimum trade requirements.

### 4. Controlled global all-parameter research

Keep all-parameter research, but make it scheduled and grouped. It searches across all tunable families without opening forbidden architecture switches by default.

Mutation groups:

- entry thresholds
- filters
- risk / stop / take-profit
- fusion weights
- long/short asymmetry
- exit-state parameters

Global search is the best-of-best escape valve. It should activate every cycle at a controlled budget and expand during stagnation.

### 5. Budget scheduler

The scheduler chooses a lane per cycle using:

- configured budget ratios
- budget debt from previous cycles
- active track state
- stagnation level
- recent novelty / similarity
- promotion cooldowns

Default allocation:

```json
{
  "exploitRatio": 0.25,
  "exitRegimeRatio": 0.35,
  "globalAllParameterRatio": 0.25,
  "robustnessRatio": 0.15
}
```

Stagnation behavior:

| Stagnation level | Behavior |
|---:|---|
| 0 | Favor exit/regime research. |
| 1 | Increase global all-parameter search. |
| 2 | Increase global + asymmetry search. |
| 3 | Run aggressive global search while keeping promotion gates strict. |

## Offline and connectivity model

The research loop must be able to run offline when pinned candle data is already present.

Current project support already points this way: `pinnedData.sourceMode` defaults to `local-cache`, `pine:dataset:stage` materializes datasets into the candle cache, `pine:dataset:verify` checks cache completeness, and `--require-cache-complete` fails fast when candles are missing instead of silently refetching network data.

Required behavior for this design:

- production scheduled autoresearch must use pinned datasets / local candle cache by default
- candidate generation, scoring, regime slicing, matrix validation, holdout, and robustness must not require network access
- network use is allowed only for explicit dataset refresh/pin commands, never as an implicit fallback inside a research cycle
- if a required candle is missing, the cycle must fail or skip the affected lab with a clear `offlineDataMissing` reason
- every manifest must record dataset ids, cache root, source mode, cache completeness result, and dataset hashes
- global all-parameter search and exit/regime search must use the same frozen dataset snapshot for a run
- LLM-assisted proposal remains optional and isolated; non-LLM autoresearch must remain fully offline-capable

Recommended modes:

| Mode | Network allowed | Use case |
|---|---:|---|
| `offline-strict` | no | scheduled research from verified cache only |
| `local-first` | explicit fallback only | manual refresh/debug |
| `refresh` | yes | dataset pin/backfill before research |

Before a full cycle, run dataset verification. If verification fails, do not run a partial matrix unless an explicit emergency profile trims labs and records that reduced coverage in the manifest.

## Resource architecture

The current implementation can be RAM-heavy because cleaned JSONL rows and analysis objects can be loaded into memory. This design keeps comprehensive research but changes execution shape.

### Resource budgets

Add explicit resource caps per profile:

- max candidate batch size
- max concurrent lab workers
- max rows loaded per worker
- max manifest bytes
- max retained artifact bytes per run
- max raw/cleaned/signals JSONL retention count
- soft timeout per lane
- hard timeout per candidate/lab process
- maximum memory per child process when the runtime supports it

Resource caps block or defer work; they do not loosen promotion gates.

### Streaming metrics

Metric calculation should stream JSONL instead of reading the whole file into arrays where possible.

Required direction:

- streaming JSONL parser
- incremental trade simulator
- rolling metric accumulators
- bounded top-N diagnostics
- bounded regime slice counters
- no raw row arrays in persisted manifests

Full-row analysis may still exist as a debug/development path, but production autoresearch should prefer streaming summaries.

### Staged evaluation ladder

Keep all functionality, but avoid running every expensive step on every candidate.

| Stage | Purpose | Runs on | Output |
|---|---|---|---|
| A. Cheap prefilter | Fast reject weak candidates | all generated candidates | compact primary metrics |
| B. Primary sweep | Rank valid candidates | prefilter survivors | top-K shortlist |
| C. Matrix validation | Cross-lab evidence | top-K shortlist | matrix decision |
| D. Blind holdout | Anti-overfit proof | matrix-promotable candidates | holdout verdict |
| E. Adversarial stress | Final robustness | queue candidates | stress verdict |

This preserves comprehensive validation while reducing peak RAM and runtime.

### Child-process isolation

Candidate/lab evaluation should run in isolated child processes where practical.

Rules:

- scheduler owns orchestration and compact summaries
- workers own heavy JSONL parsing and simulation
- worker returns bounded JSON summary only
- worker writes heavy artifacts to disk by path/hash
- worker timeout or memory failure marks that candidate/lab failed, not the whole scheduler

### Checkpoint and resume

Long cycles must checkpoint after each lane/candidate/lab stage.

Checkpoint records:

- run id
- lane
- candidate id/fingerprint
- lab id
- stage status
- summary artifact path/hash
- failure reason if any

On restart, the scheduler resumes incomplete work or safely marks stale work as failed. It should not rerun completed expensive labs unless inputs changed.

### 6. Shadow regime scoreboard

Maintain a shadow scoreboard of best candidates by regime slice. The scoreboard records evidence but does not promote directly.

Each shadow entry should include:

- regime slice id
- candidate id / fingerprint
- exit family
- global mutation family if applicable
- target-regime score delta
- global score delta
- ROI / expectancy / drawdown / trade count
- matrix decision summary
- robustness status

### 7. Promotion gate

Promotion requires all relevant gates:

- global ROI floor passes
- expectancy does not regress
- target regime improvement is material
- trade count remains healthy
- drawdown does not worsen beyond cap
- matrix/shadow labs pass
- robustness/adversarial checks pass when required
- lineage policy does not block the family transition

A candidate that wins one regime but loses global expectancy becomes a shadow winner only.

## Data flow

```text
champion + datasets + regime slices
  -> budget scheduler
  -> candidate generators
     -> exploit generator
     -> exit family generator
     -> global all-parameter generator
     -> robustness selector
  -> primary sweep
  -> matrix validation
  -> expectancy + regime scoring
  -> shadow regime scoreboard
  -> promotion queue / autopromote
```

## Artifact requirements

Cycle manifests should persist enough evidence for restart recovery and future agents:

- `researchBudgetMode`
- `budgetAllocation`
- `stagnationLevel`
- `regimeSliceId`
- `regimeSliceStats`
- `exitFamily`
- `exitFamilyParams`
- `globalMutationFamily`
- `globalMutationGroups`
- `shadowRegimeScoreboard`
- `robustnessStressSummary`
- `promotionGateBreakdown`
- `resourceBudget`
- `resourceUsageSummary`
- `checkpointState`
- `objectiveBreakdown`
- `multipleTestingPenalty`
- `holdoutVerdict`

Manifest size must be bounded. Heavy details belong in separate artifact files referenced by path, hash, byte size, and schema version.

Heavy artifacts may include:

- per-lab streaming metric summary
- regime slice summary
- robustness stress report
- top-N diagnostic samples
- invalid candidate report

Raw, cleaned, and signal JSONL files are operational artifacts, not manifest payloads. Retention policy must prune them.

Promotion queue items should include the regime and exit evidence used for the decision.

## Failure controls

- If a regime slice has too few trades, block promotion and write diagnostics.
- If global search generates a near-duplicate, novelty/tabu blocks it.
- If a candidate wins only one regime but loses global expectancy, keep it shadow-only.
- If robustness stress fails, block promotion.
- If all paths stagnate, increase search temperature and search breadth; do not reduce promotion thresholds.
- If a generator produces invalid params, reject before sweep.
- If global all-parameter search repeatedly fails, reduce its budget debt only after a valid attempted batch is produced.
- If a worker exceeds memory or timeout cap, mark the candidate/lab failed and continue the cycle.
- If manifest would exceed the configured size cap, write heavy sections as separate bounded artifacts and store references only.
- If checkpoint recovery finds partial outputs with mismatched hashes, discard and rerun only that stage.

## Rollback and kill switch

Add config flags that can disable new behavior without deleting code:

```json
{
  "regimeExitResearch": {
    "enabled": true,
    "exitRegimeEnabled": true,
    "globalAllParameterEnabled": true,
    "robustnessLadderEnabled": true,
    "streamingMetricsEnabled": true,
    "childWorkerIsolationEnabled": true
  }
}
```

Rollback behavior:

- if `regimeExitResearch.enabled=false`, run the existing autoresearch behavior
- if streaming metrics fail, optionally fall back to existing analyzer only for debug/manual runs
- if child-worker isolation fails, mark the candidate/lab failed unless debug fallback is explicitly enabled
- no rollback path may bypass matrix, expectancy, lineage, or autopromote gates

## Backward compatibility and migration

New manifest fields are optional for old history.

Rules:

- digest must tolerate missing regime/exit/resource fields
- promote/autopromote must tolerate old queue items without new evidence fields
- schema docs must mark new fields optional unless required only for new-version queue items
- old `latest.json` can bootstrap champion state without regime scoreboard
- history replay must skip unknown fields and default missing resource summaries to `null`
- tests must cover old manifest and old promotion queue shapes

## Testing plan

### Unit tests

- Regime labeling is deterministic.
- Regime slice minimum-trade rules block weak samples.
- Exit family generators produce bounded parameters.
- Global mutation generator respects allowlist and frozen architecture rules.
- Budget scheduler honors default ratios and budget debt.
- Stagnation widens search allocation without loosening gates.
- Promotion gate rejects fake win-rate gains and single-regime-only wins.
- Objective function prioritizes ROI/expectancy/PF/DD/trades over win rate.
- Multiple-testing penalty increases required promotion evidence as search breadth grows.
- Streaming metric accumulator matches existing full-load analyzer on fixture data.
- Manifest builder spills heavy sections to referenced artifacts when size cap is reached.
- Resource cap failures mark candidate/lab failed without crashing the scheduler.

### Integration tests

- A micro autoresearch cycle writes the new manifest fields.
- A candidate can become a shadow regime winner without promotion.
- A global all-parameter candidate must survive matrix validation before queueing.
- Matrix decision explains hold/promote with regime and exit evidence.
- Promotion queue includes regime, exit, robustness, and global evidence.
- Checkpoint resume skips completed stages and reruns only missing/mismatched stages.
- Worker timeout/memory failure produces a hold decision with clear diagnostics.
- Retention policy prunes raw/cleaned/signals JSONL while preserving summaries and hashes.

### No-regression tests

- Existing non-LLM autoresearch cycle still works.
- LLM lane remains isolated.
- Autopromote still requires matrix evidence.
- Existing expectancy policy still blocks bad candidates.
- Existing lineage anti-ping-pong behavior remains active.
- Old manifests without new fields still digest/promote safely.
- Existing analyzer remains available for manual debug flows.

## Recommended implementation order

1. Add compatibility-safe config flags and schema defaults.
2. Add objective function and multiple-testing penalty helpers.
3. Add streaming metric accumulator and prove parity with current analyzer fixtures.
4. Add resource budget model, manifest size cap, and artifact reference format.
5. Add checkpoint/resume state model.
6. Add regime slice model and deterministic scoring helpers.
7. Add exit family generator with bounded params.
8. Add global all-parameter grouped mutation generator.
9. Add budget scheduler with budget debt, stagnation widening, and resource caps.
10. Add child-process worker isolation for heavy candidate/lab evaluation.
11. Add shadow regime scoreboard artifact.
12. Extend promotion gate breakdown with regime/exit/global/holdout/resource evidence.
13. Extend manifests, digest, docs, and promotion queue items with backward-compatible optional fields.
14. Add unit, integration, no-regression, and old-artifact compatibility tests.
15. Run a micro cycle and inspect artifacts before enabling full cycle behavior.

## Open decisions before implementation

- Exact regime label formulas and thresholds.
- Exact minimum trade count per regime slice.
- Exact ROI / expectancy / drawdown floors for regime-only evidence.
- Whether partial take-profit can be represented in the current Pine strategy without architecture changes.
- Which parameters remain forbidden architecture switches in global search.
- Exact initial ROI, expectancy, drawdown, trade-count, and multiple-testing penalty thresholds.
- Exact resource caps per profile: micro/full/scheduled/debug.
- Whether production streaming metrics become default immediately or after parity burn-in.
- Whether child process memory caps use Node flags, OS job objects, or wrapper-level watchdogs on Windows.

## Approval checkpoint

This spec captures the approved combined direction: regime-conditioned champion research plus exit-state research, with controlled all-parameter search for best-of-best optimization. Implementation must not start until the user reviews and approves this written spec.

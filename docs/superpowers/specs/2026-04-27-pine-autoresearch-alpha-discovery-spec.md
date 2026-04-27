# Pine Autoresearch Alpha Discovery Spec

## Status
Approved for implementation

## Objective
Replace incumbent-local hill-climbing behavior with structurally distinct alpha discovery.

## Source Of Truth
- Runtime strategy: `pine/test.pine`
- Scheduler: `scripts/pine-autoresearch.mjs`
- Track generators: `scripts/lib/pine-track-generators.mjs`

## Current Champion Snapshot
- score: 131.19
- ROI: 81.11%
- PF: 3.26
- DD: 3.34%
- WR: 32.5%
- structure: fusion v4 + ATR flip confirm + engulf confirm + supertrend filter + trailing stop + stop/take-profit

## Why Incumbent-Local Polish Is Insufficient
The current champion is already strong, but it is still the product of local refinement around one structure. That is not enough for alpha discovery.

This effort must not:
- keep perturbing the same incumbent family under cosmetic track names
- treat track switching as a naming exercise
- optimize for win rate at the expense of expectancy
- preserve the same entry/exit shape and call it novelty

The research loop must search for meaningfully different exit-state behavior, asymmetry, and rotation outcomes rather than just polishing the incumbent.

## Track Isolation Rules
- Track isolation must be real, not cosmetic.
- A track must own its own candidate space, window set, and novelty signature.
- Track reuse of incumbent neighborhoods is capped and explicitly budgeted.
- Track transitions must not silently inherit prior champion bias.
- Shared artifacts may exist, but track identity must remain visible in every decision path.

## Rotation Hard-Trigger Rules
Rotation must hard-evict sticky active tracks when any of these occur:
- repeated no-change streaks on the active track
- repeated novelty signatures without champion change
- the same track keeps reproducing the incumbent on the same lab set
- no materially new alternate appears after the configured threshold

Rotation is a hard reset of research posture, not a soft preference flip.

## Exit-State Research Hypotheses
At least 40% of research budget must target exit-state discovery.

Hypotheses:
- exit quality may matter more than entry precision for the current champion family
- better asymmetry may come from distinct stop/target/trailing interactions
- trade management variants may outperform entry-only changes
- exit-state structure may reveal alpha that entry polishing cannot

## Long/Short Asymmetry Requirements
- Long and short logic must be treated as distinct surfaces.
- Shared symmetry assumptions are not acceptable by default.
- Track generators should be able to explore long-only, short-only, and asymmetric behaviors.
- A candidate that only improves one side while degrading the other must be evaluated as asymmetric, not averaged away.
- Asymmetry exploration is first-class, not a side effect of broadening the grid.

## Expectancy-Over-Win-Rate Promotion Policy
Promotion must prioritize expectancy over win rate.

Rules:
- win rate may not override weak expectancy
- higher WR is not sufficient if ROI, PF, or drawdown quality worsens materially
- candidates are judged on net edge and robustness, not cosmetic hit rate
- promotion gates must preserve the ability to reject low-expectancy, high-WR regressions

## Artifact/Report Requirements
Every run must leave behind enough evidence to explain why a candidate was kept, rotated, or rejected.

Required artifacts/reports:
- run manifest
- champion snapshot
- digest/report summary
- track identity and rotation reason
- novelty signature
- primary and shadow lab outcomes
- promotion or rejection rationale
- expectation-quality notes when a high-WR candidate is denied

Artifacts must make the research posture auditable after the fact.
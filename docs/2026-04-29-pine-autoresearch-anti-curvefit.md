# Pine autoresearch anti-curvefit protocol

## Problem

The scheduler must not treat repeated shadow-lab gating as a clean holdout. Primary + shadow labs are now the **selection matrix** only. Blind holdout labs are configured separately and are only reachable through the explicit `holdout` / `blind-holdout` command.

## Structural controls

1. **Complexity penalty**
   - `complexityPolicy` increases required score/ROI/PF deltas when a challenger activates new boolean modules such as `useRegimeFilter: false -> true`.
   - Promotion reports include raw deltas plus penalized deltas and adjusted thresholds.

2. **Lab tiers**
   - Training: `primaryLab` builds the shortlist.
   - Selection: `primaryLab + shadowLabs` decides active-cycle matrix promotion.
   - Blind holdout: `blindHoldoutLabs` is excluded from cycle/scout selection and evaluated only by `node scripts/pine-autoresearch.mjs holdout --config ...`.
   - Holdout status is `holdout_pass` or `premise_burn`.

3. **Annealing + tabu**
   - `searchPolicy.annealing` derives temperature from scheduler `noChangeStreak`.
   - Low/no streak keeps local offsets small; repeated holds expand offsets.
   - Scheduler state records rejected fingerprints in `tabuRejectedFingerprints`; generators skip known-rejected variants when possible.

## Operator rule

Do not run blind holdout during normal research cycles. Run it only after a matrix/research premise has completed its planned cycles and a final candidate is ready to falsify.

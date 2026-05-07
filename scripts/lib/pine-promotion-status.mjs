export const PROMOTION_STATUS = Object.freeze({
  PROMOTED: 'promoted',
  OPERATOR_BLOCKED: 'operator_blocked',
  QUEUE_BLOCKED: 'queue_blocked',
  SAFETY_FAILED: 'safety_failed',
  EXPECTANCY_FAILED: 'expectancy_failed',
  HOLDOUT_FAILED: 'holdout_failed',
  STALE: 'stale',
  INVALID: 'invalid',
});

export function isForceablePromotionStatus(status) {
  return status === PROMOTION_STATUS.OPERATOR_BLOCKED || status === PROMOTION_STATUS.QUEUE_BLOCKED;
}

export function classifyPromotionHoldReason(reason = '') {
  const text = String(reason);
  if (/expectancy/i.test(text)) return PROMOTION_STATUS.EXPECTANCY_FAILED;
  if (/holdout|blind/i.test(text)) return PROMOTION_STATUS.HOLDOUT_FAILED;
  if (/matrix|gate|anchor|cooldown|promotion/i.test(text)) return PROMOTION_STATUS.SAFETY_FAILED;
  if (/queue|lock|operator|manual/i.test(text)) return PROMOTION_STATUS.QUEUE_BLOCKED;
  return PROMOTION_STATUS.SAFETY_FAILED;
}

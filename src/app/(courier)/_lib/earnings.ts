// Moved to @chisinau/shared-domain (packages/shared-domain/src/earnings.ts) so the
// native courier app uses the SAME net-pay model. Shim keeps web imports working.
export {
  COMMISSION_PCT,
  round2,
  currentWeekRange,
  todayStart,
  pctAt,
  type PricingVersion,
  type CommissionSource,
  type EarningsOrder,
  netForOrder,
  quotedNetMdl,
  type ShiftEarningsOrder,
  type ShiftSummary,
  SHIFT_TARGET_MIN,
  SHIFT_TARGET_MAX,
  shiftReachesTarget,
  formatShiftDuration,
  summarizeShifts,
  type EarningsSummary,
  summarizeEarnings,
} from "@chisinau/shared-domain";

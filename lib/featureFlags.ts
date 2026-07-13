// Central place to toggle features that are fully built but not yet
// user-facing. Each flag below is wired end-to-end (UI + API routes +
// DB columns already exist and are exercised by tests-by-hand in dev),
// but is switched off in production until we're ready to launch it.
// Flip a flag to `true` and redeploy -- no other code changes needed.
export const FEATURE_FLAGS = {
  // Buyers can cancel a posted job from the tracking page. Free to cancel
  // before a driver has accepted (unpaid or pending). Once a driver has
  // accepted, the cancellation fee equals the job's DISTANCE CHARGE (the
  // per-km component of the price, see distanceFeeForKm in lib/pricing.ts,
  // floored at CANCELLATION_FEE_CENTS) to reimburse the driver for their
  // time. It is recorded on the job and folded into the buyer's next job's
  // checkout. Cancelling is blocked once the item has been picked up.
  CANCELLATION_ENABLED: true,

  // Promo codes: customers can enter a code when posting a job for a % off
  // or a full service-fee waiver (see supabase discount_codes table). A code
  // is only CONSUMED when the job actually activates (payment succeeds, or a
  // full waiver posts the job with nothing to pay). If the job it was used
  // for is cancelled, the code is automatically restored for re-use.
  DISCOUNT_CODES_ENABLED: true,
}

// FLOOR for the after-acceptance cancellation fee: the fee is the job's
// distance charge (km-based driver reimbursement), but never below this.
export const CANCELLATION_FEE_CENTS = 200

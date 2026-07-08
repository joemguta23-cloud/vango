// Central place to toggle features that are fully built but not yet
// user-facing. Each flag below is wired end-to-end (UI + API routes +
// DB columns already exist and are exercised by tests-by-hand in dev),
// but is switched off in production until we're ready to launch it.
// Flip a flag to `true` and redeploy -- no other code changes needed.
export const FEATURE_FLAGS = {
  // Buyers can cancel a posted job from the tracking page. Free to cancel
  // before a driver has accepted; once a driver has accepted, a $2 fee is
  // recorded and folded into the buyer's next completed job's checkout.
  CANCELLATION_ENABLED: false,

  // Promo codes: customers can enter a code when posting a job for a % off
  // or a full service-fee waiver (see supabase discount_codes table). Single-
  // use codes are consumed on the first successful post and also expire after
  // 10 minutes; a reusable master code waives the fee for friends/family.
  DISCOUNT_CODES_ENABLED: true,
}

// Fixed $2 fee applied to a buyer's next completed job if they cancel
// a job after a driver has already accepted it.
export const CANCELLATION_FEE_CENTS = 200

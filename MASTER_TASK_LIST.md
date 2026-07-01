# VanGo Master Task List

Living checklist of product/business items to build or activate as the business grows. Update as items are completed or new ones come up.

Last updated: 2026-07-01

---

## Status legend
- `[LIVE]` - built and active in production right now
- `[BUILT-OFF]` - code/schema exists but intentionally disabled (feature flag off) until the business is ready to turn it on
- `[TODO]` - not built yet

---

## 1. Payments & fees

- `[LIVE]` **$12 service fee real payment processing** - Buyers are redirected to a real Stripe Checkout page when they post a job, charged exactly $12 AUD, described as "VanGo service fee". Card and Apple Pay are enabled in the Stripe account; Google Pay was enabled today. PayPal is NOT available in this Stripe account/region -- would need a separate PayPal Business integration if wanted later. The driver's fee stays cash-on-delivery, unaffected by this charge. Webhook endpoint `vango-production` (`https://getvango.com.au/api/stripe/webhook`) is live and confirmed receiving `payment_intent.succeeded` / `payment_intent.payment_failed` events, which mark the job as paid and notify the buyer. Tested end-to-end on production on 2026-07-01: job post -> Checkout session created -> correct $12 fee shown.
- `[BUILT-OFF]` **Cancellation policy** - Free to cancel before a driver accepts. $2 fee if cancelled after a driver has accepted and is en route; fee is folded into the buyer's next Stripe Checkout session as a separate "Previous cancellation fee" line item, and only marked as charged once that payment actually succeeds (via the webhook). Fully wired: `app/api/jobs/cancel/route.ts` (cancel endpoint), a "Cancel job" button on the buyer tracking page, and fee logic in `app/api/stripe/create-checkout-session/route.ts` + `app/api/stripe/webhook/route.ts`. Everything is gated behind `FEATURE_FLAGS.CANCELLATION_ENABLED` in `lib/featureFlags.ts` (currently `false`) -- flip that one flag and redeploy to turn it on, no other code changes needed.
- `[BUILT-OFF]` **Discount / promo codes** - Codes for a percent-off (10/20/30%) or a full service-fee waiver, stored in the `discount_codes` Supabase table (RLS-locked, server-only access). Fully wired: `app/api/discount-codes/validate/route.ts` (validation endpoint), a promo code input on the buyer job-posting page (Step 3), and fee logic in `app/api/stripe/create-checkout-session/route.ts` + usage-count tracking in `app/api/stripe/webhook/route.ts`. Gated behind `FEATURE_FLAGS.DISCOUNT_CODES_ENABLED` in `lib/featureFlags.ts` (currently `false`). To launch a promo: insert a row into `discount_codes` in Supabase, then flip the flag.
- `[TODO]` **GST registration** - ABN is not currently GST-registered, so no GST is being charged/remitted. Once turnover approaches the ATO's $75,000/year GST threshold (or earlier by choice), register for GST and add a GST line item to the service fee invoicing. Revisit with an accountant before flipping this on.
- `[TODO]` **Driver payouts** - Stripe Connect is partially wired (see `app/api/stripe/connect/*`), needs end-to-end testing once real payments are live, so drivers actually receive their cut automatically.

## 2. Trust & safety

- `[TODO]` **AI photo moderation** - Screen buyer-uploaded item photos for nudity/inappropriate content before they're visible to drivers (e.g. Google Cloud Vision SafeSearch or AWS Rekognition). Needed for child-safety and to prevent platform abuse.
- `[TODO]` **Call number masking** - "Call driver" currently dials the driver's real personal mobile number directly (no privacy layer). A proper fix needs a telephony provider (e.g. Twilio proxy numbers) to mask both sides' real numbers - this is a recurring paid service, needs a decision before building.
- `[TODO]` **Post-delivery feedback / complaints** - After a driver marks a job delivered, prompt the buyer for feedback. DB table `job_feedback` exists (via migration_003), but there's no UI to submit it and no email routing yet. On a complaint, should auto-email m.dershaye@gmail.com and joemguta23@gmail.com. Sending real emails needs an email service (Resend) wired up first -- pending user decision.
- `[TODO]` **Contact Us form** - Footer button on every page, opens a simple message form. Publicly displayed address is getvango@gmail.com, but submissions should actually route to m.dershaye@gmail.com and joemguta23@gmail.com. DB table `contact_messages` exists (via migration_003), but there's no UI or email routing yet. Blocked on the same email service decision as feedback/complaints above.

## 3. Core product features

- `[TODO]` **Google Places address autocomplete** - Replace free-text pickup/dropoff fields with real address predictions (Google Places Autocomplete), so drivers always get a real, findable address, and so real lat/lng can replace the stubbed coordinates currently used for all jobs. Requires a Google Cloud API key with billing enabled (Places API) -- pending user to provide the key.
- `[LIVE]` **Live GPS driver tracking on the map** - Uber Eats-style live driver location on the buyer's tracking page while a job is `accepted`/`picked_up`. Driver broadcasts location via `navigator.geolocation.watchPosition` (throttled ~8s writes); buyer's map polls every 10s and shows a pulsing "Live" badge + driver pin via an OpenStreetMap embed. Driver's lat/lng is explicitly nulled out server-side the moment a job is marked delivered, for privacy.
- `[LIVE]` **In-app messaging DB schema** - `job_messages` table and RLS policies exist (via migration_003). The chat UI itself is still `[TODO]` -- see item #8 in the working task list; the "💬 Message" button is currently a dead button with no `onClick`.
- `[LIVE]` **Multi-pickup / multi-dropoff** - Toggle for a 2nd pickup and/or 2nd dropoff address on a single job (`app/buyer/post/page.tsx` Step 3), at a flat $15/stop add-on (`EXTRA_STOP_FEE` in `lib/pricing.ts`) versus booking two separate jobs. Second-stop addresses show on both the buyer tracking page and the driver's active-job page (with a "🧭 extra stops" heads-up banner for the driver).
- `[TODO]` **Editable profile / account settings** - Buyers and drivers currently cannot edit their name, phone, driver's licence, vehicle details, etc. after onboarding. Default display name should be "Driver #1234" / "Buyer #1234" style until the user sets a real name.

## 4. Already fixed (for reference)

- Vercel deploy was stuck on a broken build for ~10 hours due to unescaped apostrophes in two files - fixed.
- Homepage was a blank stub - restored with real content.
- Tracking page map/progress/job-details were stripped down to nothing - restored, map now works.
- Garbled emoji/icons across the site (encoding corruption) - fixed everywhere found.
- Mobile horizontal scroll/overflow - fixed via CSS.
- Item description was silently required despite being meant to be optional - fixed.
- Multi-item "add another item" crashed the whole page (typo: `ADDTIONAL_ITEM_DISCOUNT` vs `ADDITIONAL_ITEM_DISCOUNT`) - fixed.
- Drivers now see a warning + confirmation before accepting a multi-item job, so they can check it'll fit in their vehicle.
- Real $12 service fee payment via Stripe Checkout is live -- new `app/api/stripe/create-checkout-session/route.ts`, wired into `app/buyer/post/page.tsx`, webhook endpoint recreated pointing at the real production domain with a fresh signing secret set in Vercel.
- Live GPS driver-to-buyer tracking shipped (see section 3 above).
- Multi-pickup / multi-dropoff shipped end-to-end, including driver-side display of extra stops (see section 3 above).
- Cancellation policy and discount/promo codes fully built and feature-flagged off, ready to switch on in `lib/featureFlags.ts` when the business is ready (see section 1 above).

---

## How to use this file

When picking up new work on VanGo, start here. Move items from `[TODO]` to `[IN PROGRESS]` to `[LIVE]` (or `[BUILT-OFF]` if it's built but intentionally not switched on yet), and keep the "Already fixed" section as a running changelog.

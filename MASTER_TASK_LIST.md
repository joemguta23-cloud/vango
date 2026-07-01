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
- `[BUILT-OFF]` **Cancellation policy** - Free to cancel before a driver accepts. $2 fee if cancelled after a driver has accepted and is en route; fee is charged automatically the next time the buyer completes a paid job (not charged immediately). Code and DB fields exist but the cancel button / fee logic is behind a feature flag and not yet shown to users. Turn on when ready in `lib/featureFlags.ts`.
- `[BUILT-OFF]` **Discount / promo codes** - Admin-issued codes for 10%, 20%, or 30% off, or a full service-fee waiver (for the launch promotion). Code + DB table exist, not exposed in the checkout UI yet. Turn on in `lib/featureFlags.ts` when ready to launch the promo.
- `[TODO]` **GST registration** - ABN is not currently GST-registered, so no GST is being charged/remitted. Once turnover approaches the ATO's $75,000/year GST threshold (or earlier by choice), register for GST and add a GST line item to the service fee invoicing. Revisit with an accountant before flipping this on.
- `[TODO]` **Driver payouts** - Stripe Connect is partially wired (see `app/api/stripe/connect/*`), needs end-to-end testing once real payments are live, so drivers actually receive their cut automatically.

## 2. Trust & safety

- `[TODO]` **AI photo moderation** - Screen buyer-uploaded item photos for nudity/inappropriate content before they're visible to drivers (e.g. Google Cloud Vision SafeSearch or AWS Rekognition). Needed for child-safety and to prevent platform abuse.
- `[TODO]` **Call number masking** - "Call driver" currently dials the driver's real personal mobile number directly (no privacy layer). A proper fix needs a telephony provider (e.g. Twilio proxy numbers) to mask both sides' real numbers - this is a recurring paid service, needs a decision before building.
- `[TODO]` **Post-delivery feedback / complaints** - After a driver marks a job delivered, prompt the buyer for feedback. Log all feedback in-app for admin visibility. On a complaint (e.g. negative feedback flag), auto-email m.dershaye@gmail.com and joemguta23@gmail.com.
- `[TODO]` **Contact Us form** - Footer button on every page, opens a simple message form. Publicly displayed address is getvango@gmail.com, but submissions actually route to m.dershaye@gmail.com and joemguta23@gmail.com (not a live inbox at getvango@gmail.com).

## 3. Core product features

- `[IN PROGRESS]` **Google Places address autocomplete** - Replace free-text pickup/dropoff fields with real address predictions (Google Places Autocomplete), so drivers always get a real, findable address. Requires a Google Cloud API key with billing enabled.
- `[TODO]` **Live GPS driver tracking on the map** - Uber Eats-style live driver location on the buyer's tracking page while a job is accepted/in progress. Driver location sharing must stop automatically once a job is marked delivered or cancelled, for privacy.
- `[TODO]` **In-app messaging** - Buyer <-> driver chat on the job/tracking page. Currently a dead button with no functionality.
- `[TODO]` **Multi-pickup / multi-dropoff** - Toggle for a 2nd pickup and/or 2nd dropoff address on a single job, at a heavily discounted add-on price versus booking two separate jobs (since the driver is already en route).
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

---

## How to use this file

When picking up new work on VanGo, start here. Move items from `[TODO]` to `[IN PROGRESS]` to `[LIVE]` (or `[BUILT-OFF]` if it's built but intentionally not switched on yet), and keep the "Already fixed" section as a running changelog.

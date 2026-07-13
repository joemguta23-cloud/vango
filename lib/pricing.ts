/**
 * Vanute Pricing Engine
 *
 * SINGLE SOURCE OF TRUTH for the rules is PRICING_ANALYTICS_POLICY.md.
 * Keep the numbers here in sync with that doc as we tune from real delivery data.
 *
 * driver_fee (cash / PayID) =
 *     (main_item_base x time_multiplier)
 *   + distance_fee (TIERED: 30c/km first 50km, 60c/km 50-150km; >150km = quote-on-request)
 *   + extra_item_fee (flat, per additional item from the SAME pickup)
 *   + extra_stops_fee (flat, per additional pickup/dropoff address),
 *   then ROUNDED UP to nearest $5, then floored at MIN_DRIVER_FEE if any item is picked up.
 * A per-driver fuel surcharge for the driver->pickup leg is added when matched.
 * service_fee (card, platform revenue) = $11.99 flat.
 *
 * SIZING: CATALOGUE-DRIVEN WITH FLEXIBILITY + GUARDRAILS.
 * Every known item type has a DEFAULT price size (`size`) and a MINIMUM
 * (`minSize`) it can never price below. The customer can adjust the size for
 * any item — up (a genuinely massive desk can be Large or X-Large) or down —
 * but never below the item's floor:
 *   - A fridge is never Small: even a bar fridge still needs careful upright
 *     handling, so its floor is Medium (default Large).
 *   - Specialist items (piano, pool table, spa) floor at Large.
 *   - Light items (desk, TV, mattress...) floor at Medium — they never ride
 *     in the free Small tier, but can be upgraded when unusually big.
 *   - Only genuine small-category items (boxes & bags, small appliances) and
 *     "Other" can be Small.
 * The driver can still re-rate UP at pickup when the real item is bigger
 * than described — that remains the ultimate anti-gaming guardrail.
 */
import type { ItemSize } from '@/types'

// Full-price base driver fee by (effective) size. Small = free.
export const BASE_FEES: Record<ItemSize, number> = { small: 0, medium: 55, large: 85, xlarge: 130 }
const BASE = BASE_FEES

// Distance charge. TIERED so metro stays cheap but longer legs actually pay the
// driver -- a flat 30c/km loses money past the metro fringe (a 700km interstate
// run would price at a guaranteed loss no driver accepts). See distanceFeeForKm.
export const DISTANCE_RATE_PER_KM = 0.30       // metro rate, first LONG_DISTANCE_TIER_KM
export const DISTANCE_RATE_LONG_PER_KM = 0.60  // 50-150 km leg
export const LONG_DISTANCE_TIER_KM = 50        // metro rate applies up to here
export const MAX_QUOTED_KM = 150               // beyond this: quote-on-request (see quoteRequired)

// Minimum driver fee whenever ANY item is picked up. Without this, a small-item
// short-distance job can round to $0 -- "a posted job nobody accepts" is the
// one failure the launch plan says is fatal.
export const MIN_DRIVER_FEE = 15

// Flat fee for each ADDITIONAL item collected from the same pickup address.
// (A second pickup/dropoff ADDRESS is the separate EXTRA_STOP_FEE below.)
// Small additional items are free; medium-and-above additional items are flat.
export const EXTRA_ITEM_FEE = 10

// ---------------------------------------------------------------------------
// ITEM CATALOGUE -- the pricing table with per-item guardrails.
//
// `size`    is the DEFAULT price tier for that item type.
// `minSize` is the FLOOR the customer can never go below (anti-gaming); they
//           may pick any size from minSize up to X-Large. `size: null` means
//           the customer chooses freely ("Other").
//
// `effort` drives the helper prompts and driver expectations:
//   easy       -- one person, quick slide-on (ladder, mattress, TV)
//   two_person -- heavy / awkward, needs 2 sets of hands and often a trolley
//   specialist -- serious multi-person specialist load (piano, spa)
//
// Item names kept identical to the legacy list where possible so old jobs,
// icons and analytics stay consistent. Compiled from the most common
// Facebook Marketplace / Gumtree second-hand categories (appliances,
// couches & sectionals, dining sets, beds & frames, mattresses, TVs,
// shelving, dressers, gym gear, outdoor).
// ---------------------------------------------------------------------------
export type LoadEffort = 'easy' | 'two_person' | 'specialist'

export interface CatalogEntry {
  name: string          // stored in jobs.item_type
  label: string         // shown on the picker tile
  icon: string
  size: ItemSize | null // DEFAULT price tier; null = customer selects (Other)
  minSize: ItemSize     // FLOOR — the customer can never price below this
  effort: LoadEffort
  loadNote: string      // why it's priced this way (shown to customer + driver)
}

export const ITEM_CATALOG: CatalogEntry[] = [
  // -- Large ($85 default, floor Medium): heavy / high loading time --
  { name: 'Fridge', label: 'Fridge', icon: '🧊', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Heavy — needs a trolley, two people and careful upright handling. A small bar fridge can be set to Medium, but a fridge is never Small.' },
  { name: 'Washer/Dryer', label: 'Washer / Dryer', icon: '🌀', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Heavy — needs a trolley and two people to load safely.' },
  { name: 'Couch', label: 'Couch / Sofa', icon: '🛋️', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Bulky and heavy — two people to carry and load. A compact 2-seater can be Medium.' },
  { name: 'Wardrobe', label: 'Wardrobe', icon: '🚪', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Tall and heavy — two people, handled with care.' },
  { name: 'Drawers/Dresser', label: 'Drawers / Dresser', icon: '🗄️', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Solid and heavy — two people to lift and load.' },
  { name: 'Dining Table', label: 'Dining Table', icon: '🍽️', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Big and awkward — two people to carry and load.' },
  { name: 'Gym Equipment', label: 'Gym / Treadmill', icon: '🏋️', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Dense and awkward — two people and slow careful loading.' },
  { name: 'Materials', label: 'Building Materials', icon: '🧱', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Heavy loads — takes real time and muscle to load.' },
  { name: 'Outdoor Setting', label: 'Outdoor Setting', icon: '⛱️', size: 'large', minSize: 'medium', effort: 'two_person',
    loadNote: 'Multiple heavy pieces — two people to load.' },

  // -- X-Large ($130 default, floor Large): specialist multi-person jobs --
  { name: 'Piano', label: 'Piano', icon: '🎹', size: 'xlarge', minSize: 'large', effort: 'specialist',
    loadNote: 'Specialist move — very heavy, multiple people, careful handling.' },
  { name: 'Pool Table', label: 'Pool Table', icon: '🎱', size: 'xlarge', minSize: 'large', effort: 'specialist',
    loadNote: 'Specialist move — extremely heavy, multiple people.' },
  { name: 'Spa', label: 'Spa / Hot Tub', icon: '🛁', size: 'xlarge', minSize: 'large', effort: 'specialist',
    loadNote: 'Specialist move — very large and heavy, multiple people.' },

  // -- Medium ($55 default, floor Medium): big but light / quick loads.
  //    Upgradable to Large/X-Large when unusually big or heavy (a massive
  //    executive desk, a king mattress, a huge trampoline...). Never Small —
  //    the free tier is only for genuine small items. --
  { name: 'Mattress', label: 'Mattress', icon: '🛏️', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Big but light — slides straight on. Upgrade the size for a heavy king ensemble.' },
  { name: 'Bed Frame', label: 'Bed Frame', icon: '🛌', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light when disassembled — quick to load.' },
  { name: 'TV', label: 'TV', icon: '📺', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light — carried by one person with care.' },
  { name: 'Desk', label: 'Desk / Small Table', icon: '🖥️', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light — quick one-person load. A big or heavy desk? Set it to Large.' },
  { name: 'Bookshelf', label: 'Bookshelf', icon: '📚', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light when empty — quick to load.' },
  { name: 'Chairs', label: 'Chairs', icon: '🪑', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light — quick to stack and load.' },
  { name: 'BBQ', label: 'BBQ', icon: '🍖', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Rolls on its wheels — quick to load.' },
  { name: 'Ladder', label: 'Ladder', icon: '🪜', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Long but light — slides straight on.' },
  { name: 'Bike', label: 'Bike', icon: '🚲', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light — lifts straight on.' },
  { name: 'Rug/Mirror', label: 'Rug / Mirror', icon: '🖼️', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light — handled with care, quick to load.' },
  { name: 'Tools', label: 'Tools', icon: '🧰', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Compact — quick to load.' },
  { name: 'Garden', label: 'Garden / Plants', icon: '🌿', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light — quick to load.' },
  { name: 'Trampoline', label: 'Trampoline', icon: '🤸', size: 'medium', minSize: 'medium', effort: 'easy',
    loadNote: 'Light when disassembled — quick to load.' },

  // -- Small (free driver fee) — genuine small items only. Can be upgraded
  //    when it is actually a big load (a ute-load of boxes is not Small). --
  { name: 'Boxes & Bags', label: 'Boxes & Bags', icon: '📦', size: 'small', minSize: 'small', effort: 'easy',
    loadNote: 'Small items ride free — you only pay the service fee. A full ute-load of boxes? Set a bigger size.' },
  { name: 'Small Appliance', label: 'Small Appliance', icon: '🔌', size: 'small', minSize: 'small', effort: 'easy',
    loadNote: 'Microwave, toaster etc — rides free, only the service fee applies.' },

  // -- Other: customer selects a size; description is mandatory; driver re-rates --
  { name: 'Other', label: 'Other', icon: '❓', size: null, minSize: 'small', effort: 'easy',
    loadNote: 'Describe it clearly — the driver confirms the size at pickup.' },
]

// Legacy type names from before the catalogue rework, mapped to a price
// floor so old rows / stale clients still price sensibly.
const LEGACY_SIZE: Record<string, ItemSize> = { 'TV/Desk': 'medium' }

export function catalogEntry(itemType: string): CatalogEntry | undefined {
  return ITEM_CATALOG.find(e => e.name === itemType)
}

// Item types that are genuinely heavy / high loading-time (kept for backwards
// compatibility with pre-catalogue jobs and older clients).
export const HEAVY_LOAD_TYPES = ['Fridge', 'Washer/Dryer', 'Couch', 'Wardrobe', 'Gym Equipment', 'Materials', 'Piano']

const SIZE_ORDER: ItemSize[] = ['small', 'medium', 'large', 'xlarge']

/**
 * The sizes a customer is ALLOWED to pick for an item type: everything from
 * the item's floor (minSize) up to X-Large. Drives the size selector in the
 * post/edit forms.
 */
export function allowedSizes(itemType: string): ItemSize[] {
  const entry = catalogEntry(itemType)
  const floor = entry?.minSize ?? LEGACY_SIZE[itemType] ?? 'small'
  return SIZE_ORDER.slice(SIZE_ORDER.indexOf(floor))
}

/**
 * The size we actually PRICE an item at. The item's minSize is a hard FLOOR:
 * a fridge can never be priced below Medium no matter what the client sends,
 * and no light item can sneak into the free Small tier. Within the allowed
 * range the customer's choice is honoured, and the driver can still re-rate
 * upward at pickup.
 */
export function effectiveSize(itemType: string, size: ItemSize): ItemSize {
  const entry = catalogEntry(itemType)
  const floor = entry?.minSize ?? LEGACY_SIZE[itemType] ?? null
  if (floor && SIZE_ORDER.indexOf(size) < SIZE_ORDER.indexOf(floor)) return floor
  return size
}

export type DistanceZone = 'under_15' | '15_to_30' | '30_to_50' | 'over_50'

// Kept for internal record-keeping only (jobs.distance_zone). Not shown to
// customers anymore -- they see the flat per-km charge, not a tier.
export const DISTANCE_ZONE_LABELS: Record<DistanceZone, string> = {
  under_15: 'Under 15 km',
  '15_to_30': '15-30 km',
  '30_to_50': '30-50 km',
  over_50: 'Over 50 km',
}

// Platform's flat card fee (revenue). The driver fee is paid separately in cash / PayID.
export const SERVICE_FEE = 11.99

// Add-on for a 2nd pickup or 2nd dropoff ADDRESS on the same job.
export const EXTRA_STOP_FEE = 15

// Driver-economics constants.
export const FUEL_RATE_PER_KM = 0.70        // driver fuel reimbursement, per km
export const FREE_PICKUP_KM = 10            // first 10km to pickup are free (except late-night)
export const PLATFORM_CONNECTION_FEE = 0.99 // all the platform keeps on a late buyer-cancellation

// Round a cash amount UP to the nearest $5 (drivers rarely carry coins/change).
export function roundUpTo5(amount: number): number {
  return Math.ceil(amount / 5) * 5
}

// Tiered pickup->dropoff distance charge. Metro rate for the first
// LONG_DISTANCE_TIER_KM, a higher rate for the 50-150km leg so the driver is
// actually paid for a long run, and beyond MAX_QUOTED_KM the job needs a
// manual quote (calculatePrice sets quoteRequired). Returns whole dollars.
export function distanceFeeForKm(km: number): number {
  const k = Math.max(0, km)
  if (k <= LONG_DISTANCE_TIER_KM) return Math.round(k * DISTANCE_RATE_PER_KM)
  return Math.round(LONG_DISTANCE_TIER_KM * DISTANCE_RATE_PER_KM + (k - LONG_DISTANCE_TIER_KM) * DISTANCE_RATE_LONG_PER_KM)
}

export function isLateNight(at: Date = new Date()): boolean {
  const mins = at.getHours() * 60 + at.getMinutes()
  return mins >= 21 * 60 || mins < 7 * 60 // 9:00pm - 7:00am
}

/**
 * Time-of-day demand multiplier applied to the main-item base fee.
 * Weekdays are busier; commute peaks get a surcharge; late night is full price.
 * Weekends are held at full price (1.00): weekends are exactly when Marketplace
 * pickups spike and when the trial runs, so we must NOT pay drivers least when
 * demand peaks. Tune these values in PRICING_ANALYTICS_POLICY.md.
 */
export function pricingMultiplier(at: Date = new Date()): number {
  const day = at.getDay()                 // 0=Sun ... 6=Sat
  const isWeekend = day === 0 || day === 6
  const mins = at.getHours() * 60 + at.getMinutes()
  if (isLateNight(at)) return 1.00                          // full price, no discount
  const weekdayPeak = !isWeekend && (
    (mins >= 7 * 60 && mins <= 9 * 60 + 15) ||              // 7:00-9:15am
    (mins >= 16 * 60 && mins <= 18 * 60 + 30)               // 4:00-6:30pm
  )
  if (weekdayPeak) return 1.10                              // +10% commute-peak surcharge
  if (isWeekend) return 1.00                                // weekend: full price (demand peak)
  return 0.95                                               // weekday off-peak daytime: 5% off
}

/**
 * Fuel surcharge for the driver's trip TO the pickup. Added once a driver is
 * matched (depends on that driver's live location). First 10km free, except
 * late-night when every km is charged. 70c/km.
 */
export function driverPickupSurcharge(driverToPickupKm: number, at: Date = new Date()): number {
  const freeKm = isLateNight(at) ? 0 : FREE_PICKUP_KM
  const chargeableKm = Math.max(0, driverToPickupKm - freeKm)
  return Math.round(chargeableKm * FUEL_RATE_PER_KM)
}

export interface PriceItem { size: ItemSize; label: string; type?: string }

export interface ExtraStops {
  secondPickup?: boolean
  secondDropoff?: boolean
}

export interface PriceBreakdown {
  items: { label: string; fee: number; isExtra: boolean; free: boolean }[]
  distanceFee: number
  extraStopsFee: number
  timeMultiplier: number
  driverFee: number
  serviceFee: number
  total: number
  quoteRequired: boolean
}

/**
 * Calculate the price for a job.
 * @param items       one or more items, all from the same (first) pickup address
 * @param distanceKm  straight-line km between pickup and dropoff (0 if unknown)
 * @param extraStops  whether a 2nd pickup / 2nd dropoff address was added
 */
export function calculatePrice(items: PriceItem[], distanceKm: number, extraStops: ExtraStops = {}, at: Date = new Date()): PriceBreakdown {
  const timeMultiplier = pricingMultiplier(at)
  const distanceFee = distanceFeeForKm(distanceKm)
  // Beyond the quotable radius we can't guarantee a driver at an auto price --
  // the posting UI should block/quote when this is true.
  const quoteRequired = Math.max(0, distanceKm) > MAX_QUOTED_KM
  if (items.length === 0) {
    const noItemFee = roundUpTo5(distanceFee)
    return { items: [], distanceFee, extraStopsFee: 0, timeMultiplier, driverFee: noItemFee, serviceFee: SERVICE_FEE, total: noItemFee + SERVICE_FEE, quoteRequired }
  }

  // Resolve each item to its effective (priced) size, then order largest-first
  // so the "main" item carries the base fee and the rest are flat add-ons.
  const resolved = items.map(it => ({ ...it, eff: effectiveSize(it.type ?? '', it.size) }))
  resolved.sort((a, b) => SIZE_ORDER.indexOf(b.eff) - SIZE_ORDER.indexOf(a.eff))

  const lineItems = resolved.map((it, i) => {
    if (i === 0) {
      // Main item: full base fee for its effective size (small = $0).
      return { label: it.label, fee: BASE[it.eff], isExtra: false, free: BASE[it.eff] === 0 }
    }
    // Additional item from the same pickup: flat fee, or free if small.
    const fee = it.eff === 'small' ? 0 : EXTRA_ITEM_FEE
    return { label: it.label, fee, isExtra: true, free: fee === 0 }
  })

  const mainFee = lineItems[0].fee
  const extrasTotal = lineItems.slice(1).reduce((sum, i) => sum + i.fee, 0)
  const extraStopsFee = (extraStops.secondPickup ? EXTRA_STOP_FEE : 0) + (extraStops.secondDropoff ? EXTRA_STOP_FEE : 0)

  // Time multiplier applies to the main item's loading work only. Distance,
  // extra items and extra stops are flat, predictable add-ons.
  const adjusted = mainFee * timeMultiplier + distanceFee + extrasTotal + extraStopsFee
  // Round UP to nearest $5, then floor at MIN_DRIVER_FEE -- a driver is never
  // asked to do a real pickup for less (e.g. a boxes-only short hop).
  const driverFee = Math.max(MIN_DRIVER_FEE, roundUpTo5(adjusted))
  return { items: lineItems, distanceFee, extraStopsFee, timeMultiplier, driverFee, serviceFee: SERVICE_FEE, total: driverFee + SERVICE_FEE, quoteRequired }
}

/**
 * Late buyer-cancellation charge (driver already near/at pickup).
 * The platform keeps only a $0.99 connection fee (covers running costs, see T&Cs);
 * the driver receives a $5 goodwill share of the service fee PLUS full fuel
 * reimbursement for the trip they already made.
 */
export function lateBuyerCancellationCharge(driverToPickupKm: number, at: Date = new Date()): { buyerCharge: number; driverPayout: number; platformFee: number } {
  const fuel = driverPickupSurcharge(driverToPickupKm, at)
  const driverGoodwill = 5.00
  const driverPayout = Math.round((driverGoodwill + fuel) * 100) / 100
  const platformFee = PLATFORM_CONNECTION_FEE
  return { buyerCharge: Math.round((driverPayout + platformFee) * 100) / 100, driverPayout, platformFee }
}

export function formatAUD(amount: number): string { return `$${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}` }

// -- Auto distance calculation -----------------------------------------
// Straight-line (Haversine) distance in km between two lat/lng points.
// Used once the buyer picks addresses via Google Places autocomplete, so we
// avoid an extra paid Distance Matrix/Routes API call just to price a job.
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Kept for internal record-keeping (jobs.distance_zone). Not shown to customers.
export function kmToZone(km: number): DistanceZone {
  if (km < 15) return 'under_15'
  if (km < 30) return '15_to_30'
  if (km < 50) return '30_to_50'
  return 'over_50'
}

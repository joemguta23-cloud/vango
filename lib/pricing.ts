/**
 * VanGo Pricing Engine
 *
 * SINGLE SOURCE OF TRUTH for the rules is PRICING_ANALYTICS_POLICY.md.
 * Keep the numbers here in sync with that doc as we tune from real delivery data.
 *
 * driver_fee (cash / PayID) =
 *     (main_item_base x time_multiplier)
 *   + distance_fee (flat 30c per km, pickup -> dropoff)
 *   + extra_item_fee (flat, per additional item from the SAME pickup)
 *   + extra_stops_fee (flat, per additional pickup/dropoff address),
 *   then ROUNDED UP to nearest $5.
 * A per-driver fuel surcharge for the driver->pickup leg is added when matched.
 * service_fee (card, platform revenue) = $11.99 flat.
 *
 * SIZING IS NOW CATALOGUE-DRIVEN (anti-gaming). Every known item type has a
 * FIXED price size in ITEM_CATALOG below, chosen by how long it takes to
 * load, how many hands it needs, and whether it needs a trolley:
 *   - A fridge is ALWAYS Large: trolley, two people, kept upright.
 *   - A ladder/mattress/TV is big but light and quick to slide on: Medium.
 *   - Piano / pool table / spa are specialist two-plus-person jobs: X-Large.
 * Customers no longer pick a size for known items -- the catalogue assigns it,
 * so "fridge marked as small" is impossible. Only "Other" lets the customer
 * choose, and the driver can re-rate any item at pickup when they see it.
 * Small / very-small items (boxes, bags, small appliances) are NOT charged a
 * driver fee at all -- only the flat service fee applies.
 */
import type { ItemSize } from '@/types'

// Full-price base driver fee by (effective) size. Small = free.
export const BASE_FEES: Record<ItemSize, number> = { small: 0, medium: 55, large: 85, xlarge: 130 }
const BASE = BASE_FEES

// Flat distance charge, applied per km of the pickup -> dropoff leg.
export const DISTANCE_RATE_PER_KM = 0.30

// Flat fee for each ADDITIONAL item collected from the same pickup address.
// (A second pickup/dropoff ADDRESS is the separate EXTRA_STOP_FEE below.)
// Small additional items are free; medium-and-above additional items are flat.
export const EXTRA_ITEM_FEE = 10

// ---------------------------------------------------------------------------
// ITEM CATALOGUE -- the anti-gaming pricing table.
//
// `size` is the FIXED price tier for that item type (a floor the customer
// cannot go below; the driver can still re-rate UP at pickup). `size: null`
// means the customer chooses ("Other").
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
  size: ItemSize | null // fixed price tier; null = customer selects (Other)
  effort: LoadEffort
  loadNote: string      // why it's priced this way (shown to customer + driver)
}

export const ITEM_CATALOG: CatalogEntry[] = [
  // -- Large ($85 base): heavy / high loading time, 2 people, often a trolley --
  { name: 'Fridge', label: 'Fridge', icon: '🧊', size: 'large', effort: 'two_person',
    loadNote: 'Heavy — needs a trolley, two people and careful upright handling.' },
  { name: 'Washer/Dryer', label: 'Washer / Dryer', icon: '🌀', size: 'large', effort: 'two_person',
    loadNote: 'Heavy — needs a trolley and two people to load safely.' },
  { name: 'Couch', label: 'Couch / Sofa', icon: '🛋️', size: 'large', effort: 'two_person',
    loadNote: 'Bulky and heavy — two people to carry and load.' },
  { name: 'Wardrobe', label: 'Wardrobe', icon: '🚪', size: 'large', effort: 'two_person',
    loadNote: 'Tall and heavy — two people, handled with care.' },
  { name: 'Drawers/Dresser', label: 'Drawers / Dresser', icon: '🗄️', size: 'large', effort: 'two_person',
    loadNote: 'Solid and heavy — two people to lift and load.' },
  { name: 'Dining Table', label: 'Dining Table', icon: '🍽️', size: 'large', effort: 'two_person',
    loadNote: 'Big and awkward — two people to carry and load.' },
  { name: 'Gym Equipment', label: 'Gym / Treadmill', icon: '🏋️', size: 'large', effort: 'two_person',
    loadNote: 'Dense and awkward — two people and slow careful loading.' },
  { name: 'Materials', label: 'Building Materials', icon: '🧱', size: 'large', effort: 'two_person',
    loadNote: 'Heavy loads — takes real time and muscle to load.' },
  { name: 'Outdoor Setting', label: 'Outdoor Setting', icon: '⛱️', size: 'large', effort: 'two_person',
    loadNote: 'Multiple heavy pieces — two people to load.' },

  // -- X-Large ($130 base): specialist multi-person jobs --
  { name: 'Piano', label: 'Piano', icon: '🎹', size: 'xlarge', effort: 'specialist',
    loadNote: 'Specialist move — very heavy, multiple people, careful handling.' },
  { name: 'Pool Table', label: 'Pool Table', icon: '🎱', size: 'xlarge', effort: 'specialist',
    loadNote: 'Specialist move — extremely heavy, multiple people.' },
  { name: 'Spa', label: 'Spa / Hot Tub', icon: '🛁', size: 'xlarge', effort: 'specialist',
    loadNote: 'Specialist move — very large and heavy, multiple people.' },

  // -- Medium ($55 base): big but light / quick one-person load --
  { name: 'Mattress', label: 'Mattress', icon: '🛏️', size: 'medium', effort: 'easy',
    loadNote: 'Big but light — slides straight on.' },
  { name: 'Bed Frame', label: 'Bed Frame', icon: '🛌', size: 'medium', effort: 'easy',
    loadNote: 'Light when disassembled — quick to load.' },
  { name: 'TV', label: 'TV', icon: '📺', size: 'medium', effort: 'easy',
    loadNote: 'Light — carried by one person with care.' },
  { name: 'Desk', label: 'Desk / Small Table', icon: '🖥️', size: 'medium', effort: 'easy',
    loadNote: 'Light — quick one-person load.' },
  { name: 'Bookshelf', label: 'Bookshelf', icon: '📚', size: 'medium', effort: 'easy',
    loadNote: 'Light when empty — quick to load.' },
  { name: 'Chairs', label: 'Chairs', icon: '🪑', size: 'medium', effort: 'easy',
    loadNote: 'Light — quick to stack and load.' },
  { name: 'BBQ', label: 'BBQ', icon: '🍖', size: 'medium', effort: 'easy',
    loadNote: 'Rolls on its wheels — quick to load.' },
  { name: 'Ladder', label: 'Ladder', icon: '🪜', size: 'medium', effort: 'easy',
    loadNote: 'Long but light — slides straight on.' },
  { name: 'Bike', label: 'Bike', icon: '🚲', size: 'medium', effort: 'easy',
    loadNote: 'Light — lifts straight on.' },
  { name: 'Rug/Mirror', label: 'Rug / Mirror', icon: '🖼️', size: 'medium', effort: 'easy',
    loadNote: 'Light — handled with care, quick to load.' },
  { name: 'Tools', label: 'Tools', icon: '🧰', size: 'medium', effort: 'easy',
    loadNote: 'Compact — quick to load.' },
  { name: 'Garden', label: 'Garden / Plants', icon: '🌿', size: 'medium', effort: 'easy',
    loadNote: 'Light — quick to load.' },
  { name: 'Trampoline', label: 'Trampoline', icon: '🤸', size: 'medium', effort: 'easy',
    loadNote: 'Light when disassembled — quick to load.' },

  // -- Small (free driver fee): only the service fee applies --
  { name: 'Boxes & Bags', label: 'Boxes & Bags', icon: '📦', size: 'small', effort: 'easy',
    loadNote: 'Small items ride free — you only pay the service fee.' },
  { name: 'Small Appliance', label: 'Small Appliance', icon: '🔌', size: 'small', effort: 'easy',
    loadNote: 'Microwave, toaster etc — rides free, only the service fee applies.' },

  // -- Other: customer selects a size; description is mandatory; driver re-rates --
  { name: 'Other', label: 'Other', icon: '❓', size: null, effort: 'easy',
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
 * The size we actually PRICE an item at. The catalogue size is a FLOOR:
 * a fridge can never be priced below Large no matter what the client sends.
 * A customer can still go bigger (e.g. an unusually huge item of a known
 * type), and the driver can re-rate upward at pickup.
 */
export function effectiveSize(itemType: string, size: ItemSize): ItemSize {
  const entry = catalogEntry(itemType)
  const floor = entry?.size ?? LEGACY_SIZE[itemType] ?? null
  if (floor && SIZE_ORDER.indexOf(size) < SIZE_ORDER.indexOf(floor)) return floor
  // No floor (e.g. "Other"), or the chosen/re-rated size is at/above the
  // floor: honour it as-is. (The old "large-but-light -> medium" downgrade is
  // gone -- the catalogue now assigns light-but-large items to Medium
  // directly, so a customer-chosen Large on "Other" genuinely means heavy.)
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

export function isLateNight(at: Date = new Date()): boolean {
  const mins = at.getHours() * 60 + at.getMinutes()
  return mins >= 21 * 60 || mins < 7 * 60 // 9:00pm - 7:00am
}

/**
 * Time-of-day demand multiplier applied to the main-item base fee.
 * Weekdays are busier (smaller discount); commute peaks get a surcharge;
 * late night is full price. Tune these values in PRICING_ANALYTICS_POLICY.md.
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
  if (isWeekend) return 0.85                                // weekend daytime: 15% off
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
}

/**
 * Calculate the price for a job.
 * @param items       one or more items, all from the same (first) pickup address
 * @param distanceKm  straight-line km between pickup and dropoff (0 if unknown)
 * @param extraStops  whether a 2nd pickup / 2nd dropoff address was added
 */
export function calculatePrice(items: PriceItem[], distanceKm: number, extraStops: ExtraStops = {}, at: Date = new Date()): PriceBreakdown {
  const timeMultiplier = pricingMultiplier(at)
  const distanceFee = Math.round(Math.max(0, distanceKm) * DISTANCE_RATE_PER_KM)
  if (items.length === 0) {
    return { items: [], distanceFee, extraStopsFee: 0, timeMultiplier, driverFee: roundUpTo5(distanceFee), serviceFee: SERVICE_FEE, total: roundUpTo5(distanceFee) + SERVICE_FEE }
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
  const driverFee = roundUpTo5(adjusted) // cash / PayID to driver, rounded UP to nearest $5
  return { items: lineItems, distanceFee, extraStopsFee, timeMultiplier, driverFee, serviceFee: SERVICE_FEE, total: driverFee + SERVICE_FEE }
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

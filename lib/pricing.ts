/**
 * VanGo Pricing Engine
 *
 * SINGLE SOURCE OF TRUTH for the rules is PRICING_ANALYTICS_POLICY.md.
 * Keep the numbers here in sync with that doc as we tune from real delivery data.
 *
 * driver_fee (cash) = ((item_base + multi_item_discount) + distance_zone_surcharge)
 *                     x time_multiplier + extra_stops_fee, then ROUNDED UP to nearest $5.
 * A per-driver fuel surcharge for the driver->pickup leg is added when a driver is matched.
 * service_fee (card, platform revenue) = $11.99 flat.
 */
import type { ItemSize } from '@/types'

// Full-price base fees. The time-of-day multiplier below applies the discount/surcharge.
const BASE: Record<ItemSize, number> = { medium: 55, large: 85, xlarge: 130 }

const DISTANCE_SURCHARGE: {[key: string]: Record<ItemSize, number>} = {
  'under_15': { medium: 0, large: 0, xlarge: 0 },
  '15_to_30': { medium: 20, large: 25, xlarge: 35 },
  '30_to_50': { medium: 40, large: 50, xlarge: 65 },
  'over_50': { medium: 65, large: 80, xlarge: 100 },
}

export type DistanceZone = 'under_15' | '15_to_30' | '30_to_50' | 'over_50'

export const DISTANCE_ZONE_LABELS: Record<DistanceZone, string> = {
  under_15: 'Under 15 km',
  '15_to_30': '15-30 km',
  '30_to_50': '30-50 km',
  over_50: 'Over 50 km',
}

// Tiered multi-item discount: 1st item full price, 2nd 50% off, 3rd+ 70% off.
const ITEM_DISCOUNT_TIERS = [0, 0.5, 0.7]
function discountForIndex(i: number): number {
  return ITEM_DISCOUNT_TIERS[Math.min(i, ITEM_DISCOUNT_TIERS.length - 1)]
}

// Platform's flat card fee (revenue). The driver fee is paid separately in cash.
export const SERVICE_FEE = 11.99

// Add-on for a 2nd pickup or 2nd dropoff on the same job.
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
 * Time-of-day demand multiplier applied to the delivery subtotal.
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

export interface PriceItem { size: ItemSize; label: string }

export interface ExtraStops {
  secondPickup?: boolean
  secondDropoff?: boolean
}

export interface PriceBreakdown {
  items: { label: string; fee: number; discounted: boolean; discountPercent: number }[]
  distanceSurcharge: number
  extraStopsFee: number
  timeMultiplier: number
  driverFee: number
  serviceFee: number
  total: number
}

export function calculatePrice(items: PriceItem[], zone: DistanceZone, extraStops: ExtraStops = {}, at: Date = new Date()): PriceBreakdown {
  const timeMultiplier = pricingMultiplier(at)
  if (items.length === 0) return { items: [], distanceSurcharge: 0, extraStopsFee: 0, timeMultiplier, driverFee: 0, serviceFee: SERVICE_FEE, total: SERVICE_FEE }
  const sizeOrder: ItemSize[] = ['medium', 'large', 'xlarge']
  const largestSize = items.reduce((max, item) =>
    sizeOrder.indexOf(item.size) > sizeOrder.indexOf(max) ? item.size : max, 'medium' as ItemSize)
  const distanceSurcharge = DISTANCE_SURCHARGE[zone][largestSize]
  const lineItems = items.map((item, i) => {
    const base = BASE[item.size]
    const discount = discountForIndex(i)
    const discounted = discount > 0
    const fee = discounted ? Math.round(base * (1 - discount)) : base
    return { label: item.label, fee, discounted, discountPercent: Math.round(discount * 100) }
  })
  const itemsTotal = lineItems.reduce((sum, i) => sum + i.fee, 0)
  const extraStopsFee = (extraStops.secondPickup ? EXTRA_STOP_FEE : 0) + (extraStops.secondDropoff ? EXTRA_STOP_FEE : 0)
  // Time multiplier applies to delivery work (items + distance); extra stops are flat add-ons.
  const adjusted = (itemsTotal + distanceSurcharge) * timeMultiplier + extraStopsFee
  const driverFee = roundUpTo5(adjusted) // cash to driver, rounded UP to nearest $5
  return { items: lineItems, distanceSurcharge, extraStopsFee, timeMultiplier, driverFee, serviceFee: SERVICE_FEE, total: driverFee + SERVICE_FEE }
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
// avoid an extra paid Distance Matrix/Routes API call for a rough pricing
// tier -- straight-line is a fine approximation for a 4-bucket price zone.
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function kmToZone(km: number): DistanceZone {
  if (km < 15) return 'under_15'
  if (km < 30) return '15_to_30'
  if (km < 50) return '30_to_50'
  return 'over_50'
}

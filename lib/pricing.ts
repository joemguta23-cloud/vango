/**
 * VanGo Pricing Engine
 * Formula: driver_fee = base_rate + distance_charge + multi_item_discount + extra_stops_fee
 * service_fee = $11.99 flat (VanGo's revenue)
 */
import type { ItemSize } from '@/types'

const BASE: Record<ItemSize, number> = { medium: 44, large: 68, xlarge: 104 }

const DISTANCE_SURCHARGE: {[key: string]: Record<ItemSize, number>} = {
  'under_15': { medium: 0, large: 0, xlarge: 0 },
  '15_to_30': { medium: 16, large: 20, xlarge: 28 },
  '30_to_50': { medium: 32, large: 40, xlarge: 52 },
  'over_50': { medium: 52, large: 64, xlarge: 80 },
}

export type DistanceZone = 'under_15' | '15_to_30' | '30_to_50' | 'over_50'

export const DISTANCE_ZONE_LABELS: Record<DistanceZone, string> = {
  under_15: 'Under 15 km',
  '15_to_30': '15-30 km',
  '30_to_50': '30-50 km',
  over_50: 'Over 50 km',
}

// Tiered multi-item discount: 1st item full price, 2nd item 50% off,
// 3rd item and every item after that 70% off.
const ITEM_DISCOUNT_TIERS = [0, 0.5, 0.7]
function discountForIndex(i: number): number {
  return ITEM_DISCOUNT_TIERS[Math.min(i, ITEM_DISCOUNT_TIERS.length - 1)]
}

export const SERVICE_FEE = 11.99

// Flat add-on for a 2nd pickup or 2nd dropoff on the same job. Deliberately
// cheap compared to booking a whole separate job, since the driver is
// already en route -- this is what makes multi-stop worth it for the buyer.
export const EXTRA_STOP_FEE = 12

export interface PriceItem { size: ItemSize; label: string }

export interface ExtraStops {
  secondPickup?: boolean
  secondDropoff?: boolean
}

export interface PriceBreakdown {
  items: { label: string; fee: number; discounted: boolean; discountPercent: number }[]
  distanceSurcharge: number
  extraStopsFee: number
  driverFee: number
  serviceFee: number
  total: number
}

export function calculatePrice(items: PriceItem[], zone: DistanceZone, extraStops: ExtraStops = {}): PriceBreakdown {
  if (items.length === 0) return { items: [], distanceSurcharge: 0, extraStopsFee: 0, driverFee: 0, serviceFee: SERVICE_FEE, total: SERVICE_FEE }
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
  const driverFee = itemsTotal + distanceSurcharge + extraStopsFee
  return { items: lineItems, distanceSurcharge, extraStopsFee, driverFee, serviceFee: SERVICE_FEE, total: driverFee + SERVICE_FEE }
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

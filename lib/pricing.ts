/**
 * VanGo Pricing Engine
 * Formula: driver_fee = base_rate + distance_charge + multi_item_discount + extra_stops_fee
 * service_fee = $12 flat (VanGo's revenue)
 */
import type { ItemSize } from '@/types'

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

const ADDITIONAL_ITEM_DISCOUNT = 0.30

export const SERVICE_FEE = 12

// Flat add-on for a 2nd pickup or 2nd dropoff on the same job. Deliberately
// cheap compared to booking a whole separate job, since the driver is
// already en route -- this is what makes multi-stop worth it for the buyer.
export const EXTRA_STOP_FEE = 15

export interface PriceItem { size: ItemSize; label: string }

export interface ExtraStops {
  secondPickup?: boolean
  secondDropoff?: boolean
}

export interface PriceBreakdown {
  items: { label: string; fee: number; discounted: boolean }[]
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
    const discounted = i > 0
    const fee = discounted ? Math.round(base * (1 - ADDITIONAL_ITEM_DISCOUNT)) : base
    return { label: item.label, fee, discounted }
  })
  const itemsTotal = lineItems.reduce((sum, i) => sum + i.fee, 0)
  const extraStopsFee = (extraStops.secondPickup ? EXTRA_STOP_FEE : 0) + (extraStops.secondDropoff ? EXTRA_STOP_FEE : 0)
  const driverFee = itemsTotal + distanceSurcharge + extraStopsFee
  return { items: lineItems, distanceSurcharge, extraStopsFee, driverFee, serviceFee: SERVICE_FEE, total: driverFee + SERVICE_FEE }
}

export function formatAUD(amount: number): string { return `$${amount.toFixed(0)}` }

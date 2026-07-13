// ── User roles ────────────────────────────────────────────────────────────────
export type UserRole = 'buyer' | 'driver' | 'admin'

export interface Profile {
  id: string
  full_name: string
  phone: string
  role: UserRole
  created_at: string
}

export interface Driver {
  id: string
  user_id: string
  vehicle_type: 'ute' | 'van' | 'truck'
  vehicle_make: string
  vehicle_model: string
  vehicle_plate: string
  is_online: boolean
  current_lat: number | null
  current_lng: number | null
  location_updated_at: string | null
  rating: number
  total_jobs: number
  profile?: Profile
}

export type ItemSize = 'small' | 'medium' | 'large' | 'xlarge'

export interface JobItem {
  item_type: string
  item_size: ItemSize
  description: string
  photo_url: string | null
}

export interface HelperInfo {
  helper_at_pickup: boolean
  helper_at_dropoff: boolean
  helper_note: string
}

export type JobStatus = 'pending' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled'

export type DistanceZone = 'under_15' | '15_to_30' | '30_to_50' | 'over_50'

export interface Job {
  id: string
  buyer_id: string
  driver_id: string | null
  items: JobItem[]
  item_type: string
  item_size: ItemSize
  item_description: string
  photo_url: string | null
  helper_at_pickup: boolean
  helper_at_dropoff: boolean
  helper_note: string | null
  pickup_address: string
  pickup_lat: number
  pickup_lng: number
  dropoff_address: string
  dropoff_lat: number
  dropoff_lng: number
  second_pickup_address: string | null
  second_pickup_lat: number | null
  second_pickup_lng: number | null
  second_dropoff_address: string | null
  second_dropoff_lat: number | null
  second_dropoff_lng: number | null
  extra_stops_fee: number
  distance_zone: DistanceZone
  scheduled_for: string | null
  status: JobStatus
  driver_fee: number
  service_fee: number
  stripe_payment_intent_id: string | null
  // Cancellation policy (feature-flagged, see lib/featureFlags.ts). Free to
  // cancel before a driver accepts; cancellation_fee_owed is set to true if
  // cancelled after acceptance, and a $2 fee is folded into the buyer's next
  // completed job's checkout once cancellation_fee_charged flips to true.
  cancelled_at: string | null
  cancelled_by: string | null
  cancellation_fee_owed: boolean
  cancellation_fee_charged: boolean
  // Discount / promo code applied at posting time (feature-flagged).
  discount_code_id: string | null
  // ── Buyer job editing (Uber-style) ─────────────────────────────────────────
  // While a driver is assigned, buyer edits are stored here as a pending
  // CHANGE REQUEST until the driver accepts or declines (see
  // app/api/jobs/edit and app/api/jobs/respond-change). NULL when no request
  // is outstanding. `fields` is the full replacement column set; `summary`
  // is the human-readable old → new diff shown to the driver.
  pending_changes?: { fields: Record<string, any>; summary: string[]; requested_at: string } | null
  change_requested_at?: string | null
  change_reminded_at?: string | null
  // ── Columns that exist in the DB and are read by various pages ─────────────
  accepted_at?: string | null
  picked_up_at?: string | null
  delivered_at?: string | null
  service_fee_paid?: boolean
  delivery_note?: string | null
  original_driver_fee?: number | null
  pickup_photo_url?: string | null
  dropoff_photo_url?: string | null
  rating?: number | null
  cancellation_stage?: string | null
  cancellation_fee?: number | null
  created_at: string
  updated_at: string
  driver?: Driver
  buyer?: Profile
}

export interface JobStatusEvent {
  id: string
  job_id: string
  status: JobStatus
  note: string | null
  created_at: string
}

// ── Discount / promo codes (feature-flagged, see lib/featureFlags.ts) ─────────
export interface DiscountCode {
  id: string
  code: string
  percent_off: number | null
  waive_service_fee: boolean
  max_uses: number | null
  uses_count: number
  active: boolean
  expires_at: string | null
  created_at: string
}

// ── In-app messaging between buyer and driver on a job ────────────────────────
export interface JobMessage {
  id: string
  job_id: string
  sender_id: string
  body: string
  created_at: string
  sender?: Profile
}

// ── Post-delivery buyer feedback / complaints ──────────────────────────────────
export interface JobFeedback {
  id: string
  job_id: string
  buyer_id: string
  rating: number | null
  comment: string | null
  is_complaint: boolean
  created_at: string
}

// ── Contact Us submissions ──────────────────────────────────────────────────────
export interface ContactMessage {
  id: string
  name: string | null
  email: string | null
  message: string
  created_at: string
}

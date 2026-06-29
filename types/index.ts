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
  rating: number
  total_jobs: number
  profile?: Profile
}

export type ItemSize = 'medium' | 'large' | 'xlarge'

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
  distance_zone: DistanceZone
  scheduled_for: string | null
  status: JobStatus
  driver_fee: number
  service_fee: number
  stripe_payment_intent_id: string | null
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

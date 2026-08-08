// Australian states & territories Vanute can operate in.
// Only regions with `enabled: true` are currently serviceable. As Vanute
// expands, flip a region's `enabled` to true — the whole app reads from
// here, so the signup selector (and any future region gating) updates
// automatically.

export interface Region {
  code: string
  name: string
  enabled: boolean
}

export const REGIONS: Region[] = [
  { code: 'VIC', name: 'Victoria', enabled: true },
  { code: 'NSW', name: 'New South Wales', enabled: false },
  { code: 'QLD', name: 'Queensland', enabled: false },
  { code: 'SA', name: 'South Australia', enabled: false },
  { code: 'WA', name: 'Western Australia', enabled: false },
  { code: 'TAS', name: 'Tasmania', enabled: false },
  { code: 'ACT', name: 'Australian Capital Territory', enabled: false },
  { code: 'NT', name: 'Northern Territory', enabled: false },
]

export const DEFAULT_REGION = 'VIC'

export const ENABLED_REGIONS = REGIONS.filter((r) => r.enabled)

export function isRegionEnabled(code: string): boolean {
  return REGIONS.some((r) => r.code === code && r.enabled)
}

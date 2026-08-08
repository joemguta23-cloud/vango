'use client'
import { useEffect, useRef, useState } from 'react'

interface AddressAutocompleteProps {
  placeholder: string
  value: string
  onChange: (address: string, lat: number | null, lng: number | null) => void
}

// Melbourne CBD -- biases (does not restrict) results toward Victoria, since
// Vanute is live in Melbourne & Victoria first (Australia-wide rollout).
const VIC_BIAS = { lat: -37.8136, lng: 144.9631 }

let mapsLoadPromise: Promise<void> | null = null

function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const w = window as any
  if (w.google?.maps?.places) return Promise.resolve()
  if (mapsLoadPromise) return mapsLoadPromise
  mapsLoadPromise = new Promise((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!key) { reject(new Error('Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY')); return }
    w.__vanuteMapsLoaded = () => resolve()
    // If Google rejects the key at runtime (e.g. a referrer/quota problem) it
    // calls gm_authFailure -- treat that as "no autocomplete" and fall back to
    // a plain input instead of leaving Google's error overlay in the way.
    w.gm_authFailure = () => reject(new Error('Google Maps auth failure (check key referrers)'))
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&loading=async&callback=__vanuteMapsLoaded`
    script.async = true
    script.onerror = () => reject(new Error('Failed to load Google Maps script'))
    document.head.appendChild(script)
  })
  return mapsLoadPromise
}

// Wraps Google's new PlaceAutocompleteElement web component. We use the
// "new" Autocomplete (via importLibrary('places')) rather than the classic
// google.maps.places.Autocomplete widget, because the classic widget is no
// longer available to Google Cloud projects created after March 2025 -- our
// project is new, so the old widget would silently fail to return results.
// If the Maps script or the new element fails to load for any reason, we
// fall back to a plain text input so the buyer can still type an address by
// hand (lat/lng default to a Melbourne-area fallback at submit time).
// Selecting a suggestion applies it instantly (gmp-select) -- no extra
// confirm step.
export default function AddressAutocomplete({ placeholder, value, onChange }: AddressAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then(async () => {
        if (cancelled || !containerRef.current) return
        const w = window as any
        const { PlaceAutocompleteElement } = await w.google.maps.importLibrary('places')
        const el = new PlaceAutocompleteElement({
          includedRegionCodes: ['au'],
          locationBias: { radius: 50000, center: VIC_BIAS },
        })
        el.placeholder = placeholder
        el.style.width = '100%'
        el.addEventListener('gmp-select', async (e: any) => {
          try {
            const place = e.placePrediction.toPlace()
            await place.fetchFields({ fields: ['formattedAddress', 'location'] })
            const lat = place.location ? place.location.lat() : null
            const lng = place.location ? place.location.lng() : null
            onChange(place.formattedAddress || '', lat, lng)
          } catch (err) {
            console.error('Failed to fetch selected place details', err)
          }
        })
        containerRef.current.innerHTML = ''
        containerRef.current.appendChild(el)
        if (!cancelled) setReady(true)
      })
      .catch((err) => {
        console.error('Address suggestions unavailable, falling back to plain input', err)
        if (!cancelled) setFallback(true)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (fallback) {
    return (
      <input className="input" placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value, null, null)} />
    )
  }

  return (
    <div>
      <div ref={containerRef} className="vanute-places-input" />
      {!ready && (
        <input className="input" placeholder={placeholder} value={value}
          onChange={e => onChange(e.target.value, null, null)} />
      )}
    </div>
  )
}

'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'

export default function ConnectReturnPage() {
  const params = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<'checking' | 'success' | 'incomplete'>('checking')

  useEffect(() => {
    const driverId = params.get('driver_id')
    if (!driverId) { router.push('/driver/dashboard'); return }

    fetch('/api/stripe/connect/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
    })
      .then(r => r.json())
      .then(d => setStatus(d.onboarded ? 'success' : 'incomplete'))
  }, [])

  return (
    <div>
      <Nav />
      <div className="max-w-lg mx-auto px-4 pt-24 pb-12 text-center">
        {status === 'checking' && (
          <div>
            <div className="text-5xl mb-4">⏳</div>
            <h1 className="text-2xl font-black mb-2">Checking your account…</h1>
          </div>
        )}
        {status === 'success' && (
          <div>
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-black mb-2">You're all set!</h1>
            <p className="text-slate-500 mb-6">Your bank account is connected. You'll be paid automatically after each delivery.</p>
            <button onClick={() => router.push('/driver/dashboard')} className="btn-primary">
              Go to dashboard →
            </button>
          </div>
        )}
        {status === 'incomplete' && (
          <div>
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-2xl font-black mb-2">Setup incomplete</h1>
            <p className="text-slate-500 mb-6">Stripe needs a bit more information to verify your account.</p>
            <button onClick={() => router.push('/driver/onboard')} className="btn-primary">
              Complete setup →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

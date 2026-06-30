'use client'
export const dynamic = 'force-dynamic'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'

function ConnectReturnContent() {
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
    <div className="max-w-lg mx-auto px-4 pt-24 pb-12 text-center">
      {status === 'checking' && (
        <div>
          <div className="text-5xl mb-4">&#x23F3;</div>
          <h1 className="text-2xl font-black mb-2">Checking your account…</h1>
        </div>
      )}
      {status === 'success' && (
        <div>
          <div className="text-5xl mb-4">&#x1F389;</div>
          <h1 className="text-2xl font-black mb-2">You’re all set!</h1>
          <p className="text-slate-500 mb-6">Your bank account is connected. You’ll be paid automatically after each delivery.</p>
          <button onClick={() => router.push('/driver/dashboard')} className="btn-primary">Go to dashboard →</button>
        </div>
      )}
      {status === 'incomplete' && (
        <div>
          <div className="text-5xl mb-4">&#x26A0;&#xFE0F;</div>
          <h1 className="text-2xl font-black mb-2">Setup incomplete</h1>
          <p className="text-slate-500 mb-6">Stripe needs a bit more information to verify your account.</p>
          <button onClick={() => router.push('/driver/onboard')} className="btn-primary">Complete setup →</button>
        </div>
      )}
    </div>
  )
}

export default function ConnectReturnPage() {
  return (
    <div>
      <Nav />
      <Suspense fallback={<div className="max-w-lg mx-auto px-4 pt-24 text-center"><div className="text-5xl mb-4">&#x23F3;</div></div>}>
        <ConnectReturnContent />
      </Suspense>
    </div>
  )
}

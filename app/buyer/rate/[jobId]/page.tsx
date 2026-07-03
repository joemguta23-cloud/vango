'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function RateJobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // A rating of 0 = the buyer chose to Skip. Comment is always optional.
  const submit = async (stars: number, note: string) => {
    setSaving(true)
    if (stars > 0) {
      await supabase.from('jobs').update({
        rating: stars,
        rating_comment: note.trim() || null,
        rated_at: new Date().toISOString(),
      }).eq('id', jobId)
      // drivers.rating updates itself via the refresh_driver_rating trigger.
    }
    setSaving(false)
    setDone(true)
    setTimeout(() => router.push('/'), 1600)
  }

  if (done) return (
    <div>
      <Nav />
      <div className="max-w-md mx-auto px-4 pt-28 text-center">
        <div className="text-5xl mb-4">🙏</div>
        <h1 className="text-2xl font-black">Thanks for your feedback!</h1>
        <p className="text-slate-500 mt-2">It helps keep VanGo drivers great.</p>
      </div>
    </div>
  )

  return (
    <div>
      <Nav />
      <div className="max-w-md mx-auto px-4 pt-24 pb-12">
        <h1 className="text-2xl font-black mb-1">Rate your delivery</h1>
        <p className="text-slate-500 text-sm mb-6">How was your VanGo experience? A comment is optional.</p>

        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button"
              onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
              className={`text-5xl leading-none transition-transform hover:scale-110 ${(hover || rating) >= n ? 'text-yellow-400' : 'text-slate-300'}`}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}>★</button>
          ))}
        </div>

        <textarea className="input min-h-[100px] mb-4" placeholder="Add a comment (optional)…"
          value={comment} onChange={e => setComment(e.target.value)} />

        <button type="button" disabled={saving || rating === 0}
          onClick={() => submit(rating, comment)}
          className="btn-primary w-full justify-center py-3 text-base disabled:opacity-50">
          {saving ? 'Submitting…' : 'Submit rating'}
        </button>
        <button type="button" onClick={() => submit(0, '')} disabled={saving}
          className="w-full text-sm text-slate-500 font-semibold py-3 hover:text-slate-700">
          Skip
        </button>
      </div>
    </div>
  )
}

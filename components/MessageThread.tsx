'use client'
import { useEffect, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Reusable buyer <-> driver chat panel for a single job. Both the buyer
// tracking page and the driver active-job page open this in a modal.
// Access control is enforced by the job_messages RLS policies -- only the
// job's buyer or assigned driver can read/send. Includes Block + Report
// for user safety (records to chat_safety_actions for VanGo review).
//
// Latency design (feels instant, no manual refresh needed):
//  - Sending appends the message to the local list immediately (optimistic),
//    so the sender sees it the moment they hit Send.
//  - Incoming messages arrive via a realtime subscription AND a short 2s
//    poll fallback, so the other side shows up within ~2s even if the
//    websocket is slow or drops. fetchMessages replaces the full list, so
//    the optimistic copy reconciles with the server row (deduped by id).
export default function MessageThread({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const supabase = createSupabaseBrowserClient()
  const [messages, setMessages] = useState<any[]>([])
  const [body, setBody] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('job_messages')
      .select('*, sender:profiles(full_name)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
    if (data) {
      // Merge: keep any optimistic messages not yet returned by the server,
      // so a just-sent message never flickers out between poll cycles.
      setMessages(prev => {
        const serverIds = new Set(data.map((m: any) => m.id))
        const pendingLocal = prev.filter((m: any) => m.__optimistic && !serverIds.has(m.id))
        return [...data, ...pendingLocal]
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchMessages()
    const channel = supabase
      .channel(`job-messages-${jobId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_messages', filter: `job_id=eq.${jobId}` }, fetchMessages)
      .subscribe()
    // Poll fallback so incoming messages appear within ~2s even if the
    // realtime websocket is slow or silently drops.
    const poll = setInterval(fetchMessages, 2000)
    return () => { supabase.removeChannel(channel); clearInterval(poll) }
  }, [jobId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // The other participant (most recent message not sent by me).
  const otherUserId: string | null = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id && messages[i].sender_id !== userId) return messages[i].sender_id
    }
    return null
  })()

  const send = async () => {
    const text = body.trim()
    if (!text || !userId || sending || blocked) return
    setSending(true)
    setBody('')
    // Optimistic: show the message instantly with a temporary id.
    const tempId = `temp-${Date.now()}`
    const optimistic = { id: tempId, job_id: jobId, sender_id: userId, body: text, created_at: new Date().toISOString(), __optimistic: true }
    setMessages(prev => [...prev, optimistic])
    const { data, error } = await supabase
      .from('job_messages')
      .insert({ job_id: jobId, sender_id: userId, body: text })
      .select('*, sender:profiles(full_name)')
      .single()
    if (error) {
      // Roll back the optimistic message and restore the text so nothing is lost.
      setMessages(prev => prev.filter(m => m.id !== tempId))
      setBody(text)
    } else if (data) {
      // Swap the temp message for the real row (deduped by id).
      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempId && m.id !== data.id)
        return [...withoutTemp, data]
      })
    }
    setSending(false)
  }

  const reportMessage = async (m: any) => {
    if (!userId) return
    const reason = window.prompt('Report this message to Vanute. Briefly, what is wrong? (optional)')
    if (reason === null) return // cancelled
    await supabase.from('chat_safety_actions').insert({
      job_id: jobId, actor_id: userId, target_user_id: m.sender_id, message_id: m.__optimistic ? null : m.id, action_type: 'report', note: reason || null,
    })
    window.alert('Thanks -- this message has been reported to Vanute for review.')
  }

  const blockUser = async () => {
    if (!userId || !otherUserId) return
    if (!window.confirm('Block this user? You will not see their messages and they cannot be contacted here.')) return
    await supabase.from('chat_safety_actions').insert({
      job_id: jobId, actor_id: userId, target_user_id: otherUserId, action_type: 'block',
    })
    setBlocked(true)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-bold text-slate-800">💬 Messages</h2>
          <div className="flex items-center gap-3">
            {otherUserId && !blocked && (
              <button onClick={blockUser} className="text-xs font-semibold text-red-500 hover:text-red-600">Block</button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none w-8 h-8 flex items-center justify-center">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[240px]">
          {loading && <p className="text-sm text-slate-400 text-center py-8">Loading...</p>}
          {!loading && messages.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No messages yet -- say hi!</p>
          )}
          {blocked && (
            <p className="text-sm text-slate-500 text-center py-6 bg-slate-50 rounded-xl">You have blocked this user. Vanute has been notified. Close this chat to continue.</p>
          )}
          {!blocked && messages.map(m => (
            <div key={m.id} className={`flex ${m.sender_id === userId ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[75%]">
                <div className={`rounded-2xl px-3.5 py-2 text-sm ${m.sender_id === userId ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {m.sender_id !== userId && (
                    <div className="text-[10px] font-bold opacity-70 mb-0.5">{m.sender?.full_name || 'them'}</div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${m.sender_id === userId ? 'text-orange-100' : 'text-slate-400'}`}>
                    {new Date(m.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                    {m.__optimistic && m.sender_id === userId && <span>· sending…</span>}
                  </div>
                </div>
                {m.sender_id !== userId && (
                  <button onClick={() => reportMessage(m)} className="text-[10px] text-slate-400 hover:text-red-500 mt-0.5 ml-1">⚑ Report</button>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-slate-100 flex-shrink-0">
          <input
            className="input flex-1"
            placeholder={blocked ? 'You blocked this user' : 'Type a message...'}
            value={body}
            onChange={e => setBody(e.target.value)}
            disabled={blocked}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          />
          <button onClick={send} disabled={sending || !body.trim() || blocked} className="btn-primary px-4 disabled:opacity-50">
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

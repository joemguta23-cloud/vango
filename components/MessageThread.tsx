'use client'
import { useEffect, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// Reusable buyer <-> driver chat panel for a single job. Both the buyer
// tracking page and the driver active-job page open this in a modal.
// Access control is enforced entirely by the job_messages RLS policies
// (migration_003) -- only the job's buyer or assigned driver can read/send.
export default function MessageThread({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const supabase = createSupabaseBrowserClient()
  const [messages, setMessages] = useState<any[]>([])
  const [body, setBody] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
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
    setMessages(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    fetchMessages()
    const channel = supabase
      .channel(`job-messages-${jobId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_messages', filter: `job_id=eq.${jobId}` }, fetchMessages)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [jobId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const send = async () => {
    const text = body.trim()
    if (!text || !userId || sending) return
    setSending(true)
    setBody('')
    const { error } = await supabase.from('job_messages').insert({ job_id: jobId, sender_id: userId, body: text })
    if (error) setBody(text) // put it back so nothing is silently lost
    setSending(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-bold text-slate-800">💬 Messages</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none w-8 h-8 flex items-center justify-center">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[240px]">
          {loading && <p className="text-sm text-slate-400 text-center py-8">Loading...</p>}
          {!loading && messages.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No messages yet -- say hi!</p>
          )}
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.sender_id === userId ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.sender_id === userId ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {m.sender_id !== userId && (
                  <div className="text-[10px] font-bold opacity-70 mb-0.5">{m.sender?.full_name || 'them'}</div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className={`text-[10px] mt-0.5 ${m.sender_id === userId ? 'text-orange-100' : 'text-slate-400'}`}>
                  {new Date(m.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-slate-100 flex-shrink-0">
          <input
            className="input flex-1"
            placeholder="Type a message..."
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          />
          <button onClick={send} disabled={sending || !body.trim()} className="btn-primary px-4 disabled:opacity-50">
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

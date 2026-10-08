'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';

export default function FeedbackWidget({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'ISSUE' | 'FEEDBACK' | 'FEATURE'>('FEEDBACK');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [ease, setEase] = useState(8);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('trade-police:feedback-open', show);
    return () => window.removeEventListener('trade-police:feedback-open', show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? []);
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  async function send() {
    if (busy) return;
    if (!message.trim()) { setStatus('Write a message first.'); return; }
    setBusy(true);
    try {
      const { error } = await createClient().from('beta_feedback').insert({ user_id: userId, feedback_type: type, title: title.trim() || null, priority, page_path: window.location.pathname, browser: navigator.userAgent, message: message.trim(), ease_score: ease });
      if (error) { setStatus(error.message); return; }
      setStatus('Thank you — a ticket was created for the Trade Police team.');
      setTitle(''); setMessage('');
    } catch {
      setStatus('Unable to send feedback. Please try again.');
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" className="feedback-fab" aria-label="Send feedback or report an issue" aria-haspopup="dialog" onClick={() => setOpen(true)}>Feedback</button>
    {open && createPortal(
      <div className="modal-backdrop feedback-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div ref={dialog} className="card modal-card feedback-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <div className="modal-head"><h2 id={titleId}>Create beta feedback ticket</h2><button type="button" aria-label="Close feedback" onClick={() => setOpen(false)}>×</button></div>
          <label>Type<select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="ISSUE">Report issue</option><option value="FEEDBACK">Send feedback</option><option value="FEATURE">Suggest feature</option></select></label>
          <label>Short title<input value={title} onChange={event => setTitle(event.target.value)} placeholder="What needs attention?" /></label>
          <label>Priority<select value={priority} onChange={event => setPriority(event.target.value as typeof priority)}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
          <label>Message<textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="What happened, what did you expect, and what would improve it?" /></label>
          <label>Ease of use: {ease}/10<input type="range" min="1" max="10" value={ease} onChange={event => setEase(Number(event.target.value))} /></label>
          <div role="status" aria-live="polite">{status && <p className="muted">{status}</p>}</div>
          <div className="button-row"><button type="button" onClick={() => setOpen(false)}>Close</button><button type="button" className="primary" disabled={busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Create ticket'}</button></div>
        </div>
      </div>, document.body,
    )}
  </>;
}

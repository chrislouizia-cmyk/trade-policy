'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Note = {
  id: string;
  note: string;
  staff_user_id: string | null;
  created_at: string;
};

export default function CustomerNotesPanel({
  customerId,
  initialNotes,
  canManage,
}: {
  customerId: string;
  initialNotes: Note[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy) return;
    const form = event.currentTarget;
    const note = String(new FormData(form).get('note') ?? '').trim();
    if (!note) {
      setMessage('Write a note before saving.');
      return;
    }
    setBusy(true);
    setMessage('');
    const { data, error } = await createClient().rpc('staff_customer_note_create', {
      p_customer_id: customerId,
      p_note: note,
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setNotes((current) => [data as Note, ...current]);
    form.reset();
    setMessage('Note saved.');
    router.refresh();
  }

  return (
    <section className="customer-overview-section">
      <div className="section-title">
        <h2>Internal Notes</h2>
        <small className="muted">Visible only to authorized HQ staff</small>
      </div>
      {canManage ? (
        <form onSubmit={submit} className="stack">
          <label>
            Add operational context
            <textarea name="note" maxLength={2000} required disabled={busy} />
          </label>
          <div className="button-row">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save note'}
            </button>
            {message ? <span role="status">{message}</span> : null}
          </div>
        </form>
      ) : null}
      {notes.length ? (
        <div className="customer-overview-list">
          {notes.map((item) => (
            <div key={item.id}>
              <strong>Internal note</strong>
              <small>
                {item.note} · {new Date(item.created_at).toLocaleString()}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted customer-overview-empty">No internal notes recorded.</p>
      )}
    </section>
  );
}

import { FormEvent, useState } from 'react';
import { api, ApiError } from '../lib/api';

const EMOJIS = ['🎁', '⭐', '🐱', '🚀', '💎', '🧸', '🍀', '🔥'];

export function CreateAuction() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [startPrice, setStartPrice] = useState(100);
  const [minStep, setMinStep] = useState(10);
  const [minutes, setMinutes] = useState(2);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const a = await api<{ id: number }>('/auctions', {
        method: 'POST',
        body: JSON.stringify({ title, emoji, startPrice, minStep, durationSec: Math.round(minutes * 60) }),
      });
      location.hash = `#/auction/${a.id}`;
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body.issues ?? err.message) : (err as Error).message);
    }
  }

  if (!open) {
    return (
      <button className="ghost wide" onClick={() => setOpen(true)}>
        + New auction
      </button>
    );
  }

  return (
    <form className="panel create" onSubmit={submit}>
      <div className="emoji-pick" role="radiogroup" aria-label="Icon">
        {EMOJIS.map((x) => (
          <button type="button" key={x} className={x === emoji ? 'on' : ''} onClick={() => setEmoji(x)} aria-pressed={x === emoji}>
            {x}
          </button>
        ))}
      </div>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lucky Cat #8" required maxLength={80} />
      </label>
      <div className="row3">
        <label>
          Start
          <input type="number" min={1} value={startPrice} onChange={(e) => setStartPrice(Number(e.target.value))} />
        </label>
        <label>
          Step
          <input type="number" min={1} value={minStep} onChange={(e) => setMinStep(Number(e.target.value))} />
        </label>
        <label>
          Minutes
          <input type="number" min={0.5} step={0.5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="primary">Start auction</button>
      </div>
    </form>
  );
}

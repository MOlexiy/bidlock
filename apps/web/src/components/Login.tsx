import { FormEvent, useState } from 'react';
import { api, ApiError } from '../lib/api';

const DEMO = ['alice', 'bob', 'carol', 'dave'];

export function Login(props: { onLogin: (token: string) => void; telegramError: string | null; inTelegram: boolean }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(username: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('/auth/dev', { method: 'POST', body: JSON.stringify({ username }) });
      props.onLogin(r.token);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'VALIDATION' ? '3–24 latin letters, digits or _' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void go(name.trim());
  };

  if (props.inTelegram && !props.telegramError) {
    return <div className="login"><p className="muted">Signing in with Telegram…</p></div>;
  }

  return (
    <div className="login">
      <div className="brand big">
        <span className="logo">🔨</span> bidlock
      </div>
      <p className="muted">Live auctions with concurrency-safe bids. Open two windows as different users and outbid yourself.</p>
      {props.telegramError && <p className="error">Telegram sign-in failed: {props.telegramError}</p>}
      <form onSubmit={submit} className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="username" autoFocus aria-label="Username" />
        <button className="primary" disabled={busy || !name.trim()}>Enter</button>
      </form>
      <div className="chips">
        {DEMO.map((u) => (
          <button key={u} className="chip" onClick={() => go(u)} disabled={busy}>
            {u}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <p className="hint">Dev login. Inside Telegram the MiniApp signs in with verified <code>initData</code>.</p>
    </div>
  );
}

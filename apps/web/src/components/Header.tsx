import { useState } from 'react';
import { api } from '../lib/api';
import { coins } from '../lib/clock';
import type { Wallet } from '../lib/types';

export function Header({ wallet, onLogout, onWallet }: { wallet: Wallet | null; onLogout: () => void; onWallet: (w: Wallet) => void }) {
  const [busy, setBusy] = useState(false);
  const faucet = async () => {
    setBusy(true);
    try {
      onWallet(await api<Wallet>('/me/faucet', { method: 'POST' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="header">
      <a href="#/" className="brand">
        <span className="logo">🔨</span> bidlock
      </a>
      {wallet && (
        <div className="wallet">
          <div className="money" title="Available to bid">
            <span className="label">available</span>
            <span className="value">{coins(wallet.balance)}</span>
          </div>
          <div className="money frozen" title="Held by your leading bids">
            <span className="label">frozen</span>
            <span className="value">{coins(wallet.frozen)}</span>
          </div>
          <button className="ghost small" onClick={faucet} disabled={busy} title="Dev top-up">+5k</button>
          <button className="ghost small" onClick={onLogout} title="Log out">{wallet.username} ⏏</button>
        </div>
      )}
    </header>
  );
}

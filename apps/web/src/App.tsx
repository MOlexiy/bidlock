import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api, getToken, setToken } from './lib/api';
import { connect } from './lib/socket';
import { SocketContext } from './lib/socket-context';
import { haptic, insideTelegram, tg } from './lib/telegram';
import type { OutbidEvent, Wallet } from './lib/types';
import { Header } from './components/Header';
import { Login } from './components/Login';
import { AuctionList } from './components/AuctionList';
import { AuctionPage } from './components/AuctionPage';
import { Toasts, useToasts } from './components/Toasts';

function useHashRoute() {
  const parse = () => {
    const m = location.hash.match(/^#\/auction\/(\d+)/);
    return m ? { name: 'auction' as const, id: Number(m[1]) } : { name: 'list' as const };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const [token, setTok] = useState(getToken);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);
  const route = useHashRoute();
  const toasts = useToasts();

  const login = useCallback((t: string) => {
    setToken(t);
    setTok(t);
  }, []);
  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    setWallet(null);
  }, []);

  // Inside Telegram: log in with signed initData, no username screen.
  useEffect(() => {
    const w = tg();
    if (!w?.initData) return;
    w.ready();
    w.expand();
    if (getToken()) return;
    api<{ token: string }>('/auth/telegram', { method: 'POST', body: JSON.stringify({ initData: w.initData }) })
      .then((r) => login(r.token))
      .catch((e) => setTgError(e.message));
  }, [login]);

  useEffect(() => {
    if (!token) return;
    api<Wallet>('/me').then(setWallet).catch(logout);
  }, [token, logout]);

  useEffect(() => {
    const s = connect(token);
    setSocket(s);
    s.on('auth_error', logout);
    s.on('wallet.updated', (w: { balance: number; frozen: number }) =>
      setWallet((prev) => (prev ? { ...prev, balance: w.balance, frozen: w.frozen } : prev)),
    );
    s.on('user.outbid', (e: OutbidEvent) => {
      haptic('warning');
      toasts.push({
        text: `${e.by ?? 'Someone'} outbid you on ${e.title} — ${e.amount.toLocaleString('en-US')}`,
        href: `#/auction/${e.auctionId}`,
      });
    });
    return () => {
      s.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) return <Login onLogin={login} telegramError={tgError} inTelegram={insideTelegram()} />;

  return (
    <SocketContext.Provider value={socket}>
      <div className="app">
        <Header wallet={wallet} onLogout={logout} onWallet={setWallet} />
        <main>
          {route.name === 'auction' ? (
            <AuctionPage key={route.id} id={route.id} me={wallet} />
          ) : (
            <AuctionList me={wallet} />
          )}
        </main>
        <Toasts items={toasts.items} onClose={toasts.remove} />
      </div>
    </SocketContext.Provider>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, placeBid } from '../lib/api';
import { coins, syncClock } from '../lib/clock';
import { useSocket, useSocketEvent } from '../lib/socket-context';
import { haptic } from '../lib/telegram';
import { Auction, Bid, BidEvent, newer, Wallet } from '../lib/types';
import { Countdown } from './Countdown';

const ERRORS: Record<string, string> = {
  BID_TOO_LOW: 'Someone was faster — the minimum went up.',
  INSUFFICIENT_FUNDS: 'Not enough available balance.',
  AUCTION_CLOSED: 'The auction has ended.',
};

export function AuctionPage({ id, me }: { id: number; me: Wallet | null }) {
  const socket = useSocket();
  const [auction, setAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [amount, setAmount] = useState<number>(0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extendedAt, setExtendedAt] = useState(0);

  useEffect(() => {
    api<{ auction: Auction; bids: Bid[]; serverTime: string }>(`/auctions/${id}`)
      .then((r) => {
        syncClock(r.serverTime);
        setAuction(r.auction);
        setBids(r.bids);
      })
      .catch((e) => e instanceof ApiError && e.status === 404 && setNotFound(true));
  }, [id]);

  useEffect(() => {
    if (!socket) return;
    const join = () => socket.emit('auction:join', id);
    join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
      socket.emit('auction:leave', id);
    };
  }, [socket, id]);

  useSocketEvent<BidEvent>('auction.bid', (e) => {
    if (e.auction.id !== id) return;
    setAuction((a) => newer(a ?? undefined, e.auction));
    setBids((xs) => (xs.some((b) => b.id === e.bid.id) ? xs : [e.bid, ...xs].slice(0, 30)));
    if (e.extended) setExtendedAt(Date.now());
  });
  useSocketEvent<{ auction: Auction }>('auction.finished', (e) => {
    if (e.auction.id === id) setAuction(e.auction);
  });

  // Follow the minimum bid until the user edits the amount; never let it fall below the minimum.
  useEffect(() => {
    if (!auction) return;
    setAmount((v) => (touched ? Math.max(v, auction.minNextBid) : auction.minNextBid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.minNextBid]);

  if (notFound) return <p className="muted">Auction not found. <a href="#/">Back</a></p>;
  if (!auction) return <p className="muted">Loading…</p>;

  const finished = auction.status === 'finished';
  const leading = me && auction.leader?.id === me.id;
  const extraNeeded = leading ? amount - (auction.currentPrice ?? 0) : amount;
  const canAfford = !me || extraNeeded <= me.balance;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await placeBid(id, amount);
      const res = r as { auction: Auction; bid: Bid };
      setAuction((a) => newer(a ?? undefined, res.auction));
      setBids((xs) => (xs.some((b) => b.id === res.bid.id) ? xs : [res.bid, ...xs]));
      setTouched(false);
      haptic('success');
    } catch (err) {
      haptic('error');
      if (err instanceof ApiError) {
        setError(ERRORS[err.code] ?? err.message);
        if (typeof err.body.minAmount === 'number') setAmount(err.body.minAmount);
      } else setError('Network error, try again');
    } finally {
      setBusy(false);
    }
  }

  const quick = [auction.minNextBid, auction.minNextBid + auction.minStep * 4, auction.minNextBid + auction.minStep * 9];

  return (
    <div className="auction">
      <a href="#/" className="back">← All auctions</a>
      <section className={`hero ${finished ? 'finished' : ''} ${leading ? 'leading' : ''}`}>
        <div className="hero-emoji" aria-hidden>{auction.emoji}</div>
        <h1>{auction.title}</h1>
        <div className="hero-price">
          <span key={auction.bidsCount} className="price big bump">{coins(auction.currentPrice ?? auction.startPrice)}</span>
          <span className="muted">{auction.currentPrice ? 'current bid' : 'starting price'}</span>
        </div>
        <div className="hero-meta">
          <Countdown endsAt={auction.endsAt} finished={finished} warnSec={auction.antiSnipeSec} />
          {Date.now() - extendedAt < 3000 && <span className="extended">+{auction.antiSnipeSec}s anti-snipe</span>}
        </div>
        <div className="leader">
          {finished
            ? auction.winner
              ? auction.winner.id === me?.id ? '🏆 You won this lot' : `🏆 Won by ${auction.winner.username}`
              : 'Ended without bids'
            : auction.leader
              ? leading ? '● You are leading — your funds are frozen' : `Leader: ${auction.leader.username}`
              : 'Be the first to bid'}
        </div>
      </section>

      {!finished && (
        <form className="panel bid" onSubmit={submit}>
          <div className="row">
            <input
              type="number"
              inputMode="numeric"
              min={auction.minNextBid}
              step={1}
              value={amount}
              onChange={(e) => {
                setTouched(true);
                setAmount(Number(e.target.value));
              }}
              aria-label="Bid amount"
            />
            <button className="primary" disabled={busy || amount < auction.minNextBid || !canAfford}>
              {busy ? '…' : `Bid ${coins(amount)}`}
            </button>
          </div>
          <div className="chips">
            {quick.map((q) => (
              <button type="button" key={q} className="chip" onClick={() => { setTouched(true); setAmount(q); }}>
                {coins(q)}
              </button>
            ))}
          </div>
          <p className="muted small">
            Min {coins(auction.minNextBid)} · step {coins(auction.minStep)}
            {leading && ` · raising your own bid freezes only +${coins(Math.max(0, extraNeeded))}`}
            {` · bids in the last ${auction.antiSnipeSec}s extend the timer`}
          </p>
          {!canAfford && <p className="error">Not enough available balance.</p>}
          {error && <p className="error">{error}</p>}
        </form>
      )}

      <h2>Bids <span className="count">{auction.bidsCount}</span></h2>
      <ol className="feed">
        {bids.map((b, i) => (
          <li key={b.id} className={`${i === 0 && !finished ? 'top' : ''} ${b.user.id === me?.id ? 'mine' : ''}`}>
            <span className="who">{b.user.username}{b.user.id === me?.id && ' (you)'}</span>
            <span className="amt">{coins(b.amount)}</span>
            <time className="muted small">{new Date(b.createdAt).toLocaleTimeString()}</time>
          </li>
        ))}
        {bids.length === 0 && <li className="muted">No bids yet</li>}
      </ol>
    </div>
  );
}

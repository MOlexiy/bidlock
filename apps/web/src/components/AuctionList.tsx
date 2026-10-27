import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { coins, syncClock } from '../lib/clock';
import { useSocketEvent } from '../lib/socket-context';
import { Auction, BidEvent, newer, Wallet } from '../lib/types';
import { Countdown } from './Countdown';
import { CreateAuction } from './CreateAuction';

export function AuctionList({ me }: { me: Wallet | null }) {
  const [byId, setById] = useState<Record<number, Auction>>({});
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<Record<number, number>>({});

  useEffect(() => {
    api<{ items: Auction[]; serverTime: string }>('/auctions')
      .then((r) => {
        syncClock(r.serverTime);
        setById(Object.fromEntries(r.items.map((a) => [a.id, a])));
      })
      .finally(() => setLoading(false));
  }, []);

  const upsert = (a: Auction) => setById((m) => ({ ...m, [a.id]: newer(m[a.id], a) }));
  useSocketEvent<{ auction: Auction }>('auction.created', (e) => upsert(e.auction));
  useSocketEvent<{ auction: Auction }>('auction.finished', (e) => upsert(e.auction));
  useSocketEvent<BidEvent>('auction.bid', (e) => {
    upsert(e.auction);
    setFlash((f) => ({ ...f, [e.auction.id]: Date.now() }));
  });

  const { active, finished } = useMemo(() => {
    const all = Object.values(byId);
    return {
      active: all.filter((a) => a.status === 'active').sort((a, b) => a.endsAt.localeCompare(b.endsAt)),
      finished: all.filter((a) => a.status === 'finished').sort((a, b) => b.endsAt.localeCompare(a.endsAt)).slice(0, 10),
    };
  }, [byId]);

  return (
    <>
      <CreateAuction />
      <h2>Live <span className="count">{active.length}</span></h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && active.length === 0 && <p className="muted">No live auctions. Create one above.</p>}
      <div className="grid">
        {active.map((a) => (
          <Card key={a.id} a={a} me={me} flashAt={flash[a.id]} />
        ))}
      </div>
      {finished.length > 0 && (
        <>
          <h2>Finished</h2>
          <div className="grid">
            {finished.map((a) => (
              <Card key={a.id} a={a} me={me} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Card({ a, me, flashAt }: { a: Auction; me: Wallet | null; flashAt?: number }) {
  const leading = me && a.leader?.id === me.id;
  const won = me && a.winner?.id === me.id;
  return (
    <a href={`#/auction/${a.id}`} className={`card ${a.status} ${leading ? 'leading' : ''}`}>
      <div className="card-top">
        <span className="emoji" aria-hidden>{a.emoji}</span>
        <Countdown endsAt={a.endsAt} finished={a.status === 'finished'} warnSec={a.antiSnipeSec} />
      </div>
      <div className="title">{a.title}</div>
      <div className="price-row">
        <span key={flashAt} className={`price ${flashAt ? 'bump' : ''}`}>{coins(a.currentPrice ?? a.startPrice)}</span>
        <span className="muted small">{a.currentPrice ? `${a.bidsCount} bid${a.bidsCount === 1 ? "" : "s"}` : 'start'}</span>
      </div>
      <div className="leader small">
        {a.status === 'finished'
          ? a.winner
            ? won ? '🏆 You won' : `Won by ${a.winner.username}`
            : 'No bids'
          : a.leader
            ? leading ? '● You are leading' : `Leader: ${a.leader.username}`
            : 'No bids yet'}
      </div>
    </a>
  );
}

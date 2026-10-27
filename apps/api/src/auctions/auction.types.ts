export interface AuctionRow {
  id: number;
  title: string;
  emoji: string;
  start_price: number;
  min_step: number;
  current_price: number | null;
  leader_id: number | null;
  bids_count: number;
  status: 'active' | 'finished';
  ends_at: Date;
  anti_snipe_sec: number;
  winner_id: number | null;
  created_at: Date;
}

export interface BidRow {
  id: number;
  auction_id: number;
  user_id: number;
  amount: number;
  idempotency_key: string;
  created_at: Date;
}

export const minNextBid = (a: Pick<AuctionRow, 'current_price' | 'start_price' | 'min_step'>) =>
  a.current_price === null ? a.start_price : a.current_price + a.min_step;

export function toAuctionDto(a: AuctionRow & { leader_name?: string | null; winner_name?: string | null }) {
  return {
    id: a.id,
    title: a.title,
    emoji: a.emoji,
    startPrice: a.start_price,
    minStep: a.min_step,
    currentPrice: a.current_price,
    minNextBid: minNextBid(a),
    leader: a.leader_id ? { id: a.leader_id, username: a.leader_name ?? null } : null,
    winner: a.winner_id ? { id: a.winner_id, username: a.winner_name ?? null } : null,
    bidsCount: a.bids_count,
    status: a.status,
    endsAt: a.ends_at.toISOString(),
    antiSnipeSec: a.anti_snipe_sec,
  };
}

export function toBidDto(b: BidRow & { username?: string }) {
  return {
    id: b.id,
    auctionId: b.auction_id,
    user: { id: b.user_id, username: b.username ?? null },
    amount: b.amount,
    createdAt: b.created_at.toISOString(),
  };
}

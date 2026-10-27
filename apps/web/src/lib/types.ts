export interface UserRef {
  id: number;
  username: string | null;
}

export interface Auction {
  id: number;
  title: string;
  emoji: string;
  startPrice: number;
  minStep: number;
  currentPrice: number | null;
  minNextBid: number;
  leader: UserRef | null;
  winner: UserRef | null;
  bidsCount: number;
  status: 'active' | 'finished';
  endsAt: string;
  antiSnipeSec: number;
}

export interface Bid {
  id: number;
  auctionId: number;
  user: UserRef;
  amount: number;
  createdAt: string;
}

export interface Wallet {
  id: number;
  username: string;
  balance: number;
  frozen: number;
}

export interface BidEvent {
  auction: Auction;
  bid: Bid;
  extended: boolean;
}

export interface OutbidEvent {
  userId: number;
  auctionId: number;
  title: string;
  amount: number;
  by: string | null;
}

/** Events may arrive more than once / out of order (at-least-once outbox). Keep the newest. */
export function newer(prev: Auction | undefined, next: Auction) {
  if (!prev) return next;
  if (next.status === 'finished') return next;
  if (prev.status === 'finished') return prev;
  return next.bidsCount >= prev.bidsCount ? next : prev;
}

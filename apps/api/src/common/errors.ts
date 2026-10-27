/** Domain errors. Mapped to HTTP by DomainErrorFilter; plain classes keep the core framework-free. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const Errors = {
  notFound: (what: string) => new DomainError('NOT_FOUND', `${what} not found`, 404),
  auctionClosed: () => new DomainError('AUCTION_CLOSED', 'Auction is closed', 409),
  bidTooLow: (minAmount: number) =>
    new DomainError('BID_TOO_LOW', `Bid must be at least ${minAmount}`, 409, { minAmount }),
  insufficientFunds: (needed: number, available: number) =>
    new DomainError('INSUFFICIENT_FUNDS', 'Not enough available balance', 422, { needed, available }),
  idempotencyConflict: () =>
    new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different bid', 422),
};

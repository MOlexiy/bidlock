import type { Executor } from '../db/db';

export const EVENTS_CHANNEL = 'bidlock:events';

export type EventTopic = 'auction.created' | 'auction.bid' | 'auction.finished' | 'wallet.updated' | 'user.outbid';

export interface OutboxEvent<P = Record<string, unknown>> {
  id: number;
  topic: EventTopic;
  payload: P;
}

/** Must be called with the transaction's client so the event commits atomically with the change. */
export async function enqueueEvent(c: Executor, topic: EventTopic, payload: Record<string, unknown>) {
  await c.query('INSERT INTO outbox (topic, payload) VALUES ($1, $2)', [topic, payload]);
}

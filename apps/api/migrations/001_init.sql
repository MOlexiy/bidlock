-- Money is stored as integer "coins" (BIGINT). Never floats.

CREATE TABLE users (
  id          BIGSERIAL PRIMARY KEY,
  tg_id       BIGINT UNIQUE,
  username    TEXT NOT NULL UNIQUE,
  balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0), -- available funds
  frozen      BIGINT NOT NULL DEFAULT 0 CHECK (frozen >= 0),  -- held by leading bids
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE auction_status AS ENUM ('active', 'finished');

CREATE TABLE auctions (
  id              BIGSERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  emoji           TEXT NOT NULL DEFAULT '🎁',
  start_price     BIGINT NOT NULL CHECK (start_price > 0),
  min_step        BIGINT NOT NULL CHECK (min_step > 0),
  current_price   BIGINT,
  leader_id       BIGINT REFERENCES users(id),
  bids_count      INT NOT NULL DEFAULT 0,             -- doubles as a per-auction sequence for clients
  status          auction_status NOT NULL DEFAULT 'active',
  ends_at         TIMESTAMPTZ NOT NULL,
  anti_snipe_sec  INT NOT NULL DEFAULT 30 CHECK (anti_snipe_sec >= 0),
  winner_id       BIGINT REFERENCES users(id),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((current_price IS NULL) = (leader_id IS NULL))
);
CREATE INDEX auctions_active_ends_at ON auctions (ends_at) WHERE status = 'active';

CREATE TABLE bids (
  id               BIGSERIAL PRIMARY KEY,
  auction_id       BIGINT NOT NULL REFERENCES auctions(id),
  user_id          BIGINT NOT NULL REFERENCES users(id),
  amount           BIGINT NOT NULL CHECK (amount > 0),
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bids_idempotency UNIQUE (user_id, idempotency_key)
);
CREATE INDEX bids_auction_id ON bids (auction_id, id DESC);

-- Append-only money movements: makes every balance change auditable.
CREATE TABLE ledger (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  auction_id  BIGINT REFERENCES auctions(id),
  kind        TEXT NOT NULL CHECK (kind IN ('deposit', 'freeze', 'unfreeze', 'charge')),
  amount      BIGINT NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_id ON ledger (user_id, id);

-- Transactional outbox: events are written in the same transaction as the state change,
-- then relayed to Redis pub/sub. No "committed but event lost" / "event sent but rolled back".
CREATE TABLE outbox (
  id            BIGSERIAL PRIMARY KEY,
  topic         TEXT NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

CREATE FUNCTION outbox_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbox_notify AFTER INSERT ON outbox
  FOR EACH STATEMENT EXECUTE FUNCTION outbox_notify();

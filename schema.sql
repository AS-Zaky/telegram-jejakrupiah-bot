CREATE TABLE IF NOT EXISTS transactions (
  id                BIGSERIAL PRIMARY KEY,
  telegram_user_id  BIGINT NOT NULL,
  type              VARCHAR(10) NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
  amount            NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
  category          VARCHAR(50) NOT NULL,
  note              TEXT,
  status            VARCHAR(15) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED')),
  transaction_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_user_date_idx
  ON transactions (telegram_user_id, transaction_date);

CREATE INDEX IF NOT EXISTS transactions_user_status_idx
  ON transactions (telegram_user_id, status);

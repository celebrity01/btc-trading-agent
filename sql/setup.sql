-- BTC Trading Agent - Supabase Database Setup
-- Run this SQL in your Supabase Dashboard > SQL Editor

-- Candles table (stores 30min OHLCV data from Mexc)
CREATE TABLE IF NOT EXISTS candles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  open_time BIGINT NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  close_time BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, timeframe, open_time)
);

-- Predictions table (stores each prediction with indicators and results)
CREATE TABLE IF NOT EXISTS predictions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  prediction_time TIMESTAMPTZ DEFAULT NOW(),
  target_time TIMESTAMPTZ NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('UP', 'DOWN')),
  confidence DOUBLE PRECISION NOT NULL,
  stochrsi_k DOUBLE PRECISION,
  stochrsi_d DOUBLE PRECISION,
  ma_stochrsi_k DOUBLE PRECISION,
  ma_stochrsi_d DOUBLE PRECISION,
  price_at_prediction DOUBLE PRECISION,
  indicator_params JSONB DEFAULT '{}',
  evaluated BOOLEAN DEFAULT FALSE,
  outcome TEXT CHECK (outcome IN ('WIN', 'LOSS', 'PENDING')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outcomes table (tracks actual results vs predictions)
CREATE TABLE IF NOT EXISTS outcomes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prediction_id BIGINT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  actual_direction TEXT NOT NULL CHECK (actual_direction IN ('UP', 'DOWN')),
  price_at_target DOUBLE PRECISION NOT NULL,
  price_change_pct DOUBLE PRECISION,
  result TEXT NOT NULL CHECK (result IN ('WIN', 'LOSS')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON candles(symbol, timeframe, open_time DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_time ON predictions(prediction_time DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_evaluated ON predictions(evaluated) WHERE evaluated = FALSE;
CREATE INDEX IF NOT EXISTS idx_outcomes_prediction ON outcomes(prediction_id);

-- Enable Row Level Security
ALTER TABLE candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;

-- Allow anon read access
CREATE POLICY "Allow anon read on candles" ON candles FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read on predictions" ON predictions FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read on outcomes" ON outcomes FOR SELECT TO anon USING (true);

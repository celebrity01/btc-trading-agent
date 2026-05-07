-- BTC Trading Agent - Supabase Database Setup
-- Run this SQL in your Supabase Dashboard > SQL Editor

-- Candles table (stores 30min OHLCV data from Mexc)
CREATE TABLE IF NOT EXISTS candles (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  open_time BIGINT NOT NULL,
  open DECIMAL(20,8) NOT NULL,
  high DECIMAL(20,8) NOT NULL,
  low DECIMAL(20,8) NOT NULL,
  close DECIMAL(20,8) NOT NULL,
  volume DECIMAL(20,8) NOT NULL,
  close_time BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, timeframe, open_time)
);

-- Predictions table (stores each prediction with indicators and results)
CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  prediction_time TIMESTAMPTZ DEFAULT NOW(),
  target_time TIMESTAMPTZ NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('UP', 'DOWN')),
  confidence DECIMAL(5,2) NOT NULL,
  stochrsi_k DECIMAL(10,4),
  stochrsi_d DECIMAL(10,4),
  ma_stochrsi_k DECIMAL(10,4),
  ma_stochrsi_d DECIMAL(10,4),
  price_at_prediction DECIMAL(20,8),
  indicator_params JSONB DEFAULT '{}',
  evaluated BOOLEAN DEFAULT FALSE,
  outcome TEXT CHECK (outcome IN ('WIN', 'LOSS', 'PENDING')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outcomes table (tracks actual results vs predictions)
CREATE TABLE IF NOT EXISTS outcomes (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER REFERENCES predictions(id),
  actual_direction TEXT NOT NULL CHECK (actual_direction IN ('UP', 'DOWN')),
  price_at_target DECIMAL(20,8) NOT NULL,
  price_change_pct DECIMAL(10,6),
  result TEXT NOT NULL CHECK (result IN ('WIN', 'LOSS')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Model performance table (tracks accuracy metrics over time)
CREATE TABLE IF NOT EXISTS model_performance (
  id SERIAL PRIMARY KEY,
  total_predictions INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,
  avg_confidence DECIMAL(5,2) DEFAULT 0,
  last_7d_win_rate DECIMAL(5,2) DEFAULT 0,
  last_24h_win_rate DECIMAL(5,2) DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Learning parameters table (adaptive parameters that evolve over time)
CREATE TABLE IF NOT EXISTS learning_params (
  id SERIAL PRIMARY KEY,
  rsi_period INTEGER DEFAULT 14,
  stoch_period INTEGER DEFAULT 14,
  k_smooth INTEGER DEFAULT 3,
  d_smooth INTEGER DEFAULT 3,
  ma_type TEXT DEFAULT 'SMA',
  ma_period INTEGER DEFAULT 3,
  overbought_threshold DECIMAL(5,2) DEFAULT 80,
  oversold_threshold DECIMAL(5,2) DEFAULT 20,
  confidence_weight_stochrsi DECIMAL(3,2) DEFAULT 0.60,
  confidence_weight_ma DECIMAL(3,2) DEFAULT 0.40,
  win_streak_adjustment DECIMAL(3,2) DEFAULT 0.05,
  loss_streak_adjustment DECIMAL(3,2) DEFAULT 0.03,
  total_predictions INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  performance_score DECIMAL(5,2) DEFAULT 50.00,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- Insert default learning params
INSERT INTO learning_params (rsi_period, stoch_period, k_smooth, d_smooth, ma_type, ma_period, overbought_threshold, oversold_threshold)
VALUES (14, 14, 3, 3, 'SMA', 3, 80, 20)
ON CONFLICT DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON candles(symbol, timeframe, open_time DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_time ON predictions(prediction_time DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_evaluated ON predictions(evaluated) WHERE evaluated = FALSE;
CREATE INDEX IF NOT EXISTS idx_outcomes_prediction ON outcomes(prediction_id);

-- Enable Row Level Security but allow service role full access
ALTER TABLE candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_params ENABLE ROW LEVEL SECURITY;

-- Create policies that allow anon and service_role to access all tables
CREATE POLICY "Allow anon read on candles" ON candles FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read on predictions" ON predictions FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read on outcomes" ON outcomes FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read on model_performance" ON model_performance FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read on learning_params" ON learning_params FOR SELECT TO anon USING (true);

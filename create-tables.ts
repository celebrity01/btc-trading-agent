// Create tables via Supabase REST API using service role key
const SUPABASE_URL = 'https://msajwmlhcrwyiblbkvuy.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zYWp3bWxoY3J3eWlibGJrdnV5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzk4MjMyMCwiZXhwIjoyMDkzNTU4MzIwfQ.Pji9g_k95up3xWDr4-UfIEdR6llJ_t_N436hV_s7M2g';

const SQL = `
-- Candles table
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

-- Predictions table
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

-- Outcomes table
CREATE TABLE IF NOT EXISTS outcomes (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER REFERENCES predictions(id),
  actual_direction TEXT NOT NULL CHECK (actual_direction IN ('UP', 'DOWN')),
  price_at_target DECIMAL(20,8) NOT NULL,
  price_change_pct DECIMAL(10,6),
  result TEXT NOT NULL CHECK (result IN ('WIN', 'LOSS')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Model performance table
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

-- Learning parameters table
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
VALUES (14, 14, 3, 3, 'SMA', 3, 80, 20);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON candles(symbol, timeframe, open_time DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_time ON predictions(prediction_time DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_evaluated ON predictions(evaluated) WHERE evaluated = FALSE;
CREATE INDEX IF NOT EXISTS idx_outcomes_prediction ON outcomes(prediction_id);
`;

async function createTables() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
      },
      body: JSON.stringify({ query: SQL })
    });
    
    const text = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', text);
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

createTables();

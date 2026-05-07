import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// SQL DDL for all required tables
// ---------------------------------------------------------------------------

const TABLE_SQL: Record<string, string> = {
  candles: `
CREATE TABLE IF NOT EXISTS candles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol      TEXT        NOT NULL,
  timeframe   TEXT        NOT NULL,
  open_time   BIGINT      NOT NULL,
  open        DOUBLE PRECISION NOT NULL,
  high        DOUBLE PRECISION NOT NULL,
  low         DOUBLE PRECISION NOT NULL,
  close       DOUBLE PRECISION NOT NULL,
  volume      DOUBLE PRECISION NOT NULL,
  close_time  BIGINT      NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),

  UNIQUE (symbol, timeframe, open_time)
);`,

  predictions: `
CREATE TABLE IF NOT EXISTS predictions (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol                  TEXT        NOT NULL,
  timeframe               TEXT        NOT NULL,
  prediction_time         TIMESTAMPTZ DEFAULT now(),
  target_time             TIMESTAMPTZ NOT NULL,
  direction               TEXT        NOT NULL CHECK (direction IN ('UP', 'DOWN')),
  confidence              DOUBLE PRECISION NOT NULL,
  stochrsi_k              DOUBLE PRECISION,
  stochrsi_d              DOUBLE PRECISION,
  ma_stochrsi_k           DOUBLE PRECISION,
  ma_stochrsi_d           DOUBLE PRECISION,
  price_at_prediction     DOUBLE PRECISION,
  indicator_params        JSONB,
  evaluated               BOOLEAN     NOT NULL DEFAULT false,
  outcome                 TEXT        CHECK (outcome IN ('WIN', 'LOSS', 'PENDING')),
  created_at              TIMESTAMPTZ DEFAULT now()
);`,

  outcomes: `
CREATE TABLE IF NOT EXISTS outcomes (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prediction_id     BIGINT       NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  actual_direction  TEXT         NOT NULL CHECK (actual_direction IN ('UP', 'DOWN')),
  price_at_target   DOUBLE PRECISION NOT NULL,
  price_change_pct  DOUBLE PRECISION,
  result            TEXT         NOT NULL CHECK (result IN ('WIN', 'LOSS')),
  created_at        TIMESTAMPTZ  DEFAULT now()
);`,

  learning_params: `
CREATE TABLE IF NOT EXISTS learning_params (
  id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rsi_period                  INT     NOT NULL DEFAULT 14,
  stoch_period                INT     NOT NULL DEFAULT 14,
  k_smooth                    INT     NOT NULL DEFAULT 3,
  d_smooth                    INT     NOT NULL DEFAULT 3,
  ma_type                     TEXT    NOT NULL DEFAULT 'SMA',
  ma_period                   INT     NOT NULL DEFAULT 3,
  overbought_threshold        DOUBLE PRECISION NOT NULL DEFAULT 80,
  oversold_threshold          DOUBLE PRECISION NOT NULL DEFAULT 20,
  confidence_weight_stochrsi  DOUBLE PRECISION NOT NULL DEFAULT 0.60,
  confidence_weight_ma        DOUBLE PRECISION NOT NULL DEFAULT 0.40,
  win_streak_adjustment       DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  loss_streak_adjustment      DOUBLE PRECISION NOT NULL DEFAULT 0.03,
  total_predictions            INT     NOT NULL DEFAULT 0,
  total_wins                   INT     NOT NULL DEFAULT 0,
  performance_score            DOUBLE PRECISION NOT NULL DEFAULT 50.0,
  updated_at                   TIMESTAMPTZ DEFAULT now(),
  is_active                    BOOLEAN NOT NULL DEFAULT true
);`,

  model_performance: `
CREATE TABLE IF NOT EXISTS model_performance (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  total_predictions INT     NOT NULL DEFAULT 0,
  total_wins        INT     NOT NULL DEFAULT 0,
  total_losses      INT     NOT NULL DEFAULT 0,
  win_rate          DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_confidence    DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_7d_win_rate  DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_24h_win_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  recorded_at       TIMESTAMPTZ DEFAULT now()
);`,
};

// ---------------------------------------------------------------------------
// Seed SQL for the learning_params table (insert default active params)
// ---------------------------------------------------------------------------

const SEED_SQL = `
INSERT INTO learning_params (
  rsi_period, stoch_period, k_smooth, d_smooth, ma_type, ma_period,
  overbought_threshold, oversold_threshold,
  confidence_weight_stochrsi, confidence_weight_ma,
  win_streak_adjustment, loss_streak_adjustment,
  total_predictions, total_wins, performance_score, is_active
)
SELECT 14, 14, 3, 3, 'SMA', 3, 80, 20, 0.60, 0.40, 0.05, 0.03, 0, 0, 50.0, true
WHERE NOT EXISTS (
  SELECT 1 FROM learning_params WHERE is_active = true
);
`;

// ---------------------------------------------------------------------------
// GET /api/setup-db
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = createServerClient();
    const tables: Record<string, boolean> = {};
    const missingTables: string[] = [];

    // Check each table by attempting a simple select
    for (const tableName of Object.keys(TABLE_SQL)) {
      const { error } = await supabase
        .from(tableName)
        .select('id')
        .limit(1);

      // If no error, table exists (even if empty)
      const exists = !error || !error.message.includes('does not exist');
      tables[tableName] = exists;

      if (!exists) {
        missingTables.push(tableName);
      }
    }

    const setupNeeded = missingTables.length > 0;

    // Build the SQL for missing tables only
    let sql = '';
    if (setupNeeded) {
      const ddlParts = missingTables.map((name) => TABLE_SQL[name].trim());
      ddlParts.push(SEED_SQL.trim());
      sql = ddlParts.join('\n\n');
    }

    return NextResponse.json({
      tables,
      setup_needed: setupNeeded,
      sql: sql || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[setup-db] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

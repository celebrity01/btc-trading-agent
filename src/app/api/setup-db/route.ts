import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// SQL DDL for required tables (no learning/adaptive tables)
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
};

// ---------------------------------------------------------------------------
// GET /api/setup-db
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = createServerClient();
    const tables: Record<string, boolean> = {};
    const missingTables: string[] = [];

    for (const tableName of Object.keys(TABLE_SQL)) {
      const { error } = await supabase
        .from(tableName)
        .select('id')
        .limit(1);

      const exists = !error || !error.message.includes('does not exist');
      tables[tableName] = exists;

      if (!exists) {
        missingTables.push(tableName);
      }
    }

    const setupNeeded = missingTables.length > 0;

    let sql = '';
    if (setupNeeded) {
      const ddlParts = missingTables.map((name) => TABLE_SQL[name].trim());
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

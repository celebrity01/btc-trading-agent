import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchKlines, fetchLatestPrice } from '@/lib/mexc';
import { generatePrediction } from '@/lib/prediction/engine';
import { getActiveLearningParams } from '@/lib/learning/optimizer';
import type { Candle, Prediction } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// CRON_SECRET guard – allows all requests when the env var is not set
// ---------------------------------------------------------------------------

function verifyCronSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // dev mode – allow all

  const fromHeader = request.headers.get('x-cron-secret') ?? request.headers.get('authorization');
  const fromQuery = request.nextUrl.searchParams.get('cron_secret');

  if (fromHeader !== secret && fromQuery !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

// ---------------------------------------------------------------------------
// GET /api/cron/fetch-and-predict
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Auth guard
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const SYMBOL = 'BTCUSDT';
  const TIMEFRAME = '30m';
  const CANDLE_LIMIT = 100;

  try {
    // ------------------------------------------------------------------
    // 1. Fetch latest 100 candles from Mexc
    // ------------------------------------------------------------------
    const candles: Candle[] = await fetchKlines(SYMBOL, TIMEFRAME, CANDLE_LIMIT);

    if (!candles || candles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No candles returned from Mexc' },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------------
    // 2. Upsert candles into Supabase (unique on symbol + timeframe + open_time)
    // ------------------------------------------------------------------
    const supabase = createServerClient();

    const { error: upsertError } = await supabase.from('candles').upsert(
      candles.map((c) => ({
        symbol: c.symbol,
        timeframe: c.timeframe,
        open_time: c.open_time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        close_time: c.close_time,
      })),
      { onConflict: 'symbol,timeframe,open_time' }
    );

    if (upsertError) {
      console.error('[fetch-and-predict] Candle upsert error:', upsertError.message);
      // Non-fatal – continue with prediction using the data we have
    }

    // ------------------------------------------------------------------
    // 3. Get current active learning params
    // ------------------------------------------------------------------
    const params = await getActiveLearningParams();

    // ------------------------------------------------------------------
    // 4. Extract closing prices from candles (already sorted by Mexc)
    // ------------------------------------------------------------------
    const closes = candles.map((c) => c.close);

    // ------------------------------------------------------------------
    // 5. Fetch current BTC price
    // ------------------------------------------------------------------
    const { price: currentPrice } = await fetchLatestPrice(SYMBOL);

    // ------------------------------------------------------------------
    // 6. Generate prediction using the prediction engine
    // ------------------------------------------------------------------
    const predictionResult = generatePrediction({
      closes,
      currentPrice,
      symbol: SYMBOL,
      timeframe: TIMEFRAME,
      params,
    });

    // ------------------------------------------------------------------
    // 7. Save the prediction to Supabase
    // ------------------------------------------------------------------
    const targetTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes from now

    const predictionRow: Omit<Prediction, 'id' | 'created_at'> = {
      symbol: SYMBOL,
      timeframe: TIMEFRAME,
      target_time: targetTime,
      direction: predictionResult.direction,
      confidence: predictionResult.confidence,
      stochrsi_k: predictionResult.stochrsi_k,
      stochrsi_d: predictionResult.stochrsi_d,
      ma_stochrsi_k: predictionResult.ma_stochrsi_k,
      ma_stochrsi_d: predictionResult.ma_stochrsi_d,
      price_at_prediction: currentPrice,
      indicator_params: predictionResult.indicator_params,
      evaluated: false,
      outcome: 'PENDING',
    };

    const { data: insertedPrediction, error: insertError } = await supabase
      .from('predictions')
      .insert(predictionRow)
      .select()
      .single();

    if (insertError) {
      console.error('[fetch-and-predict] Prediction insert error:', insertError.message);
      return NextResponse.json(
        { success: false, error: `Failed to save prediction: ${insertError.message}` },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------------
    // 8. Return the prediction as JSON
    // ------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      prediction: {
        direction: predictionResult.direction,
        confidence: predictionResult.confidence,
        stochrsi_k: predictionResult.stochrsi_k,
        stochrsi_d: predictionResult.stochrsi_d,
        ma_stochrsi_k: predictionResult.ma_stochrsi_k,
        ma_stochrsi_d: predictionResult.ma_stochrsi_d,
        signals: predictionResult.signals,
        indicator_params: predictionResult.indicator_params,
        id: insertedPrediction?.id ?? null,
      },
      price: currentPrice,
      candles_fetched: candles.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[fetch-and-predict] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

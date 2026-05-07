import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchLatestPrice, fetch24hrTicker } from '@/lib/mexc';
import { getActiveLearningParams, getPerformanceStats } from '@/lib/learning/optimizer';
import type { Prediction } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = createServerClient();

    // Run independent requests in parallel for faster response
    const [priceResult, tickerResult, learningParams, performance, latestPredictionResult] =
      await Promise.allSettled([
        fetchLatestPrice('BTCUSDT'),
        fetch24hrTicker('BTCUSDT'),
        getActiveLearningParams(),
        getPerformanceStats(),
        supabase
          .from('predictions')
          .select('*')
          .order('prediction_time', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    // Extract price
    const price = priceResult.status === 'fulfilled' ? priceResult.value.price : null;

    // Extract 24h price change percentage
    const priceChange24h =
      tickerResult.status === 'fulfilled' ? tickerResult.value.priceChangePercent : null;

    // Extract learning params (always resolves – falls back to defaults)
    const learningParamsValue =
      learningParams.status === 'fulfilled'
        ? learningParams.value
        : null;

    // Extract performance stats (always resolves – falls back to defaults)
    const performanceValue =
      performance.status === 'fulfilled' ? performance.value : null;

    // Extract latest prediction
    let latestPrediction: Prediction | null = null;
    if (latestPredictionResult.status === 'fulfilled') {
      const { data, error } = latestPredictionResult.value;
      if (!error && data) {
        latestPrediction = data as Prediction;
      }
    }

    return NextResponse.json({
      price,
      priceChange24h,
      learning_params: learningParamsValue,
      performance: performanceValue,
      latest_prediction: latestPrediction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[status] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

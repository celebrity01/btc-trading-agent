import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchLatestPrice, fetch24hrTicker } from '@/lib/mexc';
import type { Prediction } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = createServerClient();

    // Run independent requests in parallel
    const [priceResult, tickerResult, latestPredictionResult, evaluatedResult, recentResult] =
      await Promise.allSettled([
        fetchLatestPrice('BTCUSDT'),
        fetch24hrTicker('BTCUSDT'),
        supabase
          .from('predictions')
          .select('*')
          .order('prediction_time', { ascending: false })
          .limit(1)
          .maybeSingle(),
        // All evaluated predictions for overall stats
        supabase
          .from('predictions')
          .select('id, confidence, outcome')
          .eq('evaluated', true),
        // Last 24h evaluated predictions for recent stats
        supabase
          .from('predictions')
          .select('id, outcome')
          .eq('evaluated', true)
          .gte('prediction_time', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      ]);

    // Extract price
    const price = priceResult.status === 'fulfilled' ? priceResult.value.price : null;

    // Extract 24h price change
    const priceChange24h =
      tickerResult.status === 'fulfilled' ? tickerResult.value.priceChangePercent : null;

    // Extract latest prediction
    let latestPrediction: Prediction | null = null;
    if (latestPredictionResult.status === 'fulfilled') {
      const { data, error } = latestPredictionResult.value;
      if (!error && data) {
        latestPrediction = data as Prediction;
      }
    }

    // Compute performance stats directly from predictions
    let performance = null;
    if (evaluatedResult.status === 'fulfilled' && evaluatedResult.value.data) {
      const evaluated = evaluatedResult.value.data;
      const wins = evaluated.filter((p: any) => p.outcome === 'WIN').length;
      const losses = evaluated.filter((p: any) => p.outcome === 'LOSS').length;
      const total = evaluated.length;
      const avgConfidence = total > 0
        ? evaluated.reduce((sum: number, p: any) => sum + (p.confidence || 0), 0) / total / 100
        : 0;

      // Recent (24h) win rate
      let recentWinRate = 0;
      if (recentResult.status === 'fulfilled' && recentResult.value.data) {
        const recent = recentResult.value.data;
        const recentWins = recent.filter((p: any) => p.outcome === 'WIN').length;
        const recentTotal = recent.length;
        recentWinRate = recentTotal > 0 ? recentWins / recentTotal : 0;
      }

      // Calculate streak
      let streak = 0;
      // Get last 50 evaluated predictions ordered by time desc to compute streak
      const { data: streakData } = await supabase
        .from('predictions')
        .select('outcome')
        .eq('evaluated', true)
        .order('prediction_time', { ascending: false })
        .limit(50);

      if (streakData && streakData.length > 0) {
        const firstOutcome = streakData[0].outcome;
        if (firstOutcome === 'WIN' || firstOutcome === 'LOSS') {
          streak = firstOutcome === 'WIN' ? 1 : -1;
          for (let i = 1; i < streakData.length; i++) {
            if (streakData[i].outcome === firstOutcome) {
              streak += firstOutcome === 'WIN' ? 1 : -1;
            } else {
              break;
            }
          }
        }
      }

      performance = {
        total,
        wins,
        losses,
        winRate: total > 0 ? wins / total : 0,
        avgConfidence,
        recentWinRate,
        streak,
      };
    }

    return NextResponse.json({
      price,
      priceChange24h,
      performance,
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

import { NextRequest, NextResponse } from 'next/server';
import {
  evaluatePastPredictions,
  optimizeParameters,
  recordModelPerformance,
} from '@/lib/learning/optimizer';

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
// GET /api/cron/evaluate
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Auth guard
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    // ------------------------------------------------------------------
    // 1. Evaluate past predictions against actual outcomes
    // ------------------------------------------------------------------
    const evaluation = await evaluatePastPredictions();

    // ------------------------------------------------------------------
    // 2. Optimize parameters based on evaluation results
    // ------------------------------------------------------------------
    const newParams = await optimizeParameters();

    // Determine if params were actually updated (check if new params differ)
    const optimization = {
      updated: true,
      new_params: {
        rsi_period: newParams.rsi_period,
        stoch_period: newParams.stoch_period,
        k_smooth: newParams.k_smooth,
        d_smooth: newParams.d_smooth,
        ma_type: newParams.ma_type,
        ma_period: newParams.ma_period,
        overbought_threshold: newParams.overbought_threshold,
        oversold_threshold: newParams.oversold_threshold,
        confidence_weight_stochrsi: newParams.confidence_weight_stochrsi,
        confidence_weight_ma: newParams.confidence_weight_ma,
        performance_score: newParams.performance_score,
      },
    };

    // ------------------------------------------------------------------
    // 3. Record a performance snapshot
    // ------------------------------------------------------------------
    await recordModelPerformance();

    // ------------------------------------------------------------------
    // 4. Return results
    // ------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      evaluated: {
        evaluated: evaluation.evaluated,
        wins: evaluation.wins,
        losses: evaluation.losses,
      },
      optimization,
      performance_recorded: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[evaluate] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { fetchLatestPrice } from '@/lib/mexc';

// ---------------------------------------------------------------------------
// CRON_SECRET guard
// ---------------------------------------------------------------------------

function verifyCronSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;

  const fromHeader = request.headers.get('x-cron-secret') ?? request.headers.get('authorization');
  const fromQuery = request.nextUrl.searchParams.get('cron_secret');

  if (fromHeader !== secret && fromQuery !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

// ---------------------------------------------------------------------------
// GET /api/cron/evaluate
// Evaluates past predictions whose target_time has passed but haven't been
// evaluated yet. Compares predicted direction against actual price movement.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    const supabase = createServerClient();
    const now = new Date().toISOString();

    // ------------------------------------------------------------------
    // 1. Find unevaluated predictions whose target_time has passed
    // ------------------------------------------------------------------
    const { data: pendingPredictions, error: fetchError } = await supabase
      .from('predictions')
      .select('id, symbol, direction, target_time, price_at_prediction')
      .eq('evaluated', false)
      .lt('target_time', now)
      .order('target_time', { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error('[evaluate] Fetch error:', fetchError.message);
      return NextResponse.json(
        { success: false, error: fetchError.message },
        { status: 500 }
      );
    }

    if (!pendingPredictions || pendingPredictions.length === 0) {
      return NextResponse.json({
        success: true,
        evaluated: 0,
        wins: 0,
        losses: 0,
      });
    }

    // ------------------------------------------------------------------
    // 2. Evaluate each prediction
    // ------------------------------------------------------------------
    let wins = 0;
    let losses = 0;
    const evaluatedIds: number[] = [];

    for (const pred of pendingPredictions) {
      // Get the current price for this symbol to determine actual direction
      try {
        const { price: currentPrice } = await fetchLatestPrice(pred.symbol);

        // Determine actual direction: if price went up from prediction time → UP
        const actualDirection = currentPrice >= (pred.price_at_prediction ?? currentPrice) ? 'UP' : 'DOWN';
        const result = actualDirection === pred.direction ? 'WIN' : 'LOSS';
        const priceChangePct = pred.price_at_prediction
          ? ((currentPrice - pred.price_at_prediction) / pred.price_at_prediction) * 100
          : 0;

        if (result === 'WIN') wins++;
        else losses++;

        // Insert outcome record
        await supabase.from('outcomes').insert({
          prediction_id: pred.id,
          actual_direction: actualDirection,
          price_at_target: currentPrice,
          price_change_pct: priceChangePct,
          result,
        });

        // Update the prediction record
        await supabase
          .from('predictions')
          .update({
            evaluated: true,
            outcome: result,
          })
          .eq('id', pred.id);

        evaluatedIds.push(pred.id);
      } catch (priceError) {
        console.error(`[evaluate] Price fetch failed for prediction ${pred.id}:`, priceError);
        // Skip this prediction, try again next time
      }
    }

    return NextResponse.json({
      success: true,
      evaluated: evaluatedIds.length,
      wins,
      losses,
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

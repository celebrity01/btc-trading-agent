import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { Prediction } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// GET /api/predictions
// Query params: limit (default 50), offset (default 0)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10), 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

    const supabase = createServerClient();

    // Fetch total count for pagination
    const { count, error: countError } = await supabase
      .from('predictions')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('[predictions] Count error:', countError.message);
      return NextResponse.json(
        { success: false, error: countError.message },
        { status: 500 }
      );
    }

    // Fetch predictions ordered by prediction_time DESC, including outcome data
    const { data: predictions, error: fetchError } = await supabase
      .from('predictions')
      .select(`
        *,
        outcomes (
          id,
          actual_direction,
          price_at_target,
          price_change_pct,
          result,
          created_at
        )
      `)
      .order('prediction_time', { ascending: false })
      .range(offset, offset + limit - 1);

    if (fetchError) {
      console.error('[predictions] Fetch error:', fetchError.message);
      return NextResponse.json(
        { success: false, error: fetchError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      predictions: (predictions ?? []) as (Prediction & {
        outcomes: {
          id: number;
          actual_direction: 'UP' | 'DOWN';
          price_at_target: number;
          price_change_pct: number;
          result: 'WIN' | 'LOSS';
          created_at: string;
        } | null;
      })[],
      total: count ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[predictions] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

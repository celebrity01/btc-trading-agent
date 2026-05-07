import { createServerClient } from '../supabase';
import type { LearningParams, Prediction, Outcome } from '../supabase';

// ---------------------------------------------------------------------------
// Default learning parameters (mirrors the SQL seed insert)
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS: Omit<LearningParams, 'id' | 'updated_at'> = {
  rsi_period: 14,
  stoch_period: 14,
  k_smooth: 3,
  d_smooth: 3,
  ma_type: 'SMA',
  ma_period: 3,
  overbought_threshold: 80,
  oversold_threshold: 20,
  confidence_weight_stochrsi: 0.60,
  confidence_weight_ma: 0.40,
  win_streak_adjustment: 0.05,
  loss_streak_adjustment: 0.03,
  total_predictions: 0,
  total_wins: 0,
  performance_score: 50.0,
  is_active: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Small random perturbation in [-delta, +delta] */
function jitter(value: number, delta: number): number {
  return value + (Math.random() * 2 - 1) * delta;
}

// ---------------------------------------------------------------------------
// 1. getActiveLearningParams
// ---------------------------------------------------------------------------

export async function getActiveLearningParams(): Promise<LearningParams> {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('learning_params')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[optimizer] Failed to fetch active learning params:', error.message);
      return { ...DEFAULT_PARAMS } as LearningParams;
    }

    if (!data) {
      return { ...DEFAULT_PARAMS } as LearningParams;
    }

    return data as LearningParams;
  } catch (err) {
    console.error('[optimizer] getActiveLearningParams error:', err);
    return { ...DEFAULT_PARAMS } as LearningParams;
  }
}

// ---------------------------------------------------------------------------
// 2. evaluatePastPredictions
// ---------------------------------------------------------------------------

export async function evaluatePastPredictions(): Promise<{
  evaluated: number;
  wins: number;
  losses: number;
}> {
  const result = { evaluated: 0, wins: 0, losses: 0 };

  try {
    const supabase = createServerClient();
    const now = new Date().toISOString();

    // Fetch unevaluated predictions whose target_time has passed
    const { data: predictions, error: predErr } = await supabase
      .from('predictions')
      .select('*')
      .eq('evaluated', false)
      .lt('target_time', now);

    if (predErr) {
      console.error('[optimizer] Failed to fetch unevaluated predictions:', predErr.message);
      return result;
    }

    if (!predictions || predictions.length === 0) {
      return result;
    }

    for (const pred of predictions as Prediction[]) {
      try {
        // Find the candle that covers the target_time
        const targetTs = Math.floor(new Date(pred.target_time).getTime() / 1000);

        const { data: candles, error: candleErr } = await supabase
          .from('candles')
          .select('*')
          .eq('symbol', pred.symbol)
          .eq('timeframe', pred.timeframe)
          .lte('open_time', targetTs)
          .gt('close_time', targetTs)
          .limit(1)
          .maybeSingle();

        if (candleErr || !candles) {
          // If we cannot find a matching candle, skip this prediction
          console.warn(
            `[optimizer] No candle found for prediction ${pred.id} at target_time ${pred.target_time}`
          );
          continue;
        }

        const candle = candles;
        const actualDirection: 'UP' | 'DOWN' = candle.close > candle.open ? 'UP' : 'DOWN';
        const isWin = pred.direction === actualDirection;
        const priceChangePct =
          candle.open !== 0 ? ((candle.close - candle.open) / candle.open) * 100 : 0;

        // Record outcome
        const outcome: Omit<Outcome, 'id' | 'created_at'> = {
          prediction_id: pred.id!,
          actual_direction: actualDirection,
          price_at_target: candle.close,
          price_change_pct: Math.round(priceChangePct * 100) / 100,
          result: isWin ? 'WIN' : 'LOSS',
        };

        const { error: outcomeErr } = await supabase.from('outcomes').insert(outcome);
        if (outcomeErr) {
          console.error(
            `[optimizer] Failed to insert outcome for prediction ${pred.id}:`,
            outcomeErr.message
          );
          continue;
        }

        // Update prediction as evaluated
        const { error: updateErr } = await supabase
          .from('predictions')
          .update({
            evaluated: true,
            outcome: isWin ? 'WIN' : 'LOSS',
          })
          .eq('id', pred.id);

        if (updateErr) {
          console.error(
            `[optimizer] Failed to update prediction ${pred.id}:`,
            updateErr.message
          );
          continue;
        }

        result.evaluated++;
        if (isWin) result.wins++;
        else result.losses++;
      } catch (innerErr) {
        console.error(`[optimizer] Error evaluating prediction ${pred.id}:`, innerErr);
      }
    }
  } catch (err) {
    console.error('[optimizer] evaluatePastPredictions error:', err);
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. optimizeParameters
// ---------------------------------------------------------------------------

interface ParameterGroup {
  wins: number;
  losses: number;
  params: Record<string, number | string>;
}

function groupOutcomesByParams(outcomes: Outcome[], predictions: Prediction[]): ParameterGroup[] {
  const groups: Map<string, ParameterGroup> = new Map();

  for (const outcome of outcomes) {
    const pred = predictions.find((p) => p.id === outcome.prediction_id);
    if (!pred?.indicator_params) continue;

    // Create a stable key from the indicator params (sorted)
    const key = JSON.stringify(
      Object.entries(pred.indicator_params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('|')
    );

    if (!groups.has(key)) {
      groups.set(key, {
        wins: 0,
        losses: 0,
        params: pred.indicator_params as Record<string, number | string>,
      });
    }

    const group = groups.get(key)!;
    if (outcome.result === 'WIN') group.wins++;
    else group.losses++;
  }

  return Array.from(groups.values());
}

export async function optimizeParameters(): Promise<LearningParams> {
  try {
    const supabase = createServerClient();

    // a. Get current active learning params
    const currentParams = await getActiveLearningParams();

    // b. Get recent outcomes (last 100)
    const { data: outcomesData, error: outcomeErr } = await supabase
      .from('outcomes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (outcomeErr) {
      console.error('[optimizer] Failed to fetch outcomes:', outcomeErr.message);
      return currentParams;
    }

    const outcomes = (outcomesData ?? []) as Outcome[];

    if (outcomes.length < 5) {
      // Not enough data to optimize — keep current params
      console.log('[optimizer] Not enough outcomes to optimize (< 5). Keeping current params.');
      return currentParams;
    }

    // c. Calculate current win rate
    const wins = outcomes.filter((o) => o.result === 'WIN').length;
    const losses = outcomes.filter((o) => o.result === 'LOSS').length;
    const winRate = wins / outcomes.length;

    // Fetch related predictions for grouping analysis
    const predictionIds = outcomes.map((o) => o.prediction_id);
    const { data: predsData } = await supabase
      .from('predictions')
      .select('*')
      .in('id', predictionIds);
    const predictions = (predsData ?? []) as Prediction[];

    // Group outcomes by indicator_params to find winning combinations
    const paramGroups = groupOutcomesByParams(outcomes, predictions);

    // Find the best-performing parameter group (minimum 3 outcomes)
    const significantGroups = paramGroups.filter((g) => g.wins + g.losses >= 3);
    const bestGroup = significantGroups.length > 0
      ? significantGroups.reduce((best, g) => {
          const gRate = g.wins / (g.wins + g.losses);
          const bestRate = best.wins / (best.wins + best.losses);
          return gRate > bestRate ? g : best;
        })
      : null;

    // d/e/f. Determine adjustment magnitude based on win rate
    let adjustmentMagnitude: 'small' | 'moderate' | 'large';
    if (winRate > 0.55) {
      adjustmentMagnitude = 'small'; // Params are working well
    } else if (winRate < 0.45) {
      adjustmentMagnitude = 'large'; // Need significant changes
    } else {
      adjustmentMagnitude = 'moderate'; // Middle ground
    }

    // Build the new params based on current + adjustments
    const newParams: Omit<LearningParams, 'id' | 'updated_at'> = { ...currentParams };

    // Increment deltas based on adjustment magnitude
    const deltas: Record<string, number> = {
      small: 1,
      moderate: 1.5,
      large: 2,
    };
    const delta = deltas[adjustmentMagnitude];

    // Track how many params we've changed (max 2 at a time)
    let changesCount = 0;

    // Helper: decide whether to shift towards best group's value
    function shiftToward(current: number, bestVal: number | undefined, d: number): number {
      if (bestVal !== undefined && bestVal !== current) {
        const direction = bestVal > current ? 1 : -1;
        return current + direction * d;
      }
      return jitter(current, d * 0.5);
    }

    // --- RSI Period (10-20) ---
    if (changesCount < 2) {
      const bestRsi = bestGroup?.params?.rsi_period as number | undefined;
      const shifted = Math.round(shiftToward(currentParams.rsi_period, bestRsi, delta));
      const clamped = clamp(shifted, 10, 20);
      if (clamped !== currentParams.rsi_period) {
        newParams.rsi_period = clamped;
        changesCount++;
      }
    }

    // --- Stoch Period (10-20) ---
    if (changesCount < 2) {
      const bestStoch = bestGroup?.params?.stoch_period as number | undefined;
      const shifted = Math.round(shiftToward(currentParams.stoch_period, bestStoch, delta));
      const clamped = clamp(shifted, 10, 20);
      if (clamped !== currentParams.stoch_period) {
        newParams.stoch_period = clamped;
        changesCount++;
      }
    }

    // --- K Smooth (2-5) ---
    if (changesCount < 2) {
      const bestK = bestGroup?.params?.k_smooth as number | undefined;
      const shifted = Math.round(shiftToward(currentParams.k_smooth, bestK, 1));
      const clamped = clamp(shifted, 2, 5);
      if (clamped !== currentParams.k_smooth) {
        newParams.k_smooth = clamped;
        changesCount++;
      }
    }

    // --- D Smooth (2-5) ---
    if (changesCount < 2) {
      const bestD = bestGroup?.params?.d_smooth as number | undefined;
      const shifted = Math.round(shiftToward(currentParams.d_smooth, bestD, 1));
      const clamped = clamp(shifted, 2, 5);
      if (clamped !== currentParams.d_smooth) {
        newParams.d_smooth = clamped;
        changesCount++;
      }
    }

    // --- MA Period (2-9) ---
    if (changesCount < 2) {
      const bestMa = bestGroup?.params?.ma_period as number | undefined;
      const shifted = Math.round(shiftToward(currentParams.ma_period, bestMa, delta));
      const clamped = clamp(shifted, 2, 9);
      if (clamped !== currentParams.ma_period) {
        newParams.ma_period = clamped;
        changesCount++;
      }
    }

    // --- MA Type (SMA / EMA) ---
    if (changesCount < 2 && adjustmentMagnitude !== 'small') {
      const bestMaType = bestGroup?.params?.ma_type as string | undefined;
      if (bestMaType && bestMaType !== currentParams.ma_type) {
        newParams.ma_type = bestMaType;
        changesCount++;
      } else if (winRate < 0.45) {
        // Switch MA type as a larger adjustment
        newParams.ma_type = currentParams.ma_type === 'SMA' ? 'EMA' : 'SMA';
        changesCount++;
      }
    }

    // --- Overbought Threshold (70-90) ---
    if (changesCount < 2) {
      const bestOb = bestGroup?.params?.overbought_threshold as number | undefined;
      const shifted = Math.round(shiftToward(currentParams.overbought_threshold, bestOb, delta));
      const clamped = clamp(shifted, 70, 90);
      if (clamped !== currentParams.overbought_threshold) {
        newParams.overbought_threshold = clamped;
        changesCount++;
      }
    }

    // --- Oversold Threshold (10-30) ---
    if (changesCount < 2) {
      const bestOs = bestGroup?.params?.oversold_threshold as number | undefined;
      const shifted = Math.round(shiftToward(currentParams.oversold_threshold, bestOs, delta));
      const clamped = clamp(shifted, 10, 30);
      if (clamped !== currentParams.oversold_threshold) {
        newParams.oversold_threshold = clamped;
        changesCount++;
      }
    }

    // --- Confidence Weights (must sum to 1.0) ---
    if (changesCount < 2) {
      const bestWStoch = bestGroup?.params?.confidence_weight_stochrsi as number | undefined;
      const currentWStoch = currentParams.confidence_weight_stochrsi;
      let newWStoch = currentWStoch;

      if (bestWStoch !== undefined) {
        const direction = bestWStoch > currentWStoch ? 1 : -1;
        newWStoch = currentWStoch + direction * 0.05;
      } else {
        newWStoch = jitter(currentWStoch, 0.025);
      }

      newWStoch = clamp(Math.round(newWStoch * 100) / 100, 0.2, 0.8);
      const newWMa = Math.round((1.0 - newWStoch) * 100) / 100;

      if (newWStoch !== currentParams.confidence_weight_stochrsi) {
        newParams.confidence_weight_stochrsi = newWStoch;
        newParams.confidence_weight_ma = newWMa;
        changesCount++;
      }
    }

    // Update totals
    newParams.total_predictions = (currentParams.total_predictions ?? 0) + outcomes.length;
    newParams.total_wins = (currentParams.total_wins ?? 0) + wins;

    // g. Deactivate old params
    const { error: deactErr } = await supabase
      .from('learning_params')
      .update({ is_active: false })
      .eq('is_active', true);

    if (deactErr) {
      console.error('[optimizer] Failed to deactivate old params:', deactErr.message);
    }

    // h. Update performance_score based on win rate
    newParams.performance_score = Math.round(winRate * 100 * 100) / 100;

    // Insert new params
    const { data: insertedData, error: insertErr } = await supabase
      .from('learning_params')
      .insert({
        ...newParams,
        is_active: true,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[optimizer] Failed to insert new params:', insertErr.message);
      return currentParams;
    }

    console.log(
      `[optimizer] Params optimized. Win rate: ${(winRate * 100).toFixed(1)}%, ` +
        `magnitude: ${adjustmentMagnitude}, changes: ${changesCount}`
    );

    return (insertedData ?? { ...newParams, is_active: true }) as LearningParams;
  } catch (err) {
    console.error('[optimizer] optimizeParameters error:', err);
    return await getActiveLearningParams();
  }
}

// ---------------------------------------------------------------------------
// 4. recordModelPerformance
// ---------------------------------------------------------------------------

export async function recordModelPerformance(): Promise<void> {
  try {
    const supabase = createServerClient();

    // Total predictions
    const { count: totalPreds, error: countErr } = await supabase
      .from('predictions')
      .select('*', { count: 'exact', head: true });

    if (countErr) {
      console.error('[optimizer] Failed to count predictions:', countErr.message);
      return;
    }

    const totalPredictions = totalPreds ?? 0;

    // Wins & losses from evaluated predictions
    const { data: evaluatedPreds, error: evalErr } = await supabase
      .from('predictions')
      .select('outcome, confidence')
      .eq('evaluated', true);

    if (evalErr) {
      console.error('[optimizer] Failed to fetch evaluated predictions:', evalErr.message);
      return;
    }

    const preds = evaluatedPreds ?? [];
    const totalWins = preds.filter((p) => p.outcome === 'WIN').length;
    const totalLosses = preds.filter((p) => p.outcome === 'LOSS').length;
    const evaluated = totalWins + totalLosses;
    const winRate = evaluated > 0 ? totalWins / evaluated : 0;

    // Average confidence
    const confidences = preds
      .map((p) => p.confidence)
      .filter((c): c is number => c !== null && c !== undefined);
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
        : 0;

    // Last 7 days win rate
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: last7d } = await supabase
      .from('predictions')
      .select('outcome')
      .eq('evaluated', true)
      .gte('created_at', sevenDaysAgo);

    const preds7d = last7d ?? [];
    const wins7d = preds7d.filter((p) => p.outcome === 'WIN').length;
    const evaluated7d = preds7d.filter((p) => p.outcome === 'WIN' || p.outcome === 'LOSS').length;
    const last7dWinRate = evaluated7d > 0 ? wins7d / evaluated7d : 0;

    // Last 24 hours win rate
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: last24h } = await supabase
      .from('predictions')
      .select('outcome')
      .eq('evaluated', true)
      .gte('created_at', twentyFourHoursAgo);

    const preds24h = last24h ?? [];
    const wins24h = preds24h.filter((p) => p.outcome === 'WIN').length;
    const evaluated24h = preds24h.filter(
      (p) => p.outcome === 'WIN' || p.outcome === 'LOSS'
    ).length;
    const last24hWinRate = evaluated24h > 0 ? wins24h / evaluated24h : 0;

    // Insert the performance snapshot
    const { error: insertErr } = await supabase.from('model_performance').insert({
      total_predictions: totalPredictions,
      total_wins: totalWins,
      total_losses: totalLosses,
      win_rate: Math.round(winRate * 10000) / 10000,
      avg_confidence: Math.round(avgConfidence * 10000) / 10000,
      last_7d_win_rate: Math.round(last7dWinRate * 10000) / 10000,
      last_24h_win_rate: Math.round(last24hWinRate * 10000) / 10000,
    });

    if (insertErr) {
      console.error('[optimizer] Failed to insert model performance:', insertErr.message);
    }
  } catch (err) {
    console.error('[optimizer] recordModelPerformance error:', err);
  }
}

// ---------------------------------------------------------------------------
// 5. getPerformanceStats
// ---------------------------------------------------------------------------

export async function getPerformanceStats(): Promise<{
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  avgConfidence: number;
  recentWinRate: number;
  streak: number;
}> {
  const defaultStats = {
    total: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgConfidence: 0,
    recentWinRate: 0,
    streak: 0,
  };

  try {
    const supabase = createServerClient();

    // Fetch evaluated predictions ordered by creation time for streak calc
    const { data: preds, error } = await supabase
      .from('predictions')
      .select('outcome, confidence, created_at')
      .eq('evaluated', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[optimizer] Failed to fetch predictions for stats:', error.message);
      return defaultStats;
    }

    const evaluated = (preds ?? []).filter(
      (p): p is (typeof preds)[0] & { outcome: 'WIN' | 'LOSS' } =>
        p.outcome === 'WIN' || p.outcome === 'LOSS'
    );

    if (evaluated.length === 0) return defaultStats;

    const wins = evaluated.filter((p) => p.outcome === 'WIN').length;
    const losses = evaluated.filter((p) => p.outcome === 'LOSS').length;
    const winRate = wins / evaluated.length;

    // Average confidence
    const confidences = evaluated
      .map((p) => p.confidence)
      .filter((c): c is number => c !== null && c !== undefined);
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
        : 0;

    // Recent win rate (last 20 predictions)
    const recentSlice = evaluated.slice(0, 20);
    const recentWins = recentSlice.filter((p) => p.outcome === 'WIN').length;
    const recentWinRate = recentSlice.length > 0 ? recentWins / recentSlice.length : 0;

    // Streak: consecutive same-outcome from most recent
    let streak = 0;
    if (evaluated.length > 0) {
      const latestOutcome = evaluated[0].outcome;
      for (const p of evaluated) {
        if (p.outcome === latestOutcome) {
          streak++;
        } else {
          break;
        }
      }
      // Negative streak for losses, positive for wins
      streak = latestOutcome === 'WIN' ? streak : -streak;
    }

    return {
      total: evaluated.length,
      wins,
      losses,
      winRate: Math.round(winRate * 10000) / 10000,
      avgConfidence: Math.round(avgConfidence * 10000) / 10000,
      recentWinRate: Math.round(recentWinRate * 10000) / 10000,
      streak,
    };
  } catch (err) {
    console.error('[optimizer] getPerformanceStats error:', err);
    return defaultStats;
  }
}

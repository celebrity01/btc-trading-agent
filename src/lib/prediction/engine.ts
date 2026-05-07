import { calculateStochRSI, calculateMAStochRSI } from '../indicators';
import type { LearningParams, Prediction } from '../supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PredictionInput {
  closes: number[];
  currentPrice: number;
  symbol: string;
  timeframe: string;
  params: LearningParams;
}

export interface PredictionResult {
  direction: 'UP' | 'DOWN';
  confidence: number; // 0-100
  stochrsi_k: number;
  stochrsi_d: number;
  ma_stochrsi_k: number;
  ma_stochrsi_d: number;
  signals: SignalDetail[];
  indicator_params: Record<string, any>;
}

export interface SignalDetail {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-1
  description: string;
}

// ---------------------------------------------------------------------------
// Helper: Analyze StochRSI zone
// ---------------------------------------------------------------------------

/**
 * Determines which zone the StochRSI indicator is in and how deep.
 *
 * @param k - StochRSI %K value
 * @param d - StochRSI %D value
 * @param overbought - Overbought threshold (e.g. 80)
 * @param oversold - Oversold threshold (e.g. 20)
 * @returns The current zone and a 0-1 strength indicating how deep into the zone
 */
export function analyzeStochRSIZone(
  k: number,
  d: number,
  overbought: number,
  oversold: number
): { zone: 'overbought' | 'oversold' | 'neutral'; strength: number } {
  // Use %K as the primary zone indicator
  if (k <= oversold) {
    // Deeper into oversold = lower %K = stronger signal
    // At %K=0 strength=1, at %K=oversold strength=0
    const strength = oversold === 0 ? 1 : Math.min(1, (oversold - k) / oversold);
    return { zone: 'oversold', strength };
  }

  if (k >= overbought) {
    // Deeper into overbought = higher %K = stronger signal
    // At %K=100 strength=1, at %K=overbought strength=0
    const range = 100 - overbought;
    const strength = range === 0 ? 1 : Math.min(1, (k - overbought) / range);
    return { zone: 'overbought', strength };
  }

  // Neutral zone — strength reflects how close to a boundary
  const distToOversold = k - oversold;
  const distToOverbought = overbought - k;
  const neutralRange = overbought - oversold;
  const strength = neutralRange === 0 ? 0 : 1 - Math.min(distToOversold, distToOverbought) / (neutralRange / 2);

  return { zone: 'neutral', strength: Math.max(0, Math.min(1, strength)) };
}

// ---------------------------------------------------------------------------
// Helper: Crossover detection
// ---------------------------------------------------------------------------

/**
 * Detects %K / %D crossovers and measures their strength based on the
 * magnitude of the cross (distance between %K and %D after crossing).
 *
 * @returns The crossover type and a 0-1 strength value
 */
export function calculateCrossoverStrength(
  prevK: number,
  prevD: number,
  currK: number,
  currD: number
): { type: 'bullish' | 'bearish' | 'none'; strength: number } {
  // Check for bullish crossover: %K was below %D, now above
  if (prevK <= prevD && currK > currD) {
    const magnitude = Math.abs(currK - currD);
    // Normalize: a 10-point cross is already notable, 30+ is very strong
    const strength = Math.min(1, magnitude / 30);
    return { type: 'bullish', strength };
  }

  // Check for bearish crossover: %K was above %D, now below
  if (prevK >= prevD && currK < currD) {
    const magnitude = Math.abs(currD - currK);
    const strength = Math.min(1, magnitude / 30);
    return { type: 'bearish', strength };
  }

  return { type: 'none', strength: 0 };
}

// ---------------------------------------------------------------------------
// Helper: Get last valid (non-NaN) value from an array
// ---------------------------------------------------------------------------

function getLastValid(arr: number[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!isNaN(arr[i])) return arr[i];
  }
  return null;
}

/**
 * Get the second-to-last valid value from an array (for crossover detection).
 * Skips the most recent valid value and returns the one before it.
 */
function getSecondLastValid(arr: number[]): number | null {
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!isNaN(arr[i])) {
      count++;
      if (count === 2) return arr[i];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main function: generatePrediction
// ---------------------------------------------------------------------------

/**
 * Core prediction engine that combines StochRSI and MA-StochRSI indicators
 * to generate binary UP/DOWN predictions with confidence scores.
 *
 * Algorithm overview:
 * 1. Calculate StochRSI from closing prices using learning params
 * 2. Calculate MA-StochRSI from StochRSI output
 * 3. Generate trading signals from indicator analysis
 * 4. Determine direction from signal consensus
 * 5. Calculate confidence from signal agreement and indicator extremes
 * 6. Return full PredictionResult
 */
export function generatePrediction(input: PredictionInput): PredictionResult {
  const { closes, currentPrice, symbol, timeframe, params } = input;

  // -----------------------------------------------------------------------
  // Edge case: not enough closing price data
  // -----------------------------------------------------------------------
  const minDataPoints =
    params.rsi_period + 1 + params.stoch_period - 1 + params.k_smooth - 1 + params.d_smooth - 1;

  if (closes.length < minDataPoints) {
    return {
      direction: 'UP',
      confidence: 30,
      stochrsi_k: 50,
      stochrsi_d: 50,
      ma_stochrsi_k: 50,
      ma_stochrsi_d: 50,
      signals: [
        {
          name: 'Insufficient Data',
          type: 'neutral',
          strength: 0,
          description: `Need at least ${minDataPoints} data points, got ${closes.length}`,
        },
      ],
      indicator_params: buildIndicatorParams(params),
    };
  }

  // -----------------------------------------------------------------------
  // Step 1: Calculate StochRSI
  // -----------------------------------------------------------------------
  const stochRSI = calculateStochRSI(
    closes,
    params.rsi_period,
    params.stoch_period,
    params.k_smooth,
    params.d_smooth
  );

  // -----------------------------------------------------------------------
  // Step 2: Calculate MA-StochRSI
  // -----------------------------------------------------------------------
  const maType = (params.ma_type?.toUpperCase() === 'EMA' ? 'EMA' : 'SMA') as 'SMA' | 'EMA';
  const maStochRSI = calculateMAStochRSI(
    stochRSI.k,
    stochRSI.d,
    maType,
    params.ma_period
  );

  // -----------------------------------------------------------------------
  // Extract latest indicator values (last valid entries)
  // -----------------------------------------------------------------------
  const latestK = getLastValid(stochRSI.k);
  const latestD = getLastValid(stochRSI.d);
  const prevK = getSecondLastValid(stochRSI.k);
  const prevD = getSecondLastValid(stochRSI.d);

  const latestMAK = getLastValid(maStochRSI.ma_k);
  const latestMAD = getLastValid(maStochRSI.ma_d);
  const prevMAK = getSecondLastValid(maStochRSI.ma_k);
  const prevMAD = getSecondLastValid(maStochRSI.ma_d);

  // Fallback if indicators couldn't be computed
  if (latestK === null || latestD === null) {
    return {
      direction: 'UP',
      confidence: 30,
      stochrsi_k: 50,
      stochrsi_d: 50,
      ma_stochrsi_k: 50,
      ma_stochrsi_d: 50,
      signals: [
        {
          name: 'Indicator Calculation Failed',
          type: 'neutral',
          strength: 0,
          description: 'StochRSI could not be computed with the given data and parameters',
        },
      ],
      indicator_params: buildIndicatorParams(params),
    };
  }

  // Use safe defaults for previous values if unavailable
  const safePrevK = prevK ?? latestK;
  const safePrevD = prevD ?? latestD;
  const safeLatestMAK = latestMAK ?? latestK;
  const safeLatestMAD = latestMAD ?? latestD;
  const safePrevMAK = prevMAK ?? safeLatestMAK;
  const safePrevMAD = prevMAD ?? safeLatestMAD;

  const overbought = params.overbought_threshold;
  const oversold = params.oversold_threshold;

  // -----------------------------------------------------------------------
  // Step 3: Generate Signals
  // -----------------------------------------------------------------------
  const signals: SignalDetail[] = [];

  // --- Signal A: StochRSI Crossover ---
  const crossover = calculateCrossoverStrength(safePrevK, safePrevD, latestK, latestD);
  if (crossover.type !== 'none') {
    signals.push({
      name: 'StochRSI Crossover',
      type: crossover.type,
      strength: crossover.strength,
      description:
        crossover.type === 'bullish'
          ? `Bullish crossover: %K (${latestK.toFixed(2)}) crossed above %D (${latestD.toFixed(2)})`
          : `Bearish crossover: %K (${latestK.toFixed(2)}) crossed below %D (${latestD.toFixed(2)})`,
    });
  }

  // --- Signal B: Overbought / Oversold Zone ---
  const zone = analyzeStochRSIZone(latestK, latestD, overbought, oversold);
  if (zone.zone === 'oversold') {
    signals.push({
      name: 'Oversold Zone',
      type: 'bullish',
      strength: zone.strength,
      description: `StochRSI %K at ${latestK.toFixed(2)} is in oversold zone (below ${oversold}), depth: ${(zone.strength * 100).toFixed(1)}%`,
    });
  } else if (zone.zone === 'overbought') {
    signals.push({
      name: 'Overbought Zone',
      type: 'bearish',
      strength: zone.strength,
      description: `StochRSI %K at ${latestK.toFixed(2)} is in overbought zone (above ${overbought}), depth: ${(zone.strength * 100).toFixed(1)}%`,
    });
  }

  // --- Signal C: MA-StochRSI Confirmation ---
  const stochrsiDirection: 'up' | 'down' | 'flat' =
    latestK > latestD ? 'up' : latestK < latestD ? 'down' : 'flat';
  const maDirection: 'up' | 'down' | 'flat' =
    safeLatestMAK > safeLatestMAD ? 'up' : safeLatestMAK < safeLatestMAD ? 'down' : 'flat';

  if (stochrsiDirection !== 'flat' && maDirection !== 'flat') {
    if (stochrsiDirection === maDirection) {
      // Alignment — adds confidence
      const alignmentStrength = Math.min(
        Math.abs(safeLatestMAK - safeLatestMAD) / 20,
        1
      );
      signals.push({
        name: 'MA-StochRSI Confirmation',
        type: stochrsiDirection === 'up' ? 'bullish' : 'bearish',
        strength: alignmentStrength,
        description:
          stochrsiDirection === 'up'
            ? `MA-StochRSI confirms bullish: MA-%K (${safeLatestMAK.toFixed(2)}) above MA-%D (${safeLatestMAD.toFixed(2)})`
            : `MA-StochRSI confirms bearish: MA-%K (${safeLatestMAK.toFixed(2)}) below MA-%D (${safeLatestMAD.toFixed(2)})`,
      });
    } else {
      // Divergence — reduces confidence (neutral signal with opposing direction strength)
      const divergenceStrength = Math.min(
        Math.abs(safeLatestMAK - safeLatestMAD) / 20,
        0.5 // Cap divergence at 0.5 so it doesn't overpower
      );
      signals.push({
        name: 'MA-StochRSI Divergence',
        type: maDirection === 'up' ? 'bullish' : 'bearish',
        strength: divergenceStrength,
        description:
          maDirection === 'up'
            ? `MA-StochRSI diverges (bullish): MA-%K (${safeLatestMAK.toFixed(2)}) above MA-%D (${safeLatestMAD.toFixed(2)}) while StochRSI is bearish`
            : `MA-StochRSI diverges (bearish): MA-%K (${safeLatestMAK.toFixed(2)}) below MA-%D (${safeLatestMAD.toFixed(2)}) while StochRSI is bullish`,
      });
    }
  }

  // --- Signal D: Zone Re-entry ---
  // Previous bar was in oversold/overbought zone, current is in neutral
  const prevZone = analyzeStochRSIZone(safePrevK, safePrevD, overbought, oversold);

  if (prevZone.zone === 'oversold' && zone.zone === 'neutral') {
    // Just exited oversold — strong bullish re-entry
    const reentryStrength = Math.min(
      (latestK - oversold) / (overbought - oversold) * 2,
      1
    );
    signals.push({
      name: 'Oversold Re-entry',
      type: 'bullish',
      strength: reentryStrength,
      description: `StochRSI crossed back from oversold zone into neutral: %K moved from ${safePrevK.toFixed(2)} to ${latestK.toFixed(2)}`,
    });
  } else if (prevZone.zone === 'overbought' && zone.zone === 'neutral') {
    // Just exited overbought — strong bearish re-entry
    const reentryStrength = Math.min(
      (overbought - latestK) / (overbought - oversold) * 2,
      1
    );
    signals.push({
      name: 'Overbought Re-entry',
      type: 'bearish',
      strength: reentryStrength,
      description: `StochRSI crossed back from overbought zone into neutral: %K moved from ${safePrevK.toFixed(2)} to ${latestK.toFixed(2)}`,
    });
  }

  // -----------------------------------------------------------------------
  // Step 4: Calculate Direction
  // -----------------------------------------------------------------------
  let bullishScore = 0;
  let bearishScore = 0;

  for (const signal of signals) {
    if (signal.type === 'bullish') {
      bullishScore += signal.strength;
    } else if (signal.type === 'bearish') {
      bearishScore += signal.strength;
    }
    // Neutral signals don't affect direction
  }

  const totalScore = bullishScore - bearishScore;
  const direction: 'UP' | 'DOWN' = totalScore > 0 ? 'UP' : 'DOWN';

  // -----------------------------------------------------------------------
  // Step 5: Calculate Confidence (0-100)
  // -----------------------------------------------------------------------

  // Base confidence: signal agreement ratio
  const totalSignalStrength = bullishScore + bearishScore;
  const dominantScore = direction === 'UP' ? bullishScore : bearishScore;
  const agreementRatio = totalSignalStrength > 0 ? dominantScore / totalSignalStrength : 0.5;

  // Count how many signals agree with the direction
  const agreeingSignals = signals.filter(
    (s) => s.type === (direction === 'UP' ? 'bullish' : 'bearish')
  ).length;
  const totalSignals = signals.filter((s) => s.type !== 'neutral').length;
  const signalAgreement = totalSignals > 0 ? agreeingSignals / totalSignals : 0.5;

  // Combine agreement measures
  let confidence = (agreementRatio * 0.5 + signalAgreement * 0.5) * 100;

  // Apply confidence weights from learning params
  const weightStochRSI = params.confidence_weight_stochrsi;
  const weightMA = params.confidence_weight_ma;

  // StochRSI conviction: how far %K is from the neutral 50
  const stochrsiConviction = Math.abs(latestK - 50) / 50; // 0 to 1
  confidence *= (1 + stochrsiConviction * weightStochRSI * 0.3);

  // MA-StochRSI conviction: how far MA-%K is from the neutral 50
  const maConviction = Math.abs(safeLatestMAK - 50) / 50; // 0 to 1
  confidence *= (1 + maConviction * weightMA * 0.2);

  // Crossover bonus: if there's a fresh crossover, boost confidence
  if (crossover.type !== 'none') {
    confidence += crossover.strength * 10;
  }

  // Extreme values bonus: near 0 or 100 on StochRSI
  if (latestK <= 5 || latestK >= 95) {
    confidence += 5;
  } else if (latestK <= 10 || latestK >= 90) {
    confidence += 3;
  }

  // Clamp to 30-95 range
  confidence = Math.max(30, Math.min(95, Math.round(confidence)));

  // -----------------------------------------------------------------------
  // Step 6: Build indicator_params
  // -----------------------------------------------------------------------
  const indicator_params = buildIndicatorParams(params);

  // -----------------------------------------------------------------------
  // Step 7: Return PredictionResult
  // -----------------------------------------------------------------------
  return {
    direction,
    confidence,
    stochrsi_k: parseFloat(latestK.toFixed(4)),
    stochrsi_d: parseFloat(latestD.toFixed(4)),
    ma_stochrsi_k: parseFloat(safeLatestMAK.toFixed(4)),
    ma_stochrsi_d: parseFloat(safeLatestMAD.toFixed(4)),
    signals,
    indicator_params,
  };
}

// ---------------------------------------------------------------------------
// Helper: Build indicator_params record
// ---------------------------------------------------------------------------

function buildIndicatorParams(params: LearningParams): Record<string, any> {
  return {
    rsi_period: params.rsi_period,
    stoch_period: params.stoch_period,
    k_smooth: params.k_smooth,
    d_smooth: params.d_smooth,
    ma_type: params.ma_type,
    ma_period: params.ma_period,
    overbought_threshold: params.overbought_threshold,
    oversold_threshold: params.oversold_threshold,
    confidence_weight_stochrsi: params.confidence_weight_stochrsi,
    confidence_weight_ma: params.confidence_weight_ma,
  };
}

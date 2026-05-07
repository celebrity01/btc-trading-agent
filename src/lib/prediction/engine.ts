import { calculateStochRSI, calculateMAStochRSI } from '../indicators';
import type { Prediction } from '../supabase';

// ---------------------------------------------------------------------------
// Fixed indicator configuration (no learning/adaptation)
// ---------------------------------------------------------------------------

export interface IndicatorConfig {
  rsi_period: number;
  stoch_period: number;
  k_smooth: number;
  d_smooth: number;
  ma_type: 'SMA' | 'EMA';
  ma_period: number;
  overbought_threshold: number;
  oversold_threshold: number;
  confidence_weight_stochrsi: number;
  confidence_weight_ma: number;
}

/** Default StochRSI + MA-StochRSI parameters — well-tested standard values */
export const DEFAULT_CONFIG: IndicatorConfig = {
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
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PredictionInput {
  closes: number[];
  currentPrice: number;
  symbol: string;
  timeframe: string;
  config?: IndicatorConfig;
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

export function analyzeStochRSIZone(
  k: number,
  d: number,
  overbought: number,
  oversold: number
): { zone: 'overbought' | 'oversold' | 'neutral'; strength: number } {
  if (k <= oversold) {
    const strength = oversold === 0 ? 1 : Math.min(1, (oversold - k) / oversold);
    return { zone: 'oversold', strength };
  }

  if (k >= overbought) {
    const range = 100 - overbought;
    const strength = range === 0 ? 1 : Math.min(1, (k - overbought) / range);
    return { zone: 'overbought', strength };
  }

  const distToOversold = k - oversold;
  const distToOverbought = overbought - k;
  const neutralRange = overbought - oversold;
  const strength = neutralRange === 0 ? 0 : 1 - Math.min(distToOversold, distToOverbought) / (neutralRange / 2);

  return { zone: 'neutral', strength: Math.max(0, Math.min(1, strength)) };
}

// ---------------------------------------------------------------------------
// Helper: Crossover detection
// ---------------------------------------------------------------------------

export function calculateCrossoverStrength(
  prevK: number,
  prevD: number,
  currK: number,
  currD: number
): { type: 'bullish' | 'bearish' | 'none'; strength: number } {
  if (prevK <= prevD && currK > currD) {
    const magnitude = Math.abs(currK - currD);
    const strength = Math.min(1, magnitude / 30);
    return { type: 'bullish', strength };
  }

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

export function generatePrediction(input: PredictionInput): PredictionResult {
  const config = input.config ?? DEFAULT_CONFIG;
  const { closes, currentPrice, symbol, timeframe } = input;

  // -----------------------------------------------------------------------
  // Edge case: not enough closing price data
  // -----------------------------------------------------------------------
  const minDataPoints =
    config.rsi_period + 1 + config.stoch_period - 1 + config.k_smooth - 1 + config.d_smooth - 1;

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
      indicator_params: buildIndicatorParams(config),
    };
  }

  // -----------------------------------------------------------------------
  // Step 1: Calculate StochRSI
  // -----------------------------------------------------------------------
  const stochRSI = calculateStochRSI(
    closes,
    config.rsi_period,
    config.stoch_period,
    config.k_smooth,
    config.d_smooth
  );

  // -----------------------------------------------------------------------
  // Step 2: Calculate MA-StochRSI
  // -----------------------------------------------------------------------
  const maType = config.ma_type;
  const maStochRSI = calculateMAStochRSI(
    stochRSI.k,
    stochRSI.d,
    maType,
    config.ma_period
  );

  // -----------------------------------------------------------------------
  // Extract latest indicator values
  // -----------------------------------------------------------------------
  const latestK = getLastValid(stochRSI.k);
  const latestD = getLastValid(stochRSI.d);
  const prevK = getSecondLastValid(stochRSI.k);
  const prevD = getSecondLastValid(stochRSI.d);

  const latestMAK = getLastValid(maStochRSI.ma_k);
  const latestMAD = getLastValid(maStochRSI.ma_d);
  const prevMAK = getSecondLastValid(maStochRSI.ma_k);
  const prevMAD = getSecondLastValid(maStochRSI.ma_d);

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
      indicator_params: buildIndicatorParams(config),
    };
  }

  const safePrevK = prevK ?? latestK;
  const safePrevD = prevD ?? latestD;
  const safeLatestMAK = latestMAK ?? latestK;
  const safeLatestMAD = latestMAD ?? latestD;
  const safePrevMAK = prevMAK ?? safeLatestMAK;
  const safePrevMAD = prevMAD ?? safeLatestMAD;

  const overbought = config.overbought_threshold;
  const oversold = config.oversold_threshold;

  // -----------------------------------------------------------------------
  // Step 3: Generate Signals
  // -----------------------------------------------------------------------
  const signals: SignalDetail[] = [];

  // Signal A: StochRSI Crossover
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

  // Signal B: Overbought / Oversold Zone
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

  // Signal C: MA-StochRSI Confirmation
  const stochrsiDirection: 'up' | 'down' | 'flat' =
    latestK > latestD ? 'up' : latestK < latestD ? 'down' : 'flat';
  const maDirection: 'up' | 'down' | 'flat' =
    safeLatestMAK > safeLatestMAD ? 'up' : safeLatestMAK < safeLatestMAD ? 'down' : 'flat';

  if (stochrsiDirection !== 'flat' && maDirection !== 'flat') {
    if (stochrsiDirection === maDirection) {
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
      const divergenceStrength = Math.min(
        Math.abs(safeLatestMAK - safeLatestMAD) / 20,
        0.5
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

  // Signal D: Zone Re-entry
  const prevZone = analyzeStochRSIZone(safePrevK, safePrevD, overbought, oversold);

  if (prevZone.zone === 'oversold' && zone.zone === 'neutral') {
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
  }

  const totalScore = bullishScore - bearishScore;
  const direction: 'UP' | 'DOWN' = totalScore > 0 ? 'UP' : 'DOWN';

  // -----------------------------------------------------------------------
  // Step 5: Calculate Confidence (0-100)
  // -----------------------------------------------------------------------
  const totalSignalStrength = bullishScore + bearishScore;
  const dominantScore = direction === 'UP' ? bullishScore : bearishScore;
  const agreementRatio = totalSignalStrength > 0 ? dominantScore / totalSignalStrength : 0.5;

  const agreeingSignals = signals.filter(
    (s) => s.type === (direction === 'UP' ? 'bullish' : 'bearish')
  ).length;
  const totalSignals = signals.filter((s) => s.type !== 'neutral').length;
  const signalAgreement = totalSignals > 0 ? agreeingSignals / totalSignals : 0.5;

  let confidence = (agreementRatio * 0.5 + signalAgreement * 0.5) * 100;

  // Apply confidence weights from config
  const weightStochRSI = config.confidence_weight_stochrsi;
  const weightMA = config.confidence_weight_ma;

  const stochrsiConviction = Math.abs(latestK - 50) / 50;
  confidence *= (1 + stochrsiConviction * weightStochRSI * 0.3);

  const maConviction = Math.abs(safeLatestMAK - 50) / 50;
  confidence *= (1 + maConviction * weightMA * 0.2);

  if (crossover.type !== 'none') {
    confidence += crossover.strength * 10;
  }

  if (latestK <= 5 || latestK >= 95) {
    confidence += 5;
  } else if (latestK <= 10 || latestK >= 90) {
    confidence += 3;
  }

  confidence = Math.max(30, Math.min(95, Math.round(confidence)));

  // -----------------------------------------------------------------------
  // Step 6: Build indicator_params
  // -----------------------------------------------------------------------
  const indicator_params = buildIndicatorParams(config);

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

function buildIndicatorParams(config: IndicatorConfig): Record<string, any> {
  return {
    rsi_period: config.rsi_period,
    stoch_period: config.stoch_period,
    k_smooth: config.k_smooth,
    d_smooth: config.d_smooth,
    ma_type: config.ma_type,
    ma_period: config.ma_period,
    overbought_threshold: config.overbought_threshold,
    oversold_threshold: config.oversold_threshold,
    confidence_weight_stochrsi: config.confidence_weight_stochrsi,
    confidence_weight_ma: config.confidence_weight_ma,
  };
}

export interface StochRSIResult {
  k: number[];    // %K line values
  d: number[];    // %D line values
}

/**
 * Calculate SMA (Simple Moving Average) over a given period.
 */
function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  result.push(sum / period);

  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
    result.push(sum / period);
  }

  return result;
}

/**
 * Calculate RSI (Relative Strength Index) using Wilder's smoothing method.
 *
 * Steps:
 * 1. Calculate price changes between consecutive closes.
 * 2. Separate into gains (positive changes) and losses (absolute negative changes).
 * 3. First average gain/loss = simple average of first `period` gains/losses.
 * 4. Subsequent averages use Wilder's smoothing:
 *    avgGain = (prevAvgGain * (period - 1) + currentGain) / period
 *    avgLoss = (prevAvgLoss * (period - 1) + currentLoss) / period
 * 5. RS = avgGain / avgLoss
 * 6. RSI = 100 - (100 / (1 + RS))
 */
function calculateRSI(closes: number[], period: number): number[] {
  const rsi: number[] = [];

  if (closes.length < period + 1) return rsi;

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Separate gains and losses
  const gains: number[] = changes.map((c) => (c > 0 ? c : 0));
  const losses: number[] = changes.map((c) => (c < 0 ? Math.abs(c) : 0));

  // First average: simple mean of first `period` values
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // Calculate first RSI value
  if (avgLoss === 0) {
    rsi.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  // Calculate subsequent RSI values using Wilder's smoothing
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }

  return rsi;
}

/**
 * Calculate StochRSI.
 *
 * Process:
 * 1. Compute RSI from closing prices.
 * 2. For each point, find the min and max RSI over the lookback (stochPeriod) window.
 * 3. Raw %K = ((RSI - minRSI) / (maxRSI - minRSI)) * 100
 *    - Handle division by zero: if maxRSI == minRSI, raw %K = 50 (neutral)
 * 4. %K = SMA of raw %K over kSmooth period
 * 5. %D = SMA of %K over dSmooth period
 *
 * The output arrays are aligned so that the last elements correspond to the most recent data.
 * All arrays have the same length; earlier positions (where not enough data exists) are filled with NaN.
 */
export function calculateStochRSI(
  closes: number[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
  kSmooth: number = 3,
  dSmooth: number = 3
): StochRSIResult {
  const result: StochRSIResult = { k: [], d: [] };

  // Need at least rsiPeriod + 1 closes to compute a single RSI value,
  // then stochPeriod RSI values for stochastic, then kSmooth for %K, then dSmooth for %D.
  const minDataPoints = rsiPeriod + 1 + stochPeriod - 1 + kSmooth - 1 + dSmooth - 1;
  if (closes.length < minDataPoints) {
    // Not enough data; return empty arrays
    return result;
  }

  // Step 1: Calculate RSI
  const rsiValues = calculateRSI(closes, rsiPeriod);

  if (rsiValues.length < stochPeriod) {
    return result;
  }

  // Step 2: Calculate raw Stochastic RSI (%K raw)
  const rawK: number[] = [];
  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    let minRSI = Infinity;
    let maxRSI = -Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsiValues[j] < minRSI) minRSI = rsiValues[j];
      if (rsiValues[j] > maxRSI) maxRSI = rsiValues[j];
    }

    const range = maxRSI - minRSI;
    if (range === 0) {
      rawK.push(50); // Neutral value when range is zero
    } else {
      rawK.push(((rsiValues[i] - minRSI) / range) * 100);
    }
  }

  // Step 3: Smooth raw %K with SMA over kSmooth period
  const smoothedK = sma(rawK, kSmooth);

  // Step 4: Calculate %D as SMA of smoothed %K over dSmooth period
  const dLine = sma(smoothedK, dSmooth);

  // The lengths of smoothedK and dLine differ because of SMA windowing.
  // We want to align them to the end of the data (most recent values).
  // Pad from the beginning so both arrays have the same length.
  const kLength = smoothedK.length;
  const dLength = dLine.length;

  if (kLength === 0 || dLength === 0) {
    return result;
  }

  // The total expected length should equal the number of rawK values
  // since that's our base. We pad with NaN for alignment.
  const totalLength = rawK.length;

  // %K: smoothedK is shorter than rawK by (kSmooth - 1)
  const kPad = totalLength - kLength;
  const kFull: number[] = [
    ...Array(kPad).fill(NaN),
    ...smoothedK,
  ];

  // %D: dLine is shorter than smoothedK by (dSmooth - 1)
  const dPad = totalLength - dLength;
  const dFull: number[] = [
    ...Array(dPad).fill(NaN),
    ...dLine,
  ];

  result.k = kFull;
  result.d = dFull;

  return result;
}

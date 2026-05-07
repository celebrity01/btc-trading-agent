export interface MAStochRSIResult {
  ma_k: number[];  // MA-smoothed %K
  ma_d: number[];  // MA-smoothed %D
}

/**
 * Calculate Simple Moving Average (SMA).
 * Returns an array of the same length as input, with NaN for positions
 * where there isn't enough data to compute the SMA.
 */
function calcSMA(data: number[], period: number): number[] {
  const result: number[] = [];

  if (data.length < period) {
    return data.map(() => NaN);
  }

  for (let i = 0; i < period - 1; i++) {
    result.push(NaN);
  }

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
 * Calculate Exponential Moving Average (EMA).
 * Returns an array of the same length as input, with NaN for positions
 * where there isn't enough data.
 *
 * EMA formula:
 * - Seed EMA with SMA of first `period` values
 * - Multiplier = 2 / (period + 1)
 * - EMA[i] = (value[i] - EMA[i-1]) * multiplier + EMA[i-1]
 */
function calcEMA(data: number[], period: number): number[] {
  const result: number[] = [];

  if (data.length < period) {
    return data.map(() => NaN);
  }

  // Fill leading positions with NaN
  for (let i = 0; i < period - 1; i++) {
    result.push(NaN);
  }

  // Seed: SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  const multiplier = 2 / (period + 1);
  let prevEMA = sum / period;
  result.push(prevEMA);

  // Calculate subsequent EMA values
  for (let i = period; i < data.length; i++) {
    const ema = (data[i] - prevEMA) * multiplier + prevEMA;
    result.push(ema);
    prevEMA = ema;
  }

  return result;
}

/**
 * Apply Moving Average smoothing to StochRSI outputs.
 *
 * Takes the %K and %D arrays from StochRSI and applies additional
 * MA smoothing using either SMA or EMA.
 *
 * Input arrays may contain NaN values at the beginning (from StochRSI calculation).
 * We skip NaN values and only apply smoothing to valid numeric data,
 * then re-align the results to preserve the same total length.
 *
 * @param stochrsiK - StochRSI %K line values (may contain leading NaN)
 * @param stochrsiD - StochRSI %D line values (may contain leading NaN)
 * @param maType - 'SMA' or 'EMA' (default: 'SMA')
 * @param maPeriod - MA period (default: 3)
 */
export function calculateMAStochRSI(
  stochrsiK: number[],
  stochrsiD: number[],
  maType: 'SMA' | 'EMA' = 'SMA',
  maPeriod: number = 3
): MAStochRSIResult {
  const result: MAStochRSIResult = { ma_k: [], ma_d: [] };

  // Extract valid (non-NaN) values from each input
  const validK: number[] = [];
  const validD: number[] = [];
  let firstValidKIdx = -1;
  let firstValidDIdx = -1;

  for (let i = 0; i < stochrsiK.length; i++) {
    if (!isNaN(stochrsiK[i])) {
      if (firstValidKIdx === -1) firstValidKIdx = i;
      validK.push(stochrsiK[i]);
    }
  }

  for (let i = 0; i < stochrsiD.length; i++) {
    if (!isNaN(stochrsiD[i])) {
      if (firstValidDIdx === -1) firstValidDIdx = i;
      validD.push(stochrsiD[i]);
    }
  }

  // Not enough valid data to compute MA
  if (validK.length < maPeriod || validD.length < maPeriod) {
    result.ma_k = stochrsiK.map(() => NaN);
    result.ma_d = stochrsiD.map(() => NaN);
    return result;
  }

  // Apply MA to valid values
  const maFunc = maType === 'EMA' ? calcEMA : calcSMA;
  const smoothedK = maFunc(validK, maPeriod);
  const smoothedD = maFunc(validD, maPeriod);

  // Build full-length arrays, padding with NaN to preserve alignment
  const totalKLength = stochrsiK.length;
  const totalDLength = stochrsiD.length;

  const maKFull: number[] = Array(totalKLength).fill(NaN);
  const maDFull: number[] = Array(totalDLength).fill(NaN);

  // Place smoothed values starting from the correct offset
  // smoothedK has (maPeriod - 1) leading NaNs, then valid values
  for (let i = 0; i < smoothedK.length; i++) {
    const targetIdx = firstValidKIdx + i;
    if (targetIdx < totalKLength) {
      maKFull[targetIdx] = smoothedK[i];
    }
  }

  for (let i = 0; i < smoothedD.length; i++) {
    const targetIdx = firstValidDIdx + i;
    if (targetIdx < totalDLength) {
      maDFull[targetIdx] = smoothedD[i];
    }
  }

  result.ma_k = maKFull;
  result.ma_d = maDFull;

  return result;
}

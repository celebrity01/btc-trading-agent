'use server';

import type { Candle } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MEXC_BASE_URL = 'https://api.mexc.com';
const MEXC_API_KEY = process.env.MEXC_API_KEY ?? '';
const MEXC_SECRET_KEY = process.env.MEXC_SECRET_KEY ?? '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Small delay utility to help with rate-limit awareness. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build standard headers (API key is optional for public endpoints). */
function defaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (MEXC_API_KEY) {
    headers['X-MEXC-APIKEY'] = MEXC_API_KEY;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Raw kline response shape from Mexc
// ---------------------------------------------------------------------------

/**
 * Mexc returns klines as an array of arrays:
 * [open_time, open, high, low, close, volume, close_time, quoteVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignored]
 */
type MexcKlineRaw = [
  number, // 0  open_time
  string, // 1  open
  string, // 2  high
  string, // 3  low
  string, // 4  close
  string, // 5  volume
  number, // 6  close_time
  string, // 7  quoteVolume
  number, // 8  trades
  string, // 9  takerBuyBaseVolume
  string, // 10 takerBuyQuoteVolume
  string, // 11 ignored
];

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * Fetch candlestick / kline data from Mexc.
 *
 * @param symbol   Trading pair, e.g. "BTCUSDT"
 * @param interval Kline interval, e.g. "1m", "5m", "15m", "1h", "4h", "1d"
 * @param limit    Number of candles to return (default 500, max 1000)
 */
export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number = 500
): Promise<Candle[]> {
  try {
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      interval,
      limit: String(Math.min(limit, 1000)),
    });

    const url = `${MEXC_BASE_URL}/api/v3/klines?${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: defaultHeaders(),
      next: { revalidate: 0 }, // always fresh for trading data
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Mexc klines API error: ${response.status} ${response.statusText} — ${text}`
      );
    }

    const data: MexcKlineRaw[] = await response.json();

    // Map raw arrays to our Candle interface
    const candles: Candle[] = data.map((k) => ({
      symbol: symbol.toUpperCase(),
      timeframe: interval,
      open_time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      close_time: k[6],
    }));

    return candles;
  } catch (error) {
    console.error('[mexc] fetchKlines error:', error);
    throw error;
  }
}

/**
 * Fetch the latest price for a symbol.
 *
 * @param symbol Trading pair, e.g. "BTCUSDT"
 */
export async function fetchLatestPrice(symbol: string): Promise<{
  symbol: string;
  price: number;
}> {
  try {
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
    });

    const url = `${MEXC_BASE_URL}/api/v3/ticker/price?${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: defaultHeaders(),
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Mexc ticker/price API error: ${response.status} ${response.statusText} — ${text}`
      );
    }

    const data = await response.json();

    return {
      symbol: data.symbol,
      price: parseFloat(data.price),
    };
  } catch (error) {
    console.error('[mexc] fetchLatestPrice error:', error);
    throw error;
  }
}

/**
 * Fetch 24-hour ticker statistics for a symbol.
 *
 * @param symbol Trading pair, e.g. "BTCUSDT"
 */
export async function fetch24hrTicker(symbol: string): Promise<{
  symbol: string;
  priceChange: number;
  priceChangePercent: number;
  weightedAvgPrice: number;
  lastPrice: number;
  volume: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
  openPrice: number;
  count: number;
}> {
  try {
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
    });

    const url = `${MEXC_BASE_URL}/api/v3/ticker/24hr?${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: defaultHeaders(),
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Mexc ticker/24hr API error: ${response.status} ${response.statusText} — ${text}`
      );
    }

    const data = await response.json();

    return {
      symbol: data.symbol,
      priceChange: parseFloat(data.priceChange),
      priceChangePercent: parseFloat(data.priceChangePercent),
      weightedAvgPrice: parseFloat(data.weightedAvgPrice),
      lastPrice: parseFloat(data.lastPrice),
      volume: parseFloat(data.volume),
      quoteVolume: parseFloat(data.quoteVolume),
      highPrice: parseFloat(data.highPrice),
      lowPrice: parseFloat(data.lowPrice),
      openPrice: parseFloat(data.openPrice),
      count: data.count,
    };
  } catch (error) {
    console.error('[mexc] fetch24hrTicker error:', error);
    throw error;
  }
}

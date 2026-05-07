import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Database table types
// ---------------------------------------------------------------------------

export interface Candle {
  id?: number;
  symbol: string;
  timeframe: string;
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  close_time: number;
  created_at?: string;
}

export interface Prediction {
  id?: number;
  symbol: string;
  timeframe: string;
  prediction_time?: string;
  target_time: string;
  direction: 'UP' | 'DOWN';
  confidence: number;
  stochrsi_k?: number;
  stochrsi_d?: number;
  ma_stochrsi_k?: number;
  ma_stochrsi_d?: number;
  price_at_prediction?: number;
  indicator_params?: Record<string, any>;
  evaluated?: boolean;
  outcome?: 'WIN' | 'LOSS' | 'PENDING' | null;
  created_at?: string;
}

export interface Outcome {
  id?: number;
  prediction_id: number;
  actual_direction: 'UP' | 'DOWN';
  price_at_target: number;
  price_change_pct?: number;
  result: 'WIN' | 'LOSS';
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Supabase client helpers
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Server-side Supabase client using the service role key.
 * Bypasses Row Level Security — use ONLY in API routes / server-only code.
 */
export function createServerClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      'Missing Supabase server credentials. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.'
    );
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Client-side (browser) Supabase client using the anon / public key.
 * Respects Row Level Security policies.
 */
export function createClientClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase client credentials. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

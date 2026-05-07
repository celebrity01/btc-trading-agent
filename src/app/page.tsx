'use client'

import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react'
import {
  TrendingUp, TrendingDown, Activity, BarChart3, Clock,
  ArrowUpRight, ArrowDownRight, Copy, CheckCircle2, XCircle,
  Zap, Target, ChevronUp, ChevronDown, Minus, Wifi, Loader2,
  AlertTriangle, Database
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'

// Lazy-load Recharts
import dynamic from 'next/dynamic'
const RechartsAreaChart = dynamic(
  () => import('recharts').then(mod => {
    const { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip: RT, ResponsiveContainer, ReferenceLine } = mod
    return function LazyChart({ data }: { data: WinRateDataPoint[] }) {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
            <defs>
              <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
            <RT contentStyle={{ backgroundColor: '#18181b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '11px', color: '#fafafa' }} formatter={(value: number) => [`${value.toFixed(1)}%`, 'Win Rate']} />
            <ReferenceLine y={50} stroke="rgba(255,255,255,0.15)" strokeDasharray="5 5" />
            <Area type="monotone" dataKey="winRate" stroke="#10b981" strokeWidth={2} fill="url(#wg)" dot={false} activeDot={{ r: 3, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      )
    }
  }),
  { ssr: false, loading: () => <div className="h-[220px] flex items-center justify-center"><Loader2 className="h-5 w-5 text-zinc-700 animate-spin" /></div> }
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalDetail {
  name: string
  type: 'bullish' | 'bearish' | 'neutral'
  strength: number
}

interface LatestPrediction {
  id?: number
  symbol: string
  timeframe: string
  prediction_time?: string
  target_time: string
  direction: 'UP' | 'DOWN'
  confidence: number
  stochrsi_k?: number
  stochrsi_d?: number
  ma_stochrsi_k?: number
  ma_stochrsi_d?: number
  price_at_prediction?: number
  indicator_params?: Record<string, any>
  evaluated?: boolean
  outcome?: 'WIN' | 'LOSS' | 'PENDING' | null
  created_at?: string
}

interface PerformanceData {
  total: number
  wins: number
  losses: number
  winRate: number
  avgConfidence: number
  recentWinRate: number
  streak: number
}

interface StatusData {
  price: number | null
  priceChange24h: number | null
  performance: PerformanceData | null
  latest_prediction: LatestPrediction | null
}

interface PredictionWithOutcome extends LatestPrediction {
  outcomes?: {
    id: number
    actual_direction: 'UP' | 'DOWN'
    price_at_target: number
    price_change_pct: number
    result: 'WIN' | 'LOSS'
    created_at: string
  } | null
}

interface PredictionsData {
  predictions: PredictionWithOutcome[]
  total: number
}

interface SetupDbData {
  tables: Record<string, boolean>
  setup_needed: boolean
  sql: string | null
}

interface WinRateDataPoint {
  time: string
  winRate: number
}

interface DashboardState {
  status: StatusData | null
  predictions: PredictionsData | null
  setupDb: SetupDbData | null
  loading: boolean
  refreshing: boolean
  lastUpdated: Date | null
  isPredicting: boolean
  copiedSql: boolean
  winRateHistory: WinRateDataPoint[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BULL = '#10b981'
const BEAR = '#ef4444'
const REFRESH = 30000

const INIT: DashboardState = {
  status: null,
  predictions: null,
  setupDb: null,
  loading: true,
  refreshing: false,
  lastUpdated: null,
  isPredicting: false,
  copiedSql: false,
  winRateHistory: [],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(p: number | null): string {
  if (p === null || p === undefined) return '---'
  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return '---'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function fmtTime(s: string | null | undefined): string {
  if (!s) return '---'
  try { return new Date(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '---' }
}

function fmtDT(s: string | null | undefined): string {
  if (!s) return '---'
  try { return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return '---' }
}

function ago(s: string | null | undefined): string {
  if (!s) return ''
  try {
    const d = Math.floor((Date.now() - new Date(s).getTime()) / 1000)
    if (d < 60) return `${d}s`
    if (d < 3600) return `${Math.floor(d / 60)}m`
    if (d < 86400) return `${Math.floor(d / 3600)}h`
    return `${Math.floor(d / 86400)}d`
  } catch { return '' }
}

function buildWinRate(preds: PredictionWithOutcome[]): WinRateDataPoint[] {
  if (!preds || preds.length === 0) return []
  const ev = preds.filter(p => p.outcome === 'WIN' || p.outcome === 'LOSS').reverse()
  let w = 0, t = 0
  const pts: WinRateDataPoint[] = []
  for (const p of ev) {
    t++
    if (p.outcome === 'WIN') w++
    pts.push({ time: fmtTime(p.created_at || p.prediction_time), winRate: Math.round((w / t) * 1000) / 10 })
  }
  return pts.length > 30 ? pts.filter((_, i) => i % Math.ceil(pts.length / 30) === 0 || i === pts.length - 1) : pts
}

// ---------------------------------------------------------------------------
// Memoized sub-components
// ---------------------------------------------------------------------------

const Ring = memo(function Ring({ value, size = 72, sw = 5, color = BULL }: {
  value: number; size?: number; sw?: number; color?: string
}) {
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r
  const off = c - (value / 100) * c
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.07)" strokeWidth={sw} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={sw} fill="none"
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease-out, stroke 0.4s ease' }} />
    </svg>
  )
})

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function Home() {
  const [state, setState] = useState<DashboardState>(INIT)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(false)

  const fetchStatusRef = useRef(async () => {
    try {
      const r = await fetch('/api/status')
      if (!r.ok) throw new Error()
      return (await r.json()) as StatusData
    } catch { return null }
  })

  const fetchPredsRef = useRef(async () => {
    try {
      const r = await fetch('/api/predictions?limit=50&offset=0')
      if (!r.ok) throw new Error()
      return (await r.json()) as PredictionsData
    } catch { return null }
  })

  const fetchSetupRef = useRef(async () => {
    try {
      const r = await fetch('/api/setup-db')
      if (!r.ok) throw new Error()
      return (await r.json()) as SetupDbData
    } catch { return null }
  })

  const fetchAll = useCallback(async (isRefresh = false) => {
    const [s, p, d] = await Promise.all([
      fetchStatusRef.current(),
      fetchPredsRef.current(),
      isRefresh ? Promise.resolve(null) : fetchSetupRef.current(),
    ])
    const wr = p ? buildWinRate(p.predictions || []) : []
    setState(prev => ({
      ...prev,
      status: s ?? prev.status,
      predictions: p ?? prev.predictions,
      setupDb: d ?? prev.setupDb,
      loading: false,
      refreshing: false,
      lastUpdated: new Date(),
      winRateHistory: wr.length > 0 ? wr : prev.winRateHistory,
    }))
  }, [])

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    fetchAll(false)
  }, [fetchAll])

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setState(prev => ({ ...prev, refreshing: true }))
      fetchAll(true)
    }, REFRESH)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchAll])

  const handlePredict = useCallback(async () => {
    setState(prev => ({ ...prev, isPredicting: true }))
    try {
      const r = await fetch('/api/cron/fetch-and-predict')
      const d = await r.json()
      if (d.success) await fetchAll(true)
    } catch { /* ignore */ }
    finally { setState(prev => ({ ...prev, isPredicting: false })) }
  }, [fetchAll])

  const handleCopySql = useCallback(async () => {
    if (!state.setupDb?.sql) return
    try {
      await navigator.clipboard.writeText(state.setupDb.sql)
      setState(prev => ({ ...prev, copiedSql: true }))
      setTimeout(() => setState(prev => ({ ...prev, copiedSql: false })), 2000)
    } catch { /* ignore */ }
  }, [state.setupDb?.sql])

  // Derived
  const pred = useMemo(() => state.status?.latest_prediction, [state.status])
  const perf = useMemo(() => state.status?.performance, [state.status])
  const price = useMemo(() => state.status?.price, [state.status])
  const chg = useMemo(() => state.status?.priceChange24h, [state.status])
  const isUp = chg !== null && chg !== undefined && chg >= 0
  const streakType = useMemo(() => !perf ? 'none' : perf.streak > 0 ? 'win' : perf.streak < 0 ? 'loss' : 'none', [perf])
  const streakN = useMemo(() => perf ? Math.abs(perf.streak) : 0, [perf])

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* Setup DB Banner */}
        {state.setupDb?.setup_needed && (
          <Alert className="rounded-none border-x-0 border-t-0 bg-amber-950/40 border-amber-800/40">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <AlertTitle className="text-amber-300 text-sm font-semibold">Database Setup Required</AlertTitle>
            <AlertDescription className="text-amber-200/70 mt-1.5 text-xs">
              <p className="mb-2">
                Missing tables: {Object.entries(state.setupDb.tables)
                  .filter(([, e]) => !e)
                  .map(([n]) => <Badge key={n} variant="outline" className="mr-1 border-amber-700/50 text-amber-300 text-[10px]">{n}</Badge>)}
              </p>
              {state.setupDb.sql && (
                <div className="mt-2 relative">
                  <pre className="bg-zinc-950 rounded-lg p-3 text-[11px] text-zinc-400 overflow-x-auto max-h-32 border border-amber-900/30">
                    <code>{state.setupDb.sql}</code>
                  </pre>
                  <Button size="sm" variant="outline" onClick={handleCopySql}
                    className="absolute top-2 right-2 h-6 text-[10px] bg-zinc-900 border-amber-800/50 text-amber-300 hover:bg-zinc-800">
                    {state.copiedSql ? <><CheckCircle2 className="h-3 w-3 mr-1" /> Copied</> : <><Copy className="h-3 w-3 mr-1" /> Copy SQL</>}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Header */}
        <header className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur-lg border-b border-zinc-800/50">
          <div className="max-w-5xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                  <span className="font-bold text-black text-sm">₿</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    {state.loading ? (
                      <Skeleton className="h-6 w-28 bg-zinc-800" />
                    ) : (
                      <span className="text-lg font-bold text-white font-mono">${fmtPrice(price)}</span>
                    )}
                    <Badge variant="outline" className={`text-[10px] font-semibold border-0 ${isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {isUp ? <ChevronUp className="h-2.5 w-2.5 mr-0.5" /> : <ChevronDown className="h-2.5 w-2.5 mr-0.5" />}
                      {fmtPct(chg)}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-zinc-500">BTC / USDT</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {state.lastUpdated && (
                  <span className="text-[10px] text-zinc-500 hidden sm:inline-flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />{ago(state.lastUpdated.toISOString())}
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center">
                      {state.refreshing ? <Loader2 className="h-3 w-3 text-zinc-500 animate-spin" /> : <Wifi className="h-3 w-3 text-emerald-500" />}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">Live — auto-refresh 30s</TooltipContent>
                </Tooltip>
                {state.setupDb && !state.setupDb.setup_needed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Database className="h-3.5 w-3.5 text-emerald-500" />
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Database connected</TooltipContent>
                  </Tooltip>
                )}
                <Button size="sm" onClick={handlePredict} disabled={state.isPredicting}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white border-0 shadow-lg shadow-emerald-500/15 h-8 px-3 text-xs">
                  {state.isPredicting ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running...</> : <><Zap className="h-3 w-3 mr-1" />Predict</>}
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="max-w-5xl mx-auto px-4 py-5 space-y-5">

          {/* Prediction Hero */}
          <Card className="bg-zinc-900/60 border-zinc-800/40 overflow-hidden">
            <CardContent className="p-0">
              {state.loading ? (
                <div className="p-8"><Skeleton className="h-40 w-full bg-zinc-800 rounded-xl" /></div>
              ) : (
                <div className="flex flex-col sm:flex-row">
                  {/* Direction side */}
                  <div className={`flex flex-col items-center justify-center px-8 py-7 sm:min-w-[200px] transition-colors duration-500 ${
                    pred?.direction === 'UP' ? 'bg-emerald-500/[0.07]' : 'bg-red-500/[0.07]'
                  }`}>
                    <div className="mb-1.5">
                      {pred?.direction === 'UP' ? <ArrowUpRight className="h-14 w-14 text-emerald-400" /> : <ArrowDownRight className="h-14 w-14 text-red-400" />}
                    </div>
                    <span className={`text-3xl font-black tracking-tight ${pred?.direction === 'UP' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pred?.direction || '---'}
                    </span>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">Next 30m</span>
                    <div className="mt-3 relative flex items-center justify-center">
                      <Ring value={pred?.confidence || 0} size={64} sw={4} color={pred?.direction === 'UP' ? BULL : BEAR} />
                      <span className="absolute text-sm font-bold text-white">{pred?.confidence ? `${pred.confidence}%` : '--'}</span>
                    </div>
                    <span className="text-[9px] text-zinc-500 mt-0.5">confidence</span>
                  </div>

                  {/* Details side */}
                  <div className="flex-1 p-5 space-y-3">
                    {/* Indicator values */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-zinc-800/40 rounded-lg p-3">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <Activity className="h-2.5 w-2.5" /> StochRSI
                        </div>
                        <div className="flex items-baseline gap-3">
                          <div><span className="text-[9px] text-zinc-600 block">%K</span><span className="text-base font-bold text-white font-mono">{pred?.stochrsi_k?.toFixed(1) ?? '--'}</span></div>
                          <div><span className="text-[9px] text-zinc-600 block">%D</span><span className="text-base font-bold text-white font-mono">{pred?.stochrsi_d?.toFixed(1) ?? '--'}</span></div>
                        </div>
                      </div>
                      <div className="bg-zinc-800/40 rounded-lg p-3">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <BarChart3 className="h-2.5 w-2.5" /> MA-StochRSI
                        </div>
                        <div className="flex items-baseline gap-3">
                          <div><span className="text-[9px] text-zinc-600 block">%K</span><span className="text-base font-bold text-white font-mono">{pred?.ma_stochrsi_k?.toFixed(1) ?? '--'}</span></div>
                          <div><span className="text-[9px] text-zinc-600 block">%D</span><span className="text-base font-bold text-white font-mono">{pred?.ma_stochrsi_d?.toFixed(1) ?? '--'}</span></div>
                        </div>
                      </div>
                    </div>

                    {/* Time info */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> {fmtTime(pred?.prediction_time || pred?.created_at)}</span>
                      <span className="flex items-center gap-1"><Target className="h-2.5 w-2.5" /> Target: {fmtTime(pred?.target_time)}</span>
                      {pred?.price_at_prediction && (
                        <span className="text-zinc-500">Entry: <span className="text-white font-mono font-semibold">${fmtPrice(pred.price_at_prediction)}</span></span>
                      )}
                    </div>

                    {/* Signal badges */}
                    {pred?.indicator_params?.signals && Array.isArray(pred.indicator_params.signals) && pred.indicator_params.signals.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {(pred.indicator_params.signals as SignalDetail[]).map((sig, i) => (
                          <Badge key={`${sig.name}-${i}`} variant="outline"
                            className={`text-[9px] font-medium border-0 px-2 py-0.5 ${sig.type === 'bullish' ? 'bg-emerald-500/10 text-emerald-400' : sig.type === 'bearish' ? 'bg-red-500/10 text-red-400' : 'bg-zinc-700/30 text-zinc-400'}`}>
                            {sig.type === 'bullish' ? <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> : sig.type === 'bearish' ? <TrendingDown className="h-2.5 w-2.5 mr-0.5" /> : <Minus className="h-2.5 w-2.5 mr-0.5" />}
                            {sig.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {state.loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 bg-zinc-900 rounded-xl" />)
            ) : (
              <>
                {/* Win Rate */}
                <Card className="bg-zinc-900/60 border-zinc-800/40">
                  <CardContent className="p-3 flex items-center gap-2.5">
                    <div className="relative flex items-center justify-center flex-shrink-0">
                      <Ring value={perf ? perf.winRate * 100 : 0} size={44} sw={3} color={perf && perf.winRate >= 0.5 ? BULL : BEAR} />
                      <span className="absolute text-[9px] font-bold text-white">{perf ? `${(perf.winRate * 100).toFixed(0)}` : '0'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Win Rate</span>
                      <span className={`text-lg font-bold ${perf && perf.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {perf ? `${(perf.winRate * 100).toFixed(1)}%` : '---'}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Total */}
                <Card className="bg-zinc-900/60 border-zinc-800/40">
                  <CardContent className="p-3">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Total</span>
                    <span className="text-lg font-bold text-white">{perf?.total ?? 0}</span>
                    <span className="text-[10px] text-zinc-500 ml-1.5">{perf?.wins ?? 0}W {perf?.losses ?? 0}L</span>
                  </CardContent>
                </Card>

                {/* Streak */}
                <Card className="bg-zinc-900/60 border-zinc-800/40">
                  <CardContent className="p-3">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Streak</span>
                    <div className="flex items-center gap-1">
                      {streakType === 'win' ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : streakType === 'loss' ? <TrendingDown className="h-4 w-4 text-red-400" /> : <Minus className="h-4 w-4 text-zinc-600" />}
                      <span className={`text-lg font-bold ${streakType === 'win' ? 'text-emerald-400' : streakType === 'loss' ? 'text-red-400' : 'text-zinc-400'}`}>{streakN}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Avg Confidence */}
                <Card className="bg-zinc-900/60 border-zinc-800/40">
                  <CardContent className="p-3">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Avg Confidence</span>
                    <span className="text-lg font-bold text-white">{perf ? `${(perf.avgConfidence * 100).toFixed(1)}%` : '---'}</span>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* Chart + History */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Win Rate Chart */}
            <Card className="bg-zinc-900/60 border-zinc-800/40 lg:col-span-2">
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-xs font-semibold text-zinc-300">Win Rate</span>
                </div>
                {state.loading ? (
                  <div className="h-[220px] flex items-center justify-center"><Loader2 className="h-5 w-5 text-zinc-700 animate-spin" /></div>
                ) : state.winRateHistory.length > 1 ? (
                  <RechartsAreaChart data={state.winRateHistory} />
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-zinc-600 text-xs">
                    <div className="text-center">
                      <BarChart3 className="h-8 w-8 mx-auto mb-1.5 text-zinc-700" />
                      <p>Need more data</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Prediction History */}
            <Card className="bg-zinc-900/60 border-zinc-800/40 lg:col-span-3">
              <CardContent className="p-0">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="text-xs font-semibold text-zinc-300">History</span>
                  </div>
                  {state.predictions && (
                    <span className="text-[10px] text-zinc-600">{state.predictions.total} total</span>
                  )}
                </div>
                {state.loading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full bg-zinc-800 rounded" />)}</div>
                ) : (
                  <ScrollArea className="max-h-[280px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-zinc-800/40 hover:bg-transparent">
                          <TableHead className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold h-8 py-1">Time</TableHead>
                          <TableHead className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold h-8 py-1">Dir</TableHead>
                          <TableHead className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold h-8 py-1">Conf</TableHead>
                          <TableHead className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold h-8 py-1 hidden sm:table-cell">K/D</TableHead>
                          <TableHead className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold h-8 py-1">Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.predictions?.predictions && state.predictions.predictions.length > 0 ? (
                          state.predictions.predictions.map((p, i) => {
                            const out = p.outcome || (p.outcomes?.result) || 'PENDING'
                            const isW = out === 'WIN'
                            const isL = out === 'LOSS'
                            const isUp = p.direction === 'UP'
                            return (
                              <TableRow key={p.id || i}
                                className={`border-zinc-800/30 text-xs ${isW ? 'bg-emerald-500/[0.03]' : isL ? 'bg-red-500/[0.03]' : ''}`}>
                                <TableCell className="text-[11px] text-zinc-400 font-mono py-2">{fmtDT(p.prediction_time || p.created_at)}</TableCell>
                                <TableCell>
                                  <span className={`text-[10px] font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {isUp ? '↑' : '↓'} {p.direction}
                                  </span>
                                </TableCell>
                                <TableCell className="text-[11px] font-mono text-zinc-300 py-2">{p.confidence}%</TableCell>
                                <TableCell className="text-[11px] font-mono text-zinc-500 py-2 hidden sm:table-cell">{p.stochrsi_k?.toFixed(0) ?? '--'}/{p.stochrsi_d?.toFixed(0) ?? '--'}</TableCell>
                                <TableCell>
                                  {isW ? <span className="text-emerald-400 text-[10px] font-semibold">WIN</span> :
                                   isL ? <span className="text-red-400 text-[10px] font-semibold">LOSS</span> :
                                   <span className="text-zinc-500 text-[10px]">PENDING</span>}
                                </TableCell>
                              </TableRow>
                            )
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-10 text-zinc-600 text-xs">
                              <Activity className="h-6 w-6 mx-auto mb-1.5 text-zinc-700" />
                              No predictions yet — click Predict to start
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Footer */}
          <div className="pt-2 pb-6 text-center">
            <p className="text-[10px] text-zinc-700">BTC Prediction Agent — StochRSI + MA-StochRSI — 30min timeframe</p>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}

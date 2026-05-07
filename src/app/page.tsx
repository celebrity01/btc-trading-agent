'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Database, Activity,
  BarChart3, Brain, Clock, ArrowUpRight, ArrowDownRight,
  Copy, CheckCircle2, XCircle, AlertTriangle, Zap, Target,
  ChevronUp, ChevronDown, Minus, Wifi, Loader2
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignalDetail {
  name: string
  type: 'bullish' | 'bearish' | 'neutral'
  strength: number
  description: string
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

interface LearningParamsData {
  id?: number
  rsi_period: number
  stoch_period: number
  k_smooth: number
  d_smooth: number
  ma_type: string
  ma_period: number
  overbought_threshold: number
  oversold_threshold: number
  confidence_weight_stochrsi: number
  confidence_weight_ma: number
  win_streak_adjustment: number
  loss_streak_adjustment: number
  total_predictions: number
  total_wins: number
  performance_score: number
  updated_at?: string
  is_active: boolean
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
  learning_params: LearningParamsData | null
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BULLISH_COLOR = '#00C853'
const BEARISH_COLOR = '#FF1744'
const REFRESH_INTERVAL = 30000 // 30 seconds

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return '---'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '---'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '---'
  try {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return '---'
  }
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '---'
  try {
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return '---'
  }
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diff = Math.floor((now - then) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Circular Progress Component
// ---------------------------------------------------------------------------

function CircularProgress({ value, size = 80, strokeWidth = 6, color = BULLISH_COLOR }: {
  value: number
  size?: number
  strokeWidth?: number
  color?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        stroke="rgba(255,255,255,0.1)" strokeWidth={strokeWidth} fill="none"
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        stroke={color} strokeWidth={strokeWidth} fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Stat Card Component (no animation to prevent flashing)
// ---------------------------------------------------------------------------

function StatCard({ title, value, subtitle, icon: Icon, color }: {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  color?: string
  index?: number
}) {
  return (
    <Card className="bg-zinc-900/80 border-zinc-800/60 backdrop-blur-sm hover:border-zinc-700/60 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</span>
          <Icon className="h-4 w-4 text-zinc-600" />
        </div>
        <div className="text-2xl font-bold tracking-tight" style={{ color: color || 'rgb(250 250 250)' }}>
          {value}
        </div>
        {subtitle && (
          <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Skeleton Loaders
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-950 p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-48 bg-zinc-800" />
          <Skeleton className="h-6 w-24 bg-zinc-800" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-32 bg-zinc-800" />
          <Skeleton className="h-8 w-8 bg-zinc-800 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-64 w-full bg-zinc-900 rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 bg-zinc-900 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-80 bg-zinc-900 rounded-xl" />
        <Skeleton className="h-80 bg-zinc-900 rounded-xl" />
      </div>
      <Skeleton className="h-64 w-full bg-zinc-900 rounded-xl" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard Page
// ---------------------------------------------------------------------------

export default function Home() {
  // State
  const [status, setStatus] = useState<StatusData | null>(null)
  const [predictions, setPredictions] = useState<PredictionsData | null>(null)
  const [setupDb, setSetupDb] = useState<SetupDbData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isPredicting, setIsPredicting] = useState(false)
  const [copiedSql, setCopiedSql] = useState(false)
  const [winRateHistory, setWinRateHistory] = useState<WinRateDataPoint[]>([])
  const [mounted, setMounted] = useState(false)
  const predictionsRef = useRef<PredictionWithOutcome[]>([])

  // ---------------------------------------------------------------------------
  // Data fetching — NO dependency on state to prevent re-render loops
  // ---------------------------------------------------------------------------

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status')
      if (!res.ok) throw new Error('Failed to fetch status')
      const data = await res.json()
      setStatus(data)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Failed to fetch status:', err)
    }
  }, [])

  const fetchPredictions = useCallback(async () => {
    try {
      const res = await fetch('/api/predictions?limit=50&offset=0')
      if (!res.ok) throw new Error('Failed to fetch predictions')
      const data = await res.json()
      setPredictions(data)
      predictionsRef.current = data.predictions || []
      buildWinRateChart(data.predictions)
    } catch (err) {
      console.error('Failed to fetch predictions:', err)
    }
  }, [])

  const fetchSetupDb = useCallback(async () => {
    try {
      const res = await fetch('/api/setup-db')
      if (!res.ok) throw new Error('Failed to fetch setup-db')
      const data = await res.json()
      setSetupDb(data)
    } catch (err) {
      console.error('Failed to fetch setup-db:', err)
    }
  }, [])

  const buildWinRateChart = useCallback((preds: PredictionWithOutcome[]) => {
    if (!preds || preds.length === 0) return

    const evaluated = preds
      .filter(p => p.outcome === 'WIN' || p.outcome === 'LOSS')
      .reverse()

    let wins = 0
    let total = 0
    const points: WinRateDataPoint[] = []

    for (const pred of evaluated) {
      total++
      if (pred.outcome === 'WIN') wins++
      const rate = total > 0 ? (wins / total) * 100 : 50
      points.push({
        time: formatTime(pred.created_at || pred.prediction_time),
        winRate: Math.round(rate * 10) / 10
      })
    }

    const sampled = points.length > 30
      ? points.filter((_, i) => i % Math.ceil(points.length / 30) === 0 || i === points.length - 1)
      : points

    setWinRateHistory(sampled)
  }, [])

  // Mark as mounted (client-side only)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Initial fetch — run once
  useEffect(() => {
    let cancelled = false
    const initialLoad = async () => {
      setLoading(true)
      await Promise.all([fetchStatus(), fetchPredictions(), fetchSetupDb()])
      if (!cancelled) setLoading(false)
    }
    initialLoad()
    return () => { cancelled = true }
  }, [fetchStatus, fetchPredictions, fetchSetupDb])

  // Auto-refresh — stable references, no re-render loops
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshing(true)
      Promise.all([fetchStatus(), fetchPredictions()]).finally(() => setRefreshing(false))
    }, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchPredictions])

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleNewPrediction = async () => {
    setIsPredicting(true)
    try {
      const res = await fetch('/api/cron/fetch-and-predict')
      const data = await res.json()
      if (data.success) {
        await Promise.all([fetchStatus(), fetchPredictions()])
      } else {
        console.error('Prediction failed:', data.error)
      }
    } catch (err) {
      console.error('Failed to trigger prediction:', err)
    } finally {
      setIsPredicting(false)
    }
  }

  const handleCopySql = async () => {
    if (!setupDb?.sql) return
    try {
      await navigator.clipboard.writeText(setupDb.sql)
      setCopiedSql(true)
      setTimeout(() => setCopiedSql(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const latestPred = status?.latest_prediction
  const perf = status?.performance
  const params = status?.learning_params
  const price = status?.price
  const priceChange = status?.priceChange24h
  const isUp = priceChange !== null && priceChange !== undefined && priceChange >= 0

  const streakType = perf && perf.streak > 0 ? 'win' : perf && perf.streak < 0 ? 'loss' : 'none'
  const streakCount = perf ? Math.abs(perf.streak) : 0

  // ---------------------------------------------------------------------------
  // Loading state — show skeleton only on first load, not on refreshes
  // ---------------------------------------------------------------------------

  if (loading || !mounted) {
    return <DashboardSkeleton />
  }

  // ---------------------------------------------------------------------------
  // Render — NO motion.div initial="hidden" on cards to prevent re-animation
  // ---------------------------------------------------------------------------

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        {/* ================================================================= */}
        {/* Setup DB Banner                                                    */}
        {/* ================================================================= */}
        <AnimatePresence>
          {setupDb?.setup_needed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <Alert className="rounded-none border-x-0 border-t-0 bg-amber-950/50 border-amber-700/50">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <AlertTitle className="text-amber-300 font-semibold">Database Setup Required</AlertTitle>
                <AlertDescription className="text-amber-200/80 mt-2">
                  <p className="mb-2">
                    Missing tables: {Object.entries(setupDb.tables)
                      .filter(([, exists]) => !exists)
                      .map(([name]) => <Badge key={name} variant="outline" className="mr-1 border-amber-600 text-amber-300 text-xs">{name}</Badge>)}
                  </p>
                  {setupDb.sql && (
                    <div className="mt-3 relative">
                      <pre className="bg-zinc-950/80 rounded-lg p-3 text-xs text-zinc-300 overflow-x-auto max-h-40 border border-amber-800/30">
                        <code>{setupDb.sql}</code>
                      </pre>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCopySql}
                        className="absolute top-2 right-2 bg-zinc-900 border-amber-700/50 text-amber-300 hover:bg-zinc-800 hover:text-amber-200"
                      >
                        {copiedSql ? (
                          <><CheckCircle2 className="h-3 w-3 mr-1" /> Copied</>
                        ) : (
                          <><Copy className="h-3 w-3 mr-1" /> Copy SQL</>
                        )}
                      </Button>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ================================================================= */}
        {/* Header Bar                                                         */}
        {/* ================================================================= */}
        <header className="sticky top-0 z-50 bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-800/60">
          <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Left: Logo + Price */}
              <div className="flex items-center gap-3 md:gap-5">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                    <span className="font-bold text-black text-sm">₿</span>
                  </div>
                  <span className="font-semibold text-zinc-300 hidden sm:inline text-sm">BTC Agent</span>
                </div>

                <Separator orientation="vertical" className="h-8 bg-zinc-800" />

                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl md:text-2xl font-bold tracking-tight text-white font-mono">
                        ${formatPrice(price)}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-xs font-semibold border-0 transition-colors duration-300 ${
                          isUp
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {isUp ? (
                          <ChevronUp className="h-3 w-3 mr-0.5" />
                        ) : (
                          <ChevronDown className="h-3 w-3 mr-0.5" />
                        )}
                        {formatPercent(priceChange)}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
                      BTC / USDT
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-2 md:gap-3">
                {lastUpdated && (
                  <span className="text-[11px] text-zinc-500 hidden md:inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {timeAgo(lastUpdated.toISOString())}
                  </span>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      {refreshing ? (
                        <Loader2 className="h-3 w-3 text-zinc-500 animate-spin" />
                      ) : (
                        <Wifi className="h-3 w-3 text-emerald-500" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {refreshing ? 'Refreshing...' : 'Live • Auto-refresh 30s'}
                  </TooltipContent>
                </Tooltip>

                {setupDb && !setupDb.setup_needed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1">
                        <Database className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-[10px] text-emerald-500 hidden sm:inline">DB</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>All database tables ready</TooltipContent>
                  </Tooltip>
                )}

                <Button
                  size="sm"
                  onClick={handleNewPrediction}
                  disabled={isPredicting}
                  className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white border-0 shadow-lg shadow-emerald-500/20 h-8 px-3"
                >
                  {isPredicting ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Predicting...</>
                  ) : (
                    <><Zap className="h-3.5 w-3.5 mr-1.5" /> New Prediction</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* ================================================================= */}
        {/* Main Content                                                       */}
        {/* ================================================================= */}
        <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-4 md:py-6 space-y-4 md:space-y-5">

          {/* =============================================================== */}
          {/* Section 2: Current Prediction Card — static, no re-animation    */}
          {/* =============================================================== */}
          <Card className="bg-zinc-900/70 border-zinc-800/50 backdrop-blur-sm overflow-hidden">
            <CardContent className="p-0">
              <div className="flex flex-col md:flex-row">
                {/* Direction Indicator */}
                <div className={`relative flex flex-col items-center justify-center px-6 md:px-10 py-6 md:py-8 min-w-[200px] md:min-w-[260px] transition-colors duration-500 ${
                  latestPred?.direction === 'UP'
                    ? 'bg-gradient-to-br from-emerald-600/20 to-emerald-800/10'
                    : 'bg-gradient-to-br from-red-600/20 to-red-800/10'
                }`}>
                  <div className="mb-2">
                    {latestPred?.direction === 'UP' ? (
                      <ArrowUpRight className="h-12 w-12 md:h-16 md:w-16" style={{ color: BULLISH_COLOR }} />
                    ) : (
                      <ArrowDownRight className="h-12 w-12 md:h-16 md:w-16" style={{ color: BEARISH_COLOR }} />
                    )}
                  </div>
                  <span className={`text-3xl md:text-4xl font-black tracking-tight transition-colors duration-500 ${
                    latestPred?.direction === 'UP' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {latestPred?.direction || '---'}
                  </span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">
                    {latestPred?.timeframe || '30m'} Prediction
                  </span>

                  {/* Confidence Ring */}
                  <div className="mt-4 relative flex items-center justify-center">
                    <CircularProgress
                      value={latestPred?.confidence || 0}
                      size={72}
                      strokeWidth={5}
                      color={latestPred?.direction === 'UP' ? BULLISH_COLOR : BEARISH_COLOR}
                    />
                    <span className="absolute text-sm font-bold text-white">
                      {latestPred?.confidence ? `${latestPred.confidence}%` : '--'}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1">Confidence</span>
                </div>

                {/* Prediction Details */}
                <div className="flex-1 p-4 md:p-6 space-y-4">
                  {/* Top Row: StochRSI + MA-StochRSI */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* StochRSI */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Activity className="h-3 w-3" /> StochRSI
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-zinc-800/60 rounded-lg p-2.5">
                          <span className="text-[10px] text-zinc-500 block">%K</span>
                          <span className="text-lg font-bold text-white font-mono">
                            {latestPred?.stochrsi_k?.toFixed(2) ?? '--'}
                          </span>
                        </div>
                        <div className="bg-zinc-800/60 rounded-lg p-2.5">
                          <span className="text-[10px] text-zinc-500 block">%D</span>
                          <span className="text-lg font-bold text-white font-mono">
                            {latestPred?.stochrsi_d?.toFixed(2) ?? '--'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* MA-StochRSI */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <BarChart3 className="h-3 w-3" /> MA-StochRSI
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-zinc-800/60 rounded-lg p-2.5">
                          <span className="text-[10px] text-zinc-500 block">%K</span>
                          <span className="text-lg font-bold text-white font-mono">
                            {latestPred?.ma_stochrsi_k?.toFixed(2) ?? '--'}
                          </span>
                        </div>
                        <div className="bg-zinc-800/60 rounded-lg p-2.5">
                          <span className="text-[10px] text-zinc-500 block">%D</span>
                          <span className="text-lg font-bold text-white font-mono">
                            {latestPred?.ma_stochrsi_d?.toFixed(2) ?? '--'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Confidence Bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Confidence</span>
                      <span className="text-xs font-mono font-bold text-white">{latestPred?.confidence ?? '--'}%</span>
                    </div>
                    <Progress
                      value={latestPred?.confidence ?? 0}
                      className="h-2 bg-zinc-800"
                    />
                  </div>

                  {/* Time & Price Row */}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      <span>Predicted: {formatTime(latestPred?.prediction_time || latestPred?.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Target className="h-3 w-3" />
                      <span>Target: {formatTime(latestPred?.target_time)}</span>
                    </div>
                    {latestPred?.price_at_prediction && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-zinc-500">Entry:</span>
                        <span className="text-white font-mono font-semibold">${formatPrice(latestPred.price_at_prediction)}</span>
                      </div>
                    )}
                  </div>

                  {/* Signals */}
                  {latestPred?.indicator_params?.signals && Array.isArray(latestPred.indicator_params.signals) && latestPred.indicator_params.signals.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Signal Breakdown</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(latestPred.indicator_params.signals as SignalDetail[]).map((signal, i) => (
                          <Badge
                            key={`${signal.name}-${i}`}
                            variant="outline"
                            className={`text-[10px] font-medium border-0 ${
                              signal.type === 'bullish'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : signal.type === 'bearish'
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-zinc-700/50 text-zinc-400'
                            }`}
                          >
                            {signal.type === 'bullish' ? (
                              <TrendingUp className="h-2.5 w-2.5 mr-1" />
                            ) : signal.type === 'bearish' ? (
                              <TrendingDown className="h-2.5 w-2.5 mr-1" />
                            ) : (
                              <Minus className="h-2.5 w-2.5 mr-1" />
                            )}
                            {signal.name}
                            <span className="ml-1 opacity-60">{(signal.strength * 100).toFixed(0)}%</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* =============================================================== */}
          {/* Section 3: Performance Stats Grid                               */}
          {/* =============================================================== */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard
              title="Total Predictions"
              value={perf?.total ?? 0}
              subtitle={`${perf?.wins ?? 0}W / ${perf?.losses ?? 0}L`}
              icon={BarChart3}
            />
            <Card className="bg-zinc-900/80 border-zinc-800/60 backdrop-blur-sm hover:border-zinc-700/60 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="relative flex items-center justify-center">
                  <CircularProgress
                    value={perf ? perf.winRate * 100 : 0}
                    size={56}
                    strokeWidth={4}
                    color={perf && perf.winRate >= 0.5 ? BULLISH_COLOR : BEARISH_COLOR}
                  />
                  <span className="absolute text-[10px] font-bold text-white">
                    {perf ? `${(perf.winRate * 100).toFixed(0)}` : '0'}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider block">Win Rate</span>
                  <span className={`text-xl font-bold transition-colors duration-300 ${
                    perf && perf.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {perf ? `${(perf.winRate * 100).toFixed(1)}%` : '---'}
                  </span>
                </div>
              </CardContent>
            </Card>
            <StatCard
              title="Current Streak"
              value={streakCount > 0 ? `${streakCount}` : '0'}
              subtitle={streakType === 'win' ? 'Win Streak' : streakType === 'loss' ? 'Loss Streak' : 'No Streak'}
              icon={streakType === 'win' ? TrendingUp : streakType === 'loss' ? TrendingDown : Minus}
              color={streakType === 'win' ? BULLISH_COLOR : streakType === 'loss' ? BEARISH_COLOR : undefined}
            />
            <StatCard
              title="Avg Confidence"
              value={perf ? `${(perf.avgConfidence * 100).toFixed(1)}%` : '---'}
              subtitle="Across all predictions"
              icon={Target}
            />
            <StatCard
              title="24h Win Rate"
              value={perf ? `${(perf.recentWinRate * 100).toFixed(1)}%` : '---'}
              subtitle="Recent performance"
              icon={Clock}
              color={perf && perf.recentWinRate >= 0.5 ? BULLISH_COLOR : perf && perf.recentWinRate < 0.5 ? BEARISH_COLOR : undefined}
            />
            <StatCard
              title="7d Win Rate"
              value={params ? `${(params.performance_score).toFixed(1)}%` : '---'}
              subtitle="Performance score"
              icon={Activity}
              color={params && params.performance_score >= 50 ? BULLISH_COLOR : BEARISH_COLOR}
            />
          </div>

          {/* =============================================================== */}
          {/* Section 4 & 6: Learning Params + Win Rate Chart                 */}
          {/* =============================================================== */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Learning Parameters Card */}
            <Card className="bg-zinc-900/70 border-zinc-800/50 backdrop-blur-sm h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-amber-400" />
                    <CardTitle className="text-sm font-semibold text-zinc-200">Learning Parameters</CardTitle>
                  </div>
                  {params && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] border-0 ${
                        params.total_predictions > 0 && params.total_predictions < 50
                          ? 'bg-amber-500/15 text-amber-400'
                          : 'bg-emerald-500/15 text-emerald-400'
                      }`}
                    >
                      {params.total_predictions > 0 && params.total_predictions < 50 ? 'Adapting' : 'Optimized'}
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-zinc-500 text-xs">
                  Self-optimizing indicator parameters • Updated {params?.updated_at ? timeAgo(params.updated_at) : 'never'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {params ? (
                  <>
                    <div className="grid grid-cols-4 gap-2">
                      <ParamBox label="RSI Period" value={params.rsi_period} />
                      <ParamBox label="Stoch Period" value={params.stoch_period} />
                      <ParamBox label="K Smooth" value={params.k_smooth} />
                      <ParamBox label="D Smooth" value={params.d_smooth} />
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      <ParamBox label="MA Type" value={params.ma_type} />
                      <ParamBox label="MA Period" value={params.ma_period} />
                      <ParamBox label="Overbought" value={params.overbought_threshold} />
                      <ParamBox label="Oversold" value={params.oversold_threshold} />
                    </div>

                    <Separator className="bg-zinc-800" />

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400">StochRSI Weight</span>
                        <span className="text-xs font-mono text-emerald-400">{(params.confidence_weight_stochrsi * 100).toFixed(0)}%</span>
                      </div>
                      <Progress value={params.confidence_weight_stochrsi * 100} className="h-1.5 bg-zinc-800" />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400">MA Weight</span>
                        <span className="text-xs font-mono text-amber-400">{(params.confidence_weight_ma * 100).toFixed(0)}%</span>
                      </div>
                      <Progress value={params.confidence_weight_ma * 100} className="h-1.5 bg-zinc-800" />
                    </div>

                    <Separator className="bg-zinc-800" />

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">Performance Score</span>
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="text-[10px] text-zinc-600 cursor-help">?</span>
                          </TooltipTrigger>
                          <TooltipContent>Based on historical win rate</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={params.performance_score}
                          className="h-1.5 w-20 bg-zinc-800"
                        />
                        <span className={`text-sm font-bold font-mono ${
                          params.performance_score >= 55 ? 'text-emerald-400' :
                          params.performance_score >= 45 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {params.performance_score.toFixed(1)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-zinc-800/50 rounded-lg px-3 py-2">
                        <span className="text-[10px] text-zinc-500 block">Win Streak Adj.</span>
                        <span className="text-xs font-mono text-emerald-400">+{(params.win_streak_adjustment * 100).toFixed(0)}%</span>
                      </div>
                      <div className="bg-zinc-800/50 rounded-lg px-3 py-2">
                        <span className="text-[10px] text-zinc-500 block">Loss Streak Adj.</span>
                        <span className="text-xs font-mono text-red-400">-{(params.loss_streak_adjustment * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 bg-zinc-800 rounded-lg" />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Win Rate Chart */}
            <Card className="bg-zinc-900/70 border-zinc-800/50 backdrop-blur-sm h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <CardTitle className="text-sm font-semibold text-zinc-200">Win Rate Over Time</CardTitle>
                </div>
                <CardDescription className="text-zinc-500 text-xs">
                  Cumulative win rate across evaluated predictions
                </CardDescription>
              </CardHeader>
              <CardContent>
                {winRateHistory.length > 1 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={winRateHistory} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                      <defs>
                        <linearGradient id="winRateGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={BULLISH_COLOR} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={BULLISH_COLOR} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis
                        dataKey="time"
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        tickLine={false}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: '#18181b',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#fafafa'
                        }}
                        formatter={(value: number) => [`${value.toFixed(1)}%`, 'Win Rate']}
                      />
                      <ReferenceLine
                        y={50}
                        stroke="rgba(255,255,255,0.2)"
                        strokeDasharray="5 5"
                        label={{ value: '50%', position: 'right', fill: '#71717a', fontSize: 10 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="winRate"
                        stroke={BULLISH_COLOR}
                        strokeWidth={2}
                        fill="url(#winRateGradient)"
                        dot={false}
                        activeDot={{ r: 4, fill: BULLISH_COLOR, stroke: '#fff', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-zinc-600 text-sm">
                    <div className="text-center">
                      <BarChart3 className="h-10 w-10 mx-auto mb-2 text-zinc-700" />
                      <p>Not enough data for chart</p>
                      <p className="text-xs text-zinc-700 mt-1">Win rate chart appears after evaluations</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* =============================================================== */}
          {/* Section 5: Prediction History Table                             */}
          {/* =============================================================== */}
          <Card className="bg-zinc-900/70 border-zinc-800/50 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-zinc-400" />
                  <CardTitle className="text-sm font-semibold text-zinc-200">Prediction History</CardTitle>
                </div>
                {predictions && (
                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                    {predictions.total} total
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[420px]">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800/60 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Time</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Direction</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Confidence</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold hidden sm:table-cell">StochRSI K/D</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold hidden md:table-cell">Price</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {predictions?.predictions && predictions.predictions.length > 0 ? (
                      predictions.predictions.map((pred, i) => {
                        const outcome = pred.outcome || (pred.outcomes?.result) || 'PENDING'
                        const isWin = outcome === 'WIN'
                        const isLoss = outcome === 'LOSS'
                        const isPending = outcome === 'PENDING'
                        const isUp = pred.direction === 'UP'

                        return (
                          <TableRow
                            key={pred.id || i}
                            className={`border-zinc-800/40 transition-colors ${
                              isWin ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]' :
                              isLoss ? 'bg-red-500/[0.04] hover:bg-red-500/[0.08]' :
                              'hover:bg-zinc-800/40'
                            }`}
                          >
                            <TableCell className="text-xs text-zinc-400 font-mono py-2.5">
                              {formatDateTime(pred.prediction_time || pred.created_at)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-semibold border-0 ${
                                  isUp
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'bg-red-500/15 text-red-400'
                                }`}
                              >
                                {isUp ? (
                                  <ChevronUp className="h-3 w-3 mr-0.5" />
                                ) : (
                                  <ChevronDown className="h-3 w-3 mr-0.5" />
                                )}
                                {pred.direction}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-zinc-300 py-2.5">
                              {pred.confidence}%
                            </TableCell>
                            <TableCell className="text-xs font-mono text-zinc-400 py-2.5 hidden sm:table-cell">
                              {pred.stochrsi_k?.toFixed(1) ?? '--'} / {pred.stochrsi_d?.toFixed(1) ?? '--'}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-zinc-400 py-2.5 hidden md:table-cell">
                              ${formatPrice(pred.price_at_prediction ?? null)}
                            </TableCell>
                            <TableCell>
                              {isWin ? (
                                <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[10px] font-semibold">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> WIN
                                </Badge>
                              ) : isLoss ? (
                                <Badge className="bg-red-500/15 text-red-400 border-0 text-[10px] font-semibold">
                                  <XCircle className="h-3 w-3 mr-1" /> LOSS
                                </Badge>
                              ) : (
                                <Badge className="bg-zinc-700/30 text-zinc-400 border-0 text-[10px] font-semibold">
                                  <Clock className="h-3 w-3 mr-1" /> PENDING
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-zinc-600">
                          <Activity className="h-8 w-8 mx-auto mb-2 text-zinc-700" />
                          <p className="text-sm">No predictions yet</p>
                          <p className="text-xs text-zinc-700 mt-1">Click &quot;New Prediction&quot; to get started</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* =============================================================== */}
          {/* Footer                                                           */}
          {/* =============================================================== */}
          <footer className="pt-4 pb-6 text-center">
            <p className="text-[11px] text-zinc-600">
              BTC Binary Trading Prediction Agent • Auto-refreshes every 30s • StochRSI + MA-StochRSI with Adaptive Learning
            </p>
          </footer>
        </main>
      </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Param Box Sub-Component
// ---------------------------------------------------------------------------

function ParamBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-800/50 rounded-lg px-3 py-2">
      <span className="text-[10px] text-zinc-500 block leading-tight">{label}</span>
      <span className="text-sm font-bold text-white font-mono">{value}</span>
    </div>
  )
}

export type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4"

export const ALLOWED_TIMEFRAMES: Timeframe[] = ["M15", "M30", "H1", "H4"]
export const FORBIDDEN_TIMEFRAMES: Timeframe[] = ["M1", "M5"]

export const TF_META: Record<Timeframe, { label: string; okxBar: string; seconds: number; allowed: boolean }> = {
  M1: { label: "M1", okxBar: "1m", seconds: 60, allowed: false },
  M5: { label: "M5", okxBar: "5m", seconds: 300, allowed: false },
  M15: { label: "M15", okxBar: "15m", seconds: 900, allowed: true },
  M30: { label: "M30", okxBar: "30m", seconds: 1800, allowed: true },
  H1: { label: "H1", okxBar: "1H", seconds: 3600, allowed: true },
  H4: { label: "H4", okxBar: "4H", seconds: 14400, allowed: true },
}

export interface Candle {
  /** UNIX seconds of the candle open */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  /** Authoritative closed flag coming from the exchange feed */
  isClosed: boolean
}

export interface Quote {
  last: number
  bid: number
  ask: number
  open24h: number
  high24h: number
  low24h: number
  changeAbs: number
  changePct: number
  ts: number
}

export type SignalDirection = "BUY" | "SELL" | "NO_SIGNAL"

export type RuleId = "RULE_1_CANDLE_CLOSED" | "RULE_2_EMA200" | "RULE_3_TIMEFRAME" | "RULE_4_FUNDAMENTAL" | "RULE_5_TECHNICAL"

export interface RuleCheck {
  id: RuleId
  order: number
  name: string
  passed: boolean
  blocking: boolean
  detail: string
}

export interface Confirmation {
  code: string
  label: string
  side: "BUY" | "SELL" | "NEUTRAL"
  weight: number
  detail: string
}

export interface EconomicEvent {
  id: string
  time: number
  title: string
  currency: string
  impact: "HIGH" | "MEDIUM" | "LOW"
  bias: "BULLISH_GOLD" | "BEARISH_GOLD" | "VOLATILE"
  minutesAway: number
}

export interface FundamentalAssessment {
  regime: "SAFE" | "ELEVATED" | "BLOCKED"
  riskScore: number
  bias: "BULLISH" | "BEARISH" | "NEUTRAL"
  volatilityState: "NORMAL" | "HIGH" | "EXTREME"
  atrRatio: number
  blockingReason: string | null
  upcoming: EconomicEvent[]
  notes: string[]
}

export interface LevelZone {
  kind:
    | "SUPPORT"
    | "RESISTANCE"
    | "SUPPLY"
    | "DEMAND"
    | "ORDER_BLOCK_BULL"
    | "ORDER_BLOCK_BEAR"
    | "FVG_BULL"
    | "FVG_BEAR"
    | "LIQUIDITY"
    | "PSYCHOLOGICAL"
    | "FIB"
  low: number
  high: number
  label: string
  strength: number
  touches: number
  from: number
}

export interface StructureRead {
  primaryTrend: "UP" | "DOWN" | "RANGE"
  secondaryTrend: "UP" | "DOWN" | "RANGE"
  bos: "BULLISH" | "BEARISH" | null
  choch: "BULLISH" | "BEARISH" | null
  consolidation: boolean
  channel: { upper: number; lower: number; slope: number } | null
  swingHighs: { time: number; price: number }[]
  swingLows: { time: number; price: number }[]
  breakout: "UP" | "DOWN" | null
  fakeBreakout: "UP" | "DOWN" | null
  retest: "SUPPORT" | "RESISTANCE" | null
}

export interface TradePlan {
  direction: "BUY" | "SELL"
  entry: number
  stopLoss: number
  takeProfit1: number
  takeProfit2: number
  takeProfit3: number
  riskPips: number
  rewardPips: number
  riskReward: number
}

export interface SignalResult {
  direction: SignalDirection
  symbol: string
  timeframe: Timeframe
  generatedAt: number
  analyzedCandleTime: number | null
  confidence: number
  rules: RuleCheck[]
  rejectedBy: RuleId | null
  reason: string
  confirmations: Confirmation[]
  confirmationCount: number
  patterns: string[]
  ema200: number | null
  trendFilter: "BUY_ONLY" | "SELL_ONLY" | "UNDEFINED"
  fundamental: FundamentalAssessment
  structure: StructureRead | null
  zones: LevelZone[]
  plan: TradePlan | null
}

export interface MarketPayload {
  symbol: string
  displaySymbol: string
  timeframe: Timeframe
  candles: Candle[]
  quote: Quote | null
  ema200Series: { time: number; value: number }[]
  ema50Series: { time: number; value: number }[]
  ema21Series: { time: number; value: number }[]
  signal: SignalResult
  serverTime: number
  feed: string
  error?: string
}

import { assessFundamentals } from "./fundamental"
import { atr, ema } from "./indicators"
import { buildConfirmations, detectZones, readStructure } from "./institutional"
import { detectPatterns } from "./patterns"
import type { FundamentalAssessment } from "./types"
import {
  ALLOWED_TIMEFRAMES,
  type Candle,
  type Confirmation,
  type LevelZone,
  type RuleCheck,
  type SignalResult,
  type Timeframe,
  type TradePlan,
} from "./types"

const MIN_CONFIRMATIONS = 4
const MIN_WEIGHT = 8
const MAX_CONTRADICTION_RATIO = 0.45
const EMA_TREND_PERIOD = 200

/** Empty fundamental assessment used when the engine aborts before Rule 4 could run. */
function idleFundamental() {
  return {
    regime: "BLOCKED" as const,
    riskScore: 100,
    bias: "NEUTRAL" as const,
    volatilityState: "NORMAL" as const,
    atrRatio: 0,
    blockingReason: "FUNDAMENTAL_DATA_UNAVAILABLE",
    upcoming: [],
    notes: ["Analyse fondamentale non exécutée : un verrou antérieur a déjà bloqué le signal."],
  }
}

function noSignal(
  base: {
    symbol: string
    timeframe: Timeframe
    rules: RuleCheck[]
    rejectedBy: SignalResult["rejectedBy"]
    reason: string
    analyzedCandleTime: number | null
    ema200: number | null
    trendFilter: SignalResult["trendFilter"]
  },
  extras: Partial<SignalResult> = {},
): SignalResult {
  return {
    direction: "NO_SIGNAL",
    symbol: base.symbol,
    timeframe: base.timeframe,
    generatedAt: Date.now(),
    analyzedCandleTime: base.analyzedCandleTime,
    confidence: 0,
    rules: base.rules,
    rejectedBy: base.rejectedBy,
    reason: base.reason,
    confirmations: [],
    confirmationCount: 0,
    patterns: [],
    ema200: base.ema200,
    trendFilter: base.trendFilter,
    fundamental: idleFundamental(),
    structure: null,
    zones: [],
    plan: null,
    ...extras,
  }
}

export function validateTradePlan(plan: TradePlan, maxRiskMultiple = 12): boolean {
  const values = [plan.entry, plan.stopLoss, plan.takeProfit1, plan.takeProfit2, plan.takeProfit3, plan.riskPips, plan.rewardPips, plan.riskReward]
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return false
  const risk = Math.abs(plan.entry - plan.stopLoss)
  if (risk <= 0 || risk > plan.entry * 0.1 || risk > plan.entry * maxRiskMultiple / 100) return false
  if (plan.riskReward <= 0 || Math.abs(plan.takeProfit2 - plan.entry) / risk < 1) return false
  if (plan.direction === "BUY") {
    return plan.stopLoss < plan.entry && plan.takeProfit1 > plan.entry && plan.takeProfit2 > plan.takeProfit1 && plan.takeProfit3 > plan.takeProfit2
  }
  return plan.stopLoss > plan.entry && plan.takeProfit1 < plan.entry && plan.takeProfit2 < plan.takeProfit1 && plan.takeProfit3 < plan.takeProfit2
}

function buildPlan(
  direction: "BUY" | "SELL",
  entry: number,
  atrValue: number,
  zones: LevelZone[],
  swingHigh: number | null,
  swingLow: number | null,
): TradePlan {
  // Stop loss anchored on real structure (last opposing swing) with an ATR buffer.
  const buffer = atrValue * 0.6
  let stopLoss: number
  if (direction === "BUY") {
    const structural = swingLow !== null ? swingLow - buffer : entry - atrValue * 1.8
    stopLoss = Math.min(structural, entry - atrValue * 0.9)
  } else {
    const structural = swingHigh !== null ? swingHigh + buffer : entry + atrValue * 1.8
    stopLoss = Math.max(structural, entry + atrValue * 0.9)
  }

  const risk = Math.abs(entry - stopLoss)

  // Take profits prefer the nearest opposing institutional zone, otherwise pure R multiples.
  const opposing = zones
    .filter((z) => {
      if (direction === "BUY") return ["RESISTANCE", "SUPPLY", "ORDER_BLOCK_BEAR", "LIQUIDITY"].includes(z.kind) && z.low > entry + risk * 0.8
      return ["SUPPORT", "DEMAND", "ORDER_BLOCK_BULL", "LIQUIDITY"].includes(z.kind) && z.high < entry - risk * 0.8
    })
    .sort((a, b) =>
      direction === "BUY" ? (a.low + a.high) / 2 - (b.low + b.high) / 2 : (b.low + b.high) / 2 - (a.low + a.high) / 2,
    )

  const zoneTarget = opposing[0] ? (opposing[0].low + opposing[0].high) / 2 : null
  const r = (mult: number) => (direction === "BUY" ? entry + risk * mult : entry - risk * mult)

  const takeProfit1 = zoneTarget !== null ? zoneTarget : r(1.5)
  const takeProfit2 = r(2.5)
  const takeProfit3 = r(4)
  const reward = Math.abs(takeProfit2 - entry)

  return {
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    riskPips: risk * 10,
    rewardPips: reward * 10,
    riskReward: risk > 0 ? reward / risk : 0,
  }
}

/**
 * Main signal generation engine.
 *
 * Mandatory, non-bypassable control order:
 *   1. RÈGLE N°1 — the analysed candle must be closed.
 *   2. RÈGLE N°3 — the timeframe must be allowed (M1 / M5 forbidden).
 *   3. RÈGLE N°2 — EMA200 trend filter.
 *   4. RÈGLE N°4 — mandatory real-time fundamental assessment.
 *   5. RÈGLE N°5 — mandatory institutional technical confluence.
 *
 * If a single control fails the engine returns NO_SIGNAL.
 */
export function generateSignal(allCandles: Candle[], timeframe: Timeframe, symbol: string, fundamentalAssessment?: FundamentalAssessment): SignalResult {
  const rules: RuleCheck[] = []
  const base = {
    symbol,
    timeframe,
    rules,
    rejectedBy: null as SignalResult["rejectedBy"],
    reason: "",
    analyzedCandleTime: null as number | null,
    ema200: null as number | null,
    trendFilter: "UNDEFINED" as SignalResult["trendFilter"],
  }

  // ── RÈGLE N°1 ─────────────────────────────────────────────────────────────
  // Never analyse a forming candle. Only the closed history is passed downstream.
  const closed = allCandles.filter((c) => c.isClosed)
  const forming = allCandles.filter((c) => !c.isClosed)
  const analysed = closed[closed.length - 1]

  if (!analysed) {
    rules.push({
      id: "RULE_1_CANDLE_CLOSED",
      order: 1,
      name: "Bougie clôturée",
      passed: false,
      blocking: true,
      detail: "Aucune bougie clôturée disponible dans le flux. Analyse interdite.",
    })
    return noSignal({ ...base, rejectedBy: "RULE_1_CANDLE_CLOSED", reason: "Aucune bougie clôturée : NO_SIGNAL." })
  }

  if (closed.length < EMA_TREND_PERIOD + 5) {
    rules.push({
      id: "RULE_1_CANDLE_CLOSED",
      order: 1,
      name: "Bougie clôturée",
      passed: false,
      blocking: true,
      detail: `Historique clôturé insuffisant (${closed.length} bougies) pour un calcul EMA200 fiable.`,
    })
    return noSignal({
      ...base,
      analyzedCandleTime: analysed.time,
      rejectedBy: "RULE_1_CANDLE_CLOSED",
      reason: `Historique clôturé insuffisant (${closed.length}/${EMA_TREND_PERIOD + 5}) : NO_SIGNAL.`,
    })
  }

  base.analyzedCandleTime = analysed.time
  rules.push({
    id: "RULE_1_CANDLE_CLOSED",
    order: 1,
    name: "Bougie clôturée",
    passed: true,
    blocking: true,
    detail: `Analyse sur la bougie clôturée ${new Date(analysed.time * 1000).toISOString().slice(11, 16)} UTC. ${forming.length} bougie en formation exclue.`,
  })

  // ── RÈGLE N°3 ─────────────────────────────────────────────────────────────
  const tfAllowed = ALLOWED_TIMEFRAMES.includes(timeframe)
  rules.push({
    id: "RULE_3_TIMEFRAME",
    order: 2,
    name: "Unité de temps autorisée",
    passed: tfAllowed,
    blocking: true,
    detail: tfAllowed
      ? `${timeframe} autorisée (M15, M30, H1, H4).`
      : `${timeframe} interdite. Le scan est bloqué : M1 et M5 sont refusés sans exception.`,
  })
  if (!tfAllowed) {
    return noSignal({
      ...base,
      rejectedBy: "RULE_3_TIMEFRAME",
      reason: `Unité de temps ${timeframe} interdite par la Règle N°3 : NO_SIGNAL.`,
    })
  }

  // ── RÈGLE N°2 ─────────────────────────────────────────────────────────────
  const closes = closed.map((c) => c.close)
  const emaSeries = ema(closes, EMA_TREND_PERIOD)
  const ema200 = emaSeries[emaSeries.length - 1]
  const price = analysed.close

  if (ema200 === null || ema200 === undefined) {
    rules.push({
      id: "RULE_2_EMA200",
      order: 3,
      name: "Filtre de tendance EMA 200",
      passed: false,
      blocking: true,
      detail: "EMA200 indisponible : filtre de tendance impossible.",
    })
    return noSignal({ ...base, rejectedBy: "RULE_2_EMA200", reason: "EMA200 indisponible : NO_SIGNAL." })
  }

  base.ema200 = ema200
  const trendFilter: SignalResult["trendFilter"] = price > ema200 ? "BUY_ONLY" : "SELL_ONLY"
  base.trendFilter = trendFilter
  const distance = ((price - ema200) / ema200) * 100

  rules.push({
    id: "RULE_2_EMA200",
    order: 3,
    name: "Filtre de tendance EMA 200",
    passed: true,
    blocking: true,
    detail:
      trendFilter === "BUY_ONLY"
        ? `Prix ${price.toFixed(2)} > EMA200 ${ema200.toFixed(2)} (+${distance.toFixed(2)}%) : seuls les BUY sont autorisés, tout SELL est rejeté.`
        : `Prix ${price.toFixed(2)} < EMA200 ${ema200.toFixed(2)} (${distance.toFixed(2)}%) : seuls les SELL sont autorisés, tout BUY est rejeté.`,
  })

  // ── RÈGLE N°4 ─────────────────────────────────────────────────────────────
  const fundamental = fundamentalAssessment ?? assessFundamentals(closed)
  const fundamentalPassed = fundamental.regime !== "BLOCKED"
  rules.push({
    id: "RULE_4_FUNDAMENTAL",
    order: 4,
    name: "Analyse fondamentale temps réel",
    passed: fundamentalPassed,
    blocking: true,
    detail: fundamentalPassed
      ? `Régime ${fundamental.regime} — risque ${fundamental.riskScore}/100, volatilité ${fundamental.volatilityState}, biais macro ${fundamental.bias}.`
      : (fundamental.blockingReason as string),
  })
  if (!fundamentalPassed) {
    return noSignal(
      {
        ...base,
        rejectedBy: "RULE_4_FUNDAMENTAL",
        reason: fundamental.blockingReason as string,
      },
      { fundamental },
    )
  }

  // ── RÈGLE N°5 ─────────────────────────────────────────────────────────────
  const structure = readStructure(closed)
  const zones = detectZones(closed, structure)
  const technical = buildConfirmations(closed, structure, zones)
  const patterns = detectPatterns(closed)
  const all: Confirmation[] = [...technical, ...patterns]

  const wanted: "BUY" | "SELL" = trendFilter === "BUY_ONLY" ? "BUY" : "SELL"
  const opposite = wanted === "BUY" ? "SELL" : "BUY"

  const aligned = all.filter((c) => c.side === wanted && c.weight > 0)
  const against = all.filter((c) => c.side === opposite && c.weight > 0)
  const alignedWeight = aligned.reduce((s, c) => s + c.weight, 0)
  const againstWeight = against.reduce((s, c) => s + c.weight, 0)
  const contradictionRatio = alignedWeight > 0 ? againstWeight / alignedWeight : 1
  const hasDoji = all.some((c) => c.code === "DOJI")

  const failures: string[] = []
  if (aligned.length < MIN_CONFIRMATIONS) {
    failures.push(`confirmations insuffisantes (${aligned.length}/${MIN_CONFIRMATIONS})`)
  }
  if (alignedWeight < MIN_WEIGHT) {
    failures.push(`poids de confluence insuffisant (${alignedWeight}/${MIN_WEIGHT})`)
  }
  if (contradictionRatio > MAX_CONTRADICTION_RATIO) {
    failures.push(`confirmations contradictoires (${Math.round(contradictionRatio * 100)}% de poids opposé)`)
  }
  if (structure.consolidation) {
    failures.push("marché en consolidation")
  }
  if (hasDoji) {
    failures.push("Doji d'indécision sur la bougie clôturée")
  }

  const technicalPassed = failures.length === 0
  rules.push({
    id: "RULE_5_TECHNICAL",
    order: 5,
    name: "Analyse technique institutionnelle",
    passed: technicalPassed,
    blocking: true,
    detail: technicalPassed
      ? `${aligned.length} confirmations ${wanted} alignées (poids ${alignedWeight}), contradiction ${Math.round(contradictionRatio * 100)}%.`
      : `Confluence rejetée : ${failures.join(" ; ")}.`,
  })

  if (!technicalPassed) {
    return noSignal(
      {
        ...base,
        rejectedBy: "RULE_5_TECHNICAL",
        reason: `Confluence technique insuffisante ou contradictoire : ${failures.join(" ; ")}. NO_SIGNAL.`,
      },
      { fundamental, structure, zones, confirmations: all, confirmationCount: aligned.length, patterns: patterns.map((p) => p.label) },
    )
  }

  // All five mandatory controls validated — the signal may be issued.
  const atrArr = atr(closed, 14)
  const atrValue = atrArr[atrArr.length - 1] ?? Math.abs(analysed.high - analysed.low)
  const swingHigh = structure.swingHighs.length ? structure.swingHighs[structure.swingHighs.length - 1].price : null
  const swingLow = structure.swingLows.length ? structure.swingLows[structure.swingLows.length - 1].price : null
  const plan = buildPlan(wanted, price, atrValue, zones, swingHigh, swingLow)
  if (!validateTradePlan(plan)) {
    return noSignal(
      { ...base, analyzedCandleTime: analysed.time, ema200, trendFilter, rejectedBy: "RULE_5_TECHNICAL", reason: "Plan SL/TP incohérent ou risque irréaliste : NO_SIGNAL." },
      { fundamental, structure, zones, confirmations: all, confirmationCount: aligned.length, patterns: patterns.map((p) => p.label) },
    )
  }

  const fundamentalAgrees =
    (wanted === "BUY" && fundamental.bias === "BULLISH") || (wanted === "SELL" && fundamental.bias === "BEARISH")

  let confidence = 40
  confidence += Math.min(30, alignedWeight * 1.6)
  confidence += Math.max(0, 15 - contradictionRatio * 30)
  confidence += fundamentalAgrees ? 8 : 0
  confidence -= fundamental.regime === "ELEVATED" ? 8 : 0
  confidence += plan.riskReward >= 2 ? 7 : 0
  confidence = Math.max(0, Math.min(99, Math.round(confidence)))

  return {
    direction: wanted,
    symbol,
    timeframe,
    generatedAt: Date.now(),
    analyzedCandleTime: analysed.time,
    confidence,
    rules,
    rejectedBy: null,
    reason: `Les 5 verrous obligatoires sont validés. ${aligned.length} confirmations institutionnelles alignées avec la tendance EMA200.`,
    confirmations: all,
    confirmationCount: aligned.length,
    patterns: patterns.filter((p) => p.side === wanted).map((p) => p.label),
    ema200,
    trendFilter,
    fundamental,
    structure,
    zones,
    plan,
  }
}

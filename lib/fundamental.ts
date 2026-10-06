import type { Candle, EconomicEvent, FundamentalAssessment } from "./types"

type TradingEconomicsEvent = {
  CalendarId?: number | string
  Date?: string
  Event?: string
  Country?: string
  Category?: string
  Importance?: number
  Actual?: number | string | null
  Forecast?: number | string | null
  Previous?: number | string | null
}

const CACHE_TTL_MS = 60_000
let cached: { expiresAt: number; events: EconomicEvent[] } | null = null
let inFlight: Promise<EconomicEvent[]> | null = null

function classify(event: TradingEconomicsEvent): EconomicEvent["bias"] {
  const text = `${event.Event ?? ""} ${event.Category ?? ""}`.toLowerCase()
  if (/inflation|cpi|pce|rate|interest|fomc|fed|employment|payroll|nfp|gdp/.test(text)) return "VOLATILE"
  return "VOLATILE"
}

function parseEvents(rows: TradingEconomicsEvent[], now: number): EconomicEvent[] {
  return rows.filter((row) => row.Country === "United States" || row.Country === "USD" || row.Country === "US").flatMap((row, index) => {
    const time = row.Date ? Date.parse(row.Date) : NaN
    if (!Number.isFinite(time) || time < now - 24 * 60 * 60 * 1000) return []
    const importance = Number(row.Importance ?? 0)
    const impact: EconomicEvent["impact"] = importance >= 3 ? "HIGH" : importance === 2 ? "MEDIUM" : "LOW"
    return [{
      id: String(row.CalendarId ?? `${time}-${index}`),
      time,
      title: row.Event || row.Category || "Economic event",
      currency: row.Country === "United States" ? "USD" : row.Country || "GLOBAL",
      impact,
      bias: classify(row),
      minutesAway: Math.round((time - now) / 60_000),
    }]
  })
}

async function fetchEconomicEvents(now: number): Promise<EconomicEvent[]> {
  const key = process.env.TRADING_ECONOMICS_API_KEY
  if (!key) return []
  const start = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const end = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const response = await fetch(`https://api.tradingeconomics.com/calendar/country/United States/${start}/${end}?c=${encodeURIComponent(key)}&f=json`, { cache: "no-store" })
  if (!response.ok) throw new Error(`FUNDAMENTAL_PROVIDER_HTTP_${response.status}`)
  const body = await response.json() as TradingEconomicsEvent[]
  if (!Array.isArray(body)) throw new Error("FUNDAMENTAL_DATA_INVALID")
  const events = parseEvents(body, now)
  if (!events.length) throw new Error("FUNDAMENTAL_DATA_UNAVAILABLE")
  return events
}

export async function getFundamentalAssessment(now = Date.now()): Promise<FundamentalAssessment> {
  if (cached && cached.expiresAt > now) return assessFundamentals([], now, cached.events)
  if (!inFlight) inFlight = fetchEconomicEvents(now).finally(() => { inFlight = null })
  try {
    const events = await inFlight
    cached = { events, expiresAt: now + CACHE_TTL_MS }
    return assessFundamentals([], now, events)
  } catch (error) {
    return { regime: "BLOCKED", riskScore: 100, bias: "NEUTRAL", volatilityState: "NORMAL", atrRatio: 0, blockingReason: error instanceof Error ? error.message : "FUNDAMENTAL_DATA_UNAVAILABLE", upcoming: [], notes: ["Source économique indisponible; signal bloqué."] }
  }
}

export function assessFundamentals(_candles: Candle[], _now = Date.now(), events: EconomicEvent[] = []): FundamentalAssessment {
  if (!process.env.TRADING_ECONOMICS_API_KEY) return { regime: "BLOCKED", riskScore: 100, bias: "NEUTRAL", volatilityState: "NORMAL", atrRatio: 0, blockingReason: "FUNDAMENTAL_DATA_UNAVAILABLE", upcoming: [], notes: ["Source économique réelle non configurée."] }
  if (!events.length) return { regime: "BLOCKED", riskScore: 100, bias: "NEUTRAL", volatilityState: "NORMAL", atrRatio: 0, blockingReason: "FUNDAMENTAL_DATA_UNAVAILABLE", upcoming: [], notes: ["Aucun événement USD vérifiable n’a été reçu."] }
  const highImpact = events.filter((event) => event.impact === "HIGH" && event.minutesAway >= -30 && event.minutesAway <= 240)
  return { regime: highImpact.length ? "ELEVATED" : "SAFE", riskScore: highImpact.length ? 80 : 0, bias: "NEUTRAL", volatilityState: highImpact.length ? "HIGH" : "NORMAL", atrRatio: 1, blockingReason: null, upcoming: events, notes: ["Données Trading Economics récupérées côté serveur."] }
}

export function getEconomicEvents(_now: number, _lookAheadMs?: number, _lookBehindMs?: number) { return cached?.events ?? [] }

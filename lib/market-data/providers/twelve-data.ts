import type { Candle, Quote, Timeframe } from "@/lib/types"

export const TWELVE_DATA_SYMBOL = "XAU/USD"
export const TWELVE_DATA_REQUESTED_SYMBOL = "XAUUSD"
const BASE_URL = "https://api.twelvedata.com"
const MAX_QUOTE_AGE_SECONDS = 15 * 60
const SERVER_CACHE_TTL_MS = 20_000

class TwelveDataRateLimitError extends Error {
  readonly status = 429
  constructor() {
    super("MARKET DATA TEMPORARILY RATE LIMITED")
  }
}

type CacheEntry<T> = { value: T; expiresAt: number }
const responseCache = new Map<string, CacheEntry<unknown>>()
const inFlight = new Map<string, Promise<unknown>>()

async function cachedRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = responseCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value as T
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>
  const request = load().then((value) => {
    responseCache.set(key, { value, expiresAt: Date.now() + SERVER_CACHE_TTL_MS })
    return value
  }).finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

// A completed candle is valid for its timeframe plus one interval. This keeps
// closed historical candles usable while rejecting a stale latest observation.
const maxCandleAgeSeconds = (timeframe: Timeframe) => Math.max(MAX_QUOTE_AGE_SECONDS, ({ M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400 }[timeframe]) * 2)
const UTC_TIMEZONE = "UTC"
const STALE_MARKET_MESSAGE = "MARKET DATA STALE — NO FRESH XAU/USD DATA AVAILABLE"

export type TwelveDataDiagnostic = {
  dataAgeSeconds?: number
  receivedAt?: string
  freshness: "FRESH" | "STALE" | "NOT VERIFIED"
  marketOpen?: boolean
  rateLimited?: boolean
}

let lastDiagnostic: TwelveDataDiagnostic = { freshness: "NOT VERIFIED" }

export function getTwelveDataDiagnostic(): TwelveDataDiagnostic {
  return { ...lastDiagnostic }
}

function recordDiagnostic(diagnostic: TwelveDataDiagnostic) {
  lastDiagnostic = diagnostic
}

export function clearTwelveDataCache() {
  responseCache.clear()
  inFlight.clear()
}

const intervals: Record<Timeframe, string> = { M1: "1min", M5: "5min", M15: "15min", M30: "30min", H1: "1h", H4: "4h" }

type TwelveValue = { datetime: string; open: string; high: string; low: string; close: string; volume?: string }
type TwelveTimeSeries = { meta?: { symbol?: string; interval?: string }; values?: TwelveValue[]; code?: number; message?: string }
type TwelveQuote = { symbol?: string; datetime?: string; timestamp?: number; last_quote_at?: number; is_market_open?: boolean; open?: string; high?: string; low?: string; close?: string; previous_close?: string; code?: number; message?: string }

export type TwelveDataStatus = { apiKeyConfigured: boolean; apiCall: "PASS" | "FAIL" | "NOT EXECUTED"; connected: boolean; data: "VALID" | "INVALID" | "NOT VERIFIED"; diagnostic: TwelveDataDiagnostic; reason?: string }

function numeric(value: unknown): number {
  const result = Number(value)
  if (!Number.isFinite(result) || result <= 0) throw new Error("Twelve Data returned an invalid numeric value")
  return result
}

function timestamp(value: unknown, enforceFreshness = true): number {
  const parsed = typeof value === "number" ? value : Date.parse(String(value))
  const seconds = parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : Math.floor(parsed)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > Math.floor(Date.now() / 1000) + 30) throw new Error("Twelve Data returned an invalid timestamp")
  if (enforceFreshness && Math.floor(Date.now() / 1000) - seconds > MAX_QUOTE_AGE_SECONDS) throw new Error("Twelve Data data is too old")
  return seconds
}

function assertSymbol(symbol: unknown) {
  const normalized = String(symbol).toUpperCase().replace(/[\s/]/g, "").replace(/:FOREX$/, "")
  if (normalized !== TWELVE_DATA_SYMBOL.replace("/", "")) throw new Error("Twelve Data returned the wrong symbol")
}

async function request<T>(path: string): Promise<T> {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) throw new Error("TWELVE_DATA_API_KEY is missing")
  const response = await fetch(`${BASE_URL}${path}&apikey=${encodeURIComponent(key)}`, { headers: { accept: "application/json" }, cache: "no-store" })
  if (!response.ok) {
    if (response.status === 429) {
      recordDiagnostic({ ...getTwelveDataDiagnostic(), freshness: "NOT VERIFIED", rateLimited: true })
      throw new TwelveDataRateLimitError()
    }
    throw new Error(`Twelve Data HTTP ${response.status}`)
  }
  const body = (await response.json()) as T & { code?: number | string; message?: string; status?: string }
  const code = Number(body.code)
  if ((Number.isFinite(code) && code >= 400) || body.status === "error" || body.message && !("values" in body) && !("close" in body)) {
    throw new Error(`Twelve Data error ${body.code ?? "unknown"}`)
  }
  return body
}

export async function fetchTwelveDataCandles(timeframe: Timeframe): Promise<Candle[]> {
  const body = await cachedRequest(`candles:${timeframe}`, () => request<TwelveTimeSeries>(`/time_series?symbol=${encodeURIComponent(TWELVE_DATA_SYMBOL)}&interval=${intervals[timeframe]}&outputsize=500&timezone=${UTC_TIMEZONE}&format=JSON`))
  assertSymbol(body.meta?.symbol)
  if (!body.values?.length) throw new Error("Twelve Data returned no candles")
  const candles = body.values.map((row) => {
    const time = timestamp(row.datetime, false)
    const open = numeric(row.open), high = numeric(row.high), low = numeric(row.low), close = numeric(row.close)
    if (low > open || open > high || low > close || close > high || low > high) throw new Error("Twelve Data returned inconsistent OHLC")
    const seconds = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400 }[timeframe]
    return { time, open, high, low, close, volume: Number(row.volume ?? 0), isClosed: time + seconds <= Math.floor(Date.now() / 1000) }
  }).sort((a, b) => a.time - b.time)
  const latest = candles[candles.length - 1]
  if (!latest || Math.floor(Date.now() / 1000) - latest.time > maxCandleAgeSeconds(timeframe)) {
    const age = latest ? Math.max(0, Math.floor(Date.now() / 1000) - latest.time) : undefined
    recordDiagnostic({ dataAgeSeconds: age, freshness: "STALE" })
    throw new Error(STALE_MARKET_MESSAGE)
  }
  recordDiagnostic({ dataAgeSeconds: Math.max(0, Math.floor(Date.now() / 1000) - latest.time), freshness: "FRESH" })
  return candles
}

export async function fetchTwelveDataQuote(): Promise<Quote> {
  const body = await cachedRequest("quote", () => request<TwelveQuote>(`/quote?symbol=${encodeURIComponent(TWELVE_DATA_SYMBOL)}&timezone=${UTC_TIMEZONE}&format=JSON`))
  assertSymbol(body.symbol)
  const last = numeric(body.close), open24h = numeric(body.previous_close ?? body.open)
  const ts = timestamp(body.last_quote_at ?? body.timestamp ?? body.datetime, false)
  const age = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  const marketOpen = body.is_market_open !== false
  if (!marketOpen || age > MAX_QUOTE_AGE_SECONDS) {
    recordDiagnostic({ dataAgeSeconds: age, receivedAt: new Date(ts * 1000).toISOString(), freshness: "STALE", marketOpen })
    throw new Error(STALE_MARKET_MESSAGE)
  }
  recordDiagnostic({ dataAgeSeconds: age, receivedAt: new Date(ts * 1000).toISOString(), freshness: "FRESH", marketOpen })
  return { last, bid: last, ask: last, open24h, high24h: numeric(body.high), low24h: numeric(body.low), changeAbs: last - open24h, changePct: ((last - open24h) / open24h) * 100, ts }
}

export async function verifyTwelveData(): Promise<TwelveDataStatus> {
  const apiKeyConfigured = Boolean(process.env.TWELVE_DATA_API_KEY)
  if (!apiKeyConfigured) {
    recordDiagnostic({ freshness: "NOT VERIFIED" })
    return { apiKeyConfigured, apiCall: "NOT EXECUTED", connected: false, data: "NOT VERIFIED", diagnostic: getTwelveDataDiagnostic(), reason: "TWELVE_DATA_API_KEY is missing" }
  }
  try {
    await fetchTwelveDataQuote()
    return { apiKeyConfigured, apiCall: "PASS", connected: true, data: "VALID", diagnostic: getTwelveDataDiagnostic() }
  } catch (error) {
    return { apiKeyConfigured, apiCall: "FAIL", connected: false, data: "INVALID", diagnostic: getTwelveDataDiagnostic(), reason: error instanceof Error ? error.message : "Twelve Data unavailable" }
  }
}

export function twelveDataFeedLabel() { return "Twelve Data XAU/USD" }
export function isTwelveDataSymbol(symbol: string) { return symbol === TWELVE_DATA_SYMBOL }

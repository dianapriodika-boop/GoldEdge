import { ema } from "@/lib/indicators"
import { fetchCandles, fetchQuote } from "@/lib/market-feed"
import { generateSignal } from "@/lib/signal-engine"
import { FORBIDDEN_TIMEFRAMES, TF_META, type MarketPayload, type Timeframe } from "@/lib/types"
import { requireAuthenticatedAccess } from "@/lib/access"
import { twelveDataFeedLabel } from "@/lib/market-data/providers/twelve-data"
import { NextResponse } from "next/server"
import { getFundamentalAssessment } from "@/lib/fundamental"

export const dynamic = "force-dynamic"
export const revalidate = 0

const SYMBOL = "XAU/USD"
const DISPLAY = "XAU/USD"

function isTimeframe(v: string | null): v is Timeframe {
  return v !== null && v in TF_META
}

export async function GET(request: Request) {
  const access = await requireAuthenticatedAccess()
  if (!access.ok) return NextResponse.json({ error: 'Accès non autorisé.' }, { status: access.status, headers: { 'cache-control': 'no-store' } })
  const url = new URL(request.url)
  const raw = url.searchParams.get("tf")
  if (!isTimeframe(raw)) {
    return NextResponse.json(
      { error: "TIMEFRAME_NOT_ALLOWED", code: "TIMEFRAME_NOT_ALLOWED", allowedTimeframes: ["M15", "M30", "H1", "H4"] },
      { status: 400, headers: { "cache-control": "no-store" } },
    )
  }
  const timeframe: Timeframe = raw

  // RÈGLE N°3 — the server refuses to even scan a forbidden timeframe.
  // No candle data is analysed and no signal is produced.
  if (FORBIDDEN_TIMEFRAMES.includes(timeframe)) {
    const signal = generateSignal([], timeframe, SYMBOL)
    const payload: MarketPayload = {
      symbol: SYMBOL,
      displaySymbol: DISPLAY,
      timeframe,
      candles: [],
      quote: null,
      ema200Series: [],
      ema50Series: [],
      ema21Series: [],
      signal: {
        ...signal,
        rejectedBy: "RULE_3_TIMEFRAME",
        reason: `Unité de temps ${timeframe} interdite par la Règle N°3. Le scan est bloqué côté serveur : aucune donnée n'est analysée.`,
        rules: [
          {
            id: "RULE_3_TIMEFRAME",
            order: 1,
            name: "Unité de temps autorisée",
            passed: false,
            blocking: true,
            detail: `${timeframe} interdite sans exception. Seules M15, M30, H1 et H4 sont autorisées.`,
          },
        ],
      },
      serverTime: Date.now(),
      feed: twelveDataFeedLabel(),
    }
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } })
  }

  try {
    const [candles, quote, fundamental] = await Promise.all([fetchCandles(timeframe), fetchQuote(), getFundamentalAssessment()])
    const signal = generateSignal(candles, timeframe, SYMBOL, fundamental)

    const closed = candles.filter((c) => c.isClosed)
    const closes = closed.map((c) => c.close)
    const series = (period: number) => {
      const values = ema(closes, period)
      const out: { time: number; value: number }[] = []
      values.forEach((v, i) => {
        if (v !== null) out.push({ time: closed[i].time, value: v })
      })
      return out
    }

    const payload: MarketPayload = {
      symbol: SYMBOL,
      displaySymbol: DISPLAY,
      timeframe,
      candles,
      quote,
      ema200Series: series(200),
      ema50Series: series(50),
      ema21Series: series(21),
      signal,
      serverTime: Date.now(),
      feed: twelveDataFeedLabel(),
    }

    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Flux indisponible"
    const status = message.includes("RATE LIMITED") ? 429 : 502
    return NextResponse.json(
      { error: message, code: status === 429 ? "MARKET_DATA_RATE_LIMITED" : "MARKET_DATA_UNAVAILABLE", timeframe },
      { status, headers: { "cache-control": "no-store", ...(status === 429 ? { "retry-after": "20" } : {}) } },
    )
  }
}

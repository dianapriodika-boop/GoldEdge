import { fetchTwelveDataCandles, fetchTwelveDataQuote } from "./market-data/providers/twelve-data"
import type { Candle, Quote, Timeframe } from "./types"

/** Canonical GoldEdge Pro feed: Twelve Data XAU/USD. */
export async function fetchCandles(timeframe: Timeframe): Promise<Candle[]> {
  return fetchTwelveDataCandles(timeframe)
}

export async function fetchQuote(): Promise<Quote> {
  return fetchTwelveDataQuote()
}

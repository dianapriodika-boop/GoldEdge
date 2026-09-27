import type { Candle } from "./types"

/** Exponential moving average. Returns an array aligned with input (null before seed). */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let prev = sum / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function trueRange(c: Candle, prev: Candle | undefined): number {
  if (!prev) return c.high - c.low
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const tr = candles.map((c, i) => trueRange(c, candles[i - 1]))
  return sma(tr, period)
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

/** Fractal swing detection with configurable lookback on both sides. */
export function findSwings(candles: Candle[], left = 3, right = 3) {
  const highs: { index: number; time: number; price: number }[] = []
  const lows: { index: number; time: number; price: number }[] = []
  for (let i = left; i < candles.length - right; i++) {
    const c = candles[i]
    let isHigh = true
    let isLow = true
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue
      if (candles[j].high >= c.high) isHigh = false
      if (candles[j].low <= c.low) isLow = false
    }
    if (isHigh) highs.push({ index: i, time: c.time, price: c.high })
    if (isLow) lows.push({ index: i, time: c.time, price: c.low })
  }
  return { highs, lows }
}

export function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 }
  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
    sxy += p.x * p.y
    sxx += p.x * p.x
  }
  const denom = n * sxx - sx * sx
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  return { slope, intercept: (sy - slope * sx) / n }
}

export function last<T>(arr: T[], back = 0): T | undefined {
  return arr[arr.length - 1 - back]
}

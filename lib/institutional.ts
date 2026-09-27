import { atr, findSwings, linearRegression } from "./indicators"
import type { Candle, Confirmation, LevelZone, StructureRead } from "./types"

/** Reads market structure: trends, BOS, CHoCH, consolidation, channels, breakouts, retests. */
export function readStructure(candles: Candle[]): StructureRead {
  const { highs, lows } = findSwings(candles, 3, 3)
  const closes = candles.map((c) => c.close)
  const atrArr = atr(candles, 14)
  const a = atrArr[atrArr.length - 1] ?? (candles[candles.length - 1].high - candles[candles.length - 1].low)
  const price = closes[closes.length - 1]

  // Primary trend from the slope of the last 120 closes, secondary from the last 30.
  const primarySlope = linearRegression(closes.slice(-120).map((y, x) => ({ x, y }))).slope
  const secondarySlope = linearRegression(closes.slice(-30).map((y, x) => ({ x, y }))).slope
  const primaryThreshold = a * 0.02
  const secondaryThreshold = a * 0.05

  const primaryTrend = primarySlope > primaryThreshold ? "UP" : primarySlope < -primaryThreshold ? "DOWN" : "RANGE"
  const secondaryTrend =
    secondarySlope > secondaryThreshold ? "UP" : secondarySlope < -secondaryThreshold ? "DOWN" : "RANGE"

  // BOS / CHoCH from the last two confirmed swings on each side.
  const h1 = highs[highs.length - 1]
  const h2 = highs[highs.length - 2]
  const l1 = lows[lows.length - 1]
  const l2 = lows[lows.length - 2]

  let bos: StructureRead["bos"] = null
  let choch: StructureRead["choch"] = null

  if (h1 && price > h1.price) bos = "BULLISH"
  if (l1 && price < l1.price) bos = "BEARISH"

  if (h1 && h2 && l1 && l2) {
    const wasDown = h1.price < h2.price && l1.price < l2.price
    const wasUp = h1.price > h2.price && l1.price > l2.price
    if (wasDown && price > h1.price) choch = "BULLISH"
    if (wasUp && price < l1.price) choch = "BEARISH"
  }

  // Consolidation: range of the last 20 candles compressed relative to ATR.
  const recent = candles.slice(-20)
  const rHigh = Math.max(...recent.map((c) => c.high))
  const rLow = Math.min(...recent.map((c) => c.low))
  const consolidation = rHigh - rLow < a * 3.2

  // Regression channel over the last 60 candles.
  const window = candles.slice(-60)
  const reg = linearRegression(window.map((c, x) => ({ x, y: c.close })))
  let maxDev = 0
  window.forEach((c, x) => {
    maxDev = Math.max(maxDev, Math.abs(c.close - (reg.intercept + reg.slope * x)))
  })
  const projected = reg.intercept + reg.slope * (window.length - 1)
  const channel = { upper: projected + maxDev, lower: projected - maxDev, slope: reg.slope }

  // Breakout / fake breakout / retest against the prior 20-candle range (excluding last 3).
  const base = candles.slice(-24, -3)
  const baseHigh = base.length ? Math.max(...base.map((c) => c.high)) : rHigh
  const baseLow = base.length ? Math.min(...base.map((c) => c.low)) : rLow
  const lastClosed = candles[candles.length - 1]

  let breakout: StructureRead["breakout"] = null
  let fakeBreakout: StructureRead["fakeBreakout"] = null

  if (lastClosed.close > baseHigh) breakout = "UP"
  else if (lastClosed.close < baseLow) breakout = "DOWN"

  const probes = candles.slice(-4)
  if (probes.some((c) => c.high > baseHigh) && lastClosed.close < baseHigh) fakeBreakout = "UP"
  if (probes.some((c) => c.low < baseLow) && lastClosed.close > baseLow) fakeBreakout = "DOWN"

  let retest: StructureRead["retest"] = null
  if (Math.abs(lastClosed.low - baseHigh) < a * 0.5 && lastClosed.close > baseHigh) retest = "SUPPORT"
  if (Math.abs(lastClosed.high - baseLow) < a * 0.5 && lastClosed.close < baseLow) retest = "RESISTANCE"

  return {
    primaryTrend,
    secondaryTrend,
    bos,
    choch,
    consolidation,
    channel,
    swingHighs: highs.slice(-8).map((h) => ({ time: h.time, price: h.price })),
    swingLows: lows.slice(-8).map((l) => ({ time: l.time, price: l.price })),
    breakout,
    fakeBreakout,
    retest,
  }
}

/** Clusters swing points into support / resistance zones with touch counts. */
function clusterLevels(points: { time: number; price: number }[], tolerance: number, kind: "SUPPORT" | "RESISTANCE") {
  const zones: LevelZone[] = []
  const sorted = [...points].sort((a, b) => a.price - b.price)
  let bucket: { time: number; price: number }[] = []

  const flush = () => {
    if (!bucket.length) return
    const prices = bucket.map((b) => b.price)
    const low = Math.min(...prices)
    const high = Math.max(...prices)
    zones.push({
      kind,
      low: low - tolerance * 0.25,
      high: high + tolerance * 0.25,
      label: kind === "SUPPORT" ? "Support" : "Résistance",
      strength: Math.min(100, bucket.length * 28),
      touches: bucket.length,
      from: Math.min(...bucket.map((b) => b.time)),
    })
    bucket = []
  }

  for (const p of sorted) {
    if (!bucket.length || p.price - bucket[bucket.length - 1].price <= tolerance) bucket.push(p)
    else {
      flush()
      bucket = [p]
    }
  }
  flush()
  return zones
}

/** Detects the full institutional zone set: S/R, supply/demand, order blocks, FVG, liquidity, psych, fib. */
export function detectZones(candles: Candle[], structure: StructureRead): LevelZone[] {
  const zones: LevelZone[] = []
  const atrArr = atr(candles, 14)
  const a = atrArr[atrArr.length - 1] ?? 1
  const price = candles[candles.length - 1].close
  const { highs, lows } = findSwings(candles, 3, 3)

  // Historical support / resistance
  zones.push(...clusterLevels(highs.map((h) => ({ time: h.time, price: h.price })), a * 0.9, "RESISTANCE"))
  zones.push(...clusterLevels(lows.map((l) => ({ time: l.time, price: l.price })), a * 0.9, "SUPPORT"))

  // Supply / demand zones + order blocks: last opposing candle before an impulsive move
  for (let i = candles.length - 40; i < candles.length - 2; i++) {
    if (i < 1) continue
    const base = candles[i]
    const next = candles[i + 1]
    const impulse = Math.abs(next.close - next.open)
    if (impulse < a * 1.1) continue

    const baseBear = base.close < base.open
    const baseBull = base.close > base.open

    if (baseBear && next.close > next.open && next.close > base.high) {
      zones.push({
        kind: "DEMAND",
        low: base.low,
        high: base.high,
        label: "Zone de demande",
        strength: Math.min(100, (impulse / a) * 32),
        touches: 1,
        from: base.time,
      })
      zones.push({
        kind: "ORDER_BLOCK_BULL",
        low: Math.min(base.open, base.close),
        high: Math.max(base.open, base.close),
        label: "Order Block haussier",
        strength: Math.min(100, (impulse / a) * 30),
        touches: 1,
        from: base.time,
      })
    }

    if (baseBull && next.close < next.open && next.close < base.low) {
      zones.push({
        kind: "SUPPLY",
        low: base.low,
        high: base.high,
        label: "Zone d'offre",
        strength: Math.min(100, (impulse / a) * 32),
        touches: 1,
        from: base.time,
      })
      zones.push({
        kind: "ORDER_BLOCK_BEAR",
        low: Math.min(base.open, base.close),
        high: Math.max(base.open, base.close),
        label: "Order Block baissier",
        strength: Math.min(100, (impulse / a) * 30),
        touches: 1,
        from: base.time,
      })
    }
  }

  // Fair Value Gaps — 3-candle imbalance
  for (let i = Math.max(2, candles.length - 60); i < candles.length; i++) {
    const c0 = candles[i - 2]
    const c2 = candles[i]
    if (c2.low > c0.high && c2.low - c0.high > a * 0.25) {
      zones.push({
        kind: "FVG_BULL",
        low: c0.high,
        high: c2.low,
        label: "FVG haussier",
        strength: Math.min(100, ((c2.low - c0.high) / a) * 45),
        touches: 0,
        from: c0.time,
      })
    }
    if (c0.low > c2.high && c0.low - c2.high > a * 0.25) {
      zones.push({
        kind: "FVG_BEAR",
        low: c2.high,
        high: c0.low,
        label: "FVG baissier",
        strength: Math.min(100, ((c0.low - c2.high) / a) * 45),
        touches: 0,
        from: c2.time,
      })
    }
  }

  // Liquidity pools — equal highs / equal lows
  const equal = (pts: { time: number; price: number }[], label: string) => {
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].price - pts[i - 1].price) < a * 0.18) {
        zones.push({
          kind: "LIQUIDITY",
          low: Math.min(pts[i].price, pts[i - 1].price) - a * 0.1,
          high: Math.max(pts[i].price, pts[i - 1].price) + a * 0.1,
          label,
          strength: 70,
          touches: 2,
          from: pts[i - 1].time,
        })
      }
    }
  }
  equal(highs.slice(-6), "Liquidité (sommets égaux)")
  equal(lows.slice(-6), "Liquidité (creux égaux)")

  // Psychological round levels
  for (let level = Math.floor((price - a * 6) / 25) * 25; level <= price + a * 6; level += 25) {
    if (level <= 0) continue
    const isMajor = level % 100 === 0
    zones.push({
      kind: "PSYCHOLOGICAL",
      low: level - a * 0.12,
      high: level + a * 0.12,
      label: `Niveau psychologique ${level}`,
      strength: isMajor ? 65 : 40,
      touches: 0,
      from: candles[0].time,
    })
  }

  // Fibonacci retracement / extension on the dominant leg
  const legHigh = structure.swingHighs[structure.swingHighs.length - 1]
  const legLow = structure.swingLows[structure.swingLows.length - 1]
  if (legHigh && legLow) {
    const top = Math.max(legHigh.price, legLow.price)
    const bottom = Math.min(legHigh.price, legLow.price)
    const diff = top - bottom
    const ratios: [number, string][] = [
      [0.382, "Fib 38.2%"],
      [0.5, "Fib 50%"],
      [0.618, "Fib 61.8% (OTE)"],
      [0.786, "Fib 78.6%"],
      [1.272, "Extension 127.2%"],
      [1.618, "Extension 161.8%"],
    ]
    const up = structure.primaryTrend !== "DOWN"
    for (const [r, label] of ratios) {
      const value = up ? top - diff * r : bottom + diff * r
      zones.push({
        kind: "FIB",
        low: value - a * 0.15,
        high: value + a * 0.15,
        label,
        strength: r === 0.618 ? 80 : 50,
        touches: 0,
        from: Math.min(legHigh.time, legLow.time),
      })
    }
  }

  return zones
}

/** Builds the confluence confirmation list from structure, zones and volume. */
export function buildConfirmations(candles: Candle[], structure: StructureRead, zones: LevelZone[]): Confirmation[] {
  const out: Confirmation[] = []
  const atrArr = atr(candles, 14)
  const a = atrArr[atrArr.length - 1] ?? 1
  const lastClosed = candles[candles.length - 1]
  const price = lastClosed.close

  if (structure.primaryTrend !== "RANGE") {
    out.push({
      code: "PRIMARY_TREND",
      label: `Tendance principale ${structure.primaryTrend === "UP" ? "haussière" : "baissière"}`,
      side: structure.primaryTrend === "UP" ? "BUY" : "SELL",
      weight: 3,
      detail: "Régression linéaire sur 120 bougies clôturées",
    })
  }

  if (structure.secondaryTrend !== "RANGE") {
    out.push({
      code: "SECONDARY_TREND",
      label: `Tendance secondaire ${structure.secondaryTrend === "UP" ? "haussière" : "baissière"}`,
      side: structure.secondaryTrend === "UP" ? "BUY" : "SELL",
      weight: 1,
      detail: "Régression linéaire sur 30 bougies clôturées",
    })
  }

  if (structure.bos) {
    out.push({
      code: "BOS",
      label: `Break of Structure ${structure.bos === "BULLISH" ? "haussier" : "baissier"}`,
      side: structure.bos === "BULLISH" ? "BUY" : "SELL",
      weight: 3,
      detail: "Cassure du dernier point de structure confirmé",
    })
  }

  if (structure.choch) {
    out.push({
      code: "CHOCH",
      label: `Change of Character ${structure.choch === "BULLISH" ? "haussier" : "baissier"}`,
      side: structure.choch === "BULLISH" ? "BUY" : "SELL",
      weight: 3,
      detail: "Inversion de caractère de la structure de marché",
    })
  }

  if (structure.breakout) {
    out.push({
      code: "BREAKOUT",
      label: `Cassure ${structure.breakout === "UP" ? "haussière" : "baissière"} confirmée`,
      side: structure.breakout === "UP" ? "BUY" : "SELL",
      weight: 2,
      detail: "Clôture au-delà du range de consolidation précédent",
    })
  }

  if (structure.fakeBreakout) {
    out.push({
      code: "FAKE_BREAKOUT",
      label: `Faux breakout ${structure.fakeBreakout === "UP" ? "haussier" : "baissier"}`,
      side: structure.fakeBreakout === "UP" ? "SELL" : "BUY",
      weight: 2,
      detail: "Balayage de liquidité puis retour dans le range",
    })
  }

  if (structure.retest) {
    out.push({
      code: "RETEST",
      label: `Retest de ${structure.retest === "SUPPORT" ? "support" : "résistance"}`,
      side: structure.retest === "SUPPORT" ? "BUY" : "SELL",
      weight: 2,
      detail: "Retour sur le niveau cassé avec maintien de la clôture",
    })
  }

  if (structure.consolidation) {
    out.push({
      code: "CONSOLIDATION",
      label: "Consolidation détectée",
      side: "NEUTRAL",
      weight: 0,
      detail: "Range comprimé : contexte défavorable à la prise de position",
    })
  }

  if (structure.channel) {
    const nearUpper = Math.abs(price - structure.channel.upper) < a * 0.6
    const nearLower = Math.abs(price - structure.channel.lower) < a * 0.6
    if (nearLower) {
      out.push({
        code: "CHANNEL_LOW",
        label: "Bas de canal",
        side: "BUY",
        weight: 2,
        detail: `Prix à ${structure.channel.lower.toFixed(2)}, borne basse du canal de régression`,
      })
    }
    if (nearUpper) {
      out.push({
        code: "CHANNEL_HIGH",
        label: "Haut de canal",
        side: "SELL",
        weight: 2,
        detail: `Prix à ${structure.channel.upper.toFixed(2)}, borne haute du canal de régression`,
      })
    }
  }

  // Proximity to institutional zones
  const near = zones.filter((z) => price >= z.low - a * 0.5 && price <= z.high + a * 0.5)
  const bullKinds = ["DEMAND", "ORDER_BLOCK_BULL", "FVG_BULL", "SUPPORT"]
  const bearKinds = ["SUPPLY", "ORDER_BLOCK_BEAR", "FVG_BEAR", "RESISTANCE"]

  for (const z of near) {
    if (bullKinds.includes(z.kind)) {
      out.push({
        code: `ZONE_${z.kind}`,
        label: `Réaction sur ${z.label}`,
        side: "BUY",
        weight: z.kind === "SUPPORT" ? 2 : 3,
        detail: `Zone ${z.low.toFixed(2)} – ${z.high.toFixed(2)}, force ${Math.round(z.strength)}%`,
      })
    } else if (bearKinds.includes(z.kind)) {
      out.push({
        code: `ZONE_${z.kind}`,
        label: `Réaction sur ${z.label}`,
        side: "SELL",
        weight: z.kind === "RESISTANCE" ? 2 : 3,
        detail: `Zone ${z.low.toFixed(2)} – ${z.high.toFixed(2)}, force ${Math.round(z.strength)}%`,
      })
    } else if (z.kind === "FIB" || z.kind === "PSYCHOLOGICAL" || z.kind === "LIQUIDITY") {
      out.push({
        code: `ZONE_${z.kind}`,
        label: z.label,
        side: structure.primaryTrend === "UP" ? "BUY" : structure.primaryTrend === "DOWN" ? "SELL" : "NEUTRAL",
        weight: 1,
        detail: `Confluence à ${((z.low + z.high) / 2).toFixed(2)}`,
      })
    }
  }

  // Volume confirmation when data is available
  const vols = candles.slice(-21, -1).map((c) => c.volume)
  const avgVol = vols.reduce((s, v) => s + v, 0) / Math.max(1, vols.length)
  if (avgVol > 0 && lastClosed.volume > avgVol * 1.4) {
    out.push({
      code: "VOLUME",
      label: "Volume de confirmation",
      side: lastClosed.close > lastClosed.open ? "BUY" : "SELL",
      weight: 2,
      detail: `Volume ${(lastClosed.volume / avgVol).toFixed(1)}x la moyenne 20 périodes`,
    })
  }

  return out
}

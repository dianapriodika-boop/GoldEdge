import type { Candle, Confirmation } from "./types"

interface Anatomy {
  body: number
  range: number
  upperWick: number
  lowerWick: number
  bullish: boolean
  bearish: boolean
  bodyRatio: number
}

function anatomy(c: Candle): Anatomy {
  const range = Math.max(c.high - c.low, 1e-9)
  const body = Math.abs(c.close - c.open)
  return {
    body,
    range,
    upperWick: c.high - Math.max(c.open, c.close),
    lowerWick: Math.min(c.open, c.close) - c.low,
    bullish: c.close > c.open,
    bearish: c.close < c.open,
    bodyRatio: body / range,
  }
}

/**
 * RÈGLE N°1 — this function must only ever receive candles whose `isClosed === true`.
 * It defends itself: any non-closed candle inside the window aborts detection.
 */
export function detectPatterns(closed: Candle[]): Confirmation[] {
  const out: Confirmation[] = []
  if (closed.length < 4) return out
  if (closed.some((c) => !c.isClosed)) return out

  const c0 = closed[closed.length - 1]
  const c1 = closed[closed.length - 2]
  const c2 = closed[closed.length - 3]

  const a0 = anatomy(c0)
  const a1 = anatomy(c1)
  const a2 = anatomy(c2)

  const avgRange = closed.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / Math.min(20, closed.length)

  // Marteau
  if (a0.lowerWick > a0.body * 2 && a0.upperWick < a0.body * 0.8 && a0.bodyRatio < 0.4) {
    out.push({
      code: "HAMMER",
      label: "Marteau",
      side: "BUY",
      weight: 2,
      detail: `Mèche basse ${a0.lowerWick.toFixed(2)} = ${(a0.lowerWick / a0.body).toFixed(1)}x le corps`,
    })
  }

  // Étoile filante
  if (a0.upperWick > a0.body * 2 && a0.lowerWick < a0.body * 0.8 && a0.bodyRatio < 0.4) {
    out.push({
      code: "SHOOTING_STAR",
      label: "Étoile filante",
      side: "SELL",
      weight: 2,
      detail: `Mèche haute ${a0.upperWick.toFixed(2)} = ${(a0.upperWick / a0.body).toFixed(1)}x le corps`,
    })
  }

  // Englobante haussière
  if (a1.bearish && a0.bullish && c0.close > c1.open && c0.open < c1.close) {
    out.push({
      code: "BULL_ENGULFING",
      label: "Englobante haussière",
      side: "BUY",
      weight: 3,
      detail: "La bougie clôturée englobe totalement le corps baissier précédent",
    })
  }

  // Englobante baissière
  if (a1.bullish && a0.bearish && c0.close < c1.open && c0.open > c1.close) {
    out.push({
      code: "BEAR_ENGULFING",
      label: "Englobante baissière",
      side: "SELL",
      weight: 3,
      detail: "La bougie clôturée englobe totalement le corps haussier précédent",
    })
  }

  // Doji — indécision, ne valide aucune direction
  if (a0.bodyRatio < 0.1) {
    out.push({
      code: "DOJI",
      label: "Doji",
      side: "NEUTRAL",
      weight: 0,
      detail: "Corps < 10% du range : indécision, aucune direction validée",
    })
  }

  // Étoile du matin
  if (a2.bearish && a1.bodyRatio < 0.35 && a0.bullish && c0.close > (c2.open + c2.close) / 2) {
    out.push({
      code: "MORNING_STAR",
      label: "Étoile du matin",
      side: "BUY",
      weight: 3,
      detail: "Séquence baissière → indécision → clôture haussière au-dessus du mid-corps",
    })
  }

  // Étoile du soir
  if (a2.bullish && a1.bodyRatio < 0.35 && a0.bearish && c0.close < (c2.open + c2.close) / 2) {
    out.push({
      code: "EVENING_STAR",
      label: "Étoile du soir",
      side: "SELL",
      weight: 3,
      detail: "Séquence haussière → indécision → clôture baissière sous le mid-corps",
    })
  }

  // Marubozu / bougie de momentum
  if (a0.bodyRatio > 0.85 && a0.range > avgRange * 1.2) {
    out.push({
      code: a0.bullish ? "MARUBOZU_BULL" : "MARUBOZU_BEAR",
      label: a0.bullish ? "Marubozu haussier" : "Marubozu baissier",
      side: a0.bullish ? "BUY" : "SELL",
      weight: 2,
      detail: `Corps plein ${(a0.bodyRatio * 100).toFixed(0)}% du range, amplitude > moyenne`,
    })
  }

  // Trois soldats blancs / trois corbeaux noirs
  if (a2.bullish && a1.bullish && a0.bullish && c0.close > c1.close && c1.close > c2.close) {
    out.push({
      code: "THREE_SOLDIERS",
      label: "Trois soldats blancs",
      side: "BUY",
      weight: 3,
      detail: "Trois clôtures haussières consécutives croissantes",
    })
  }
  if (a2.bearish && a1.bearish && a0.bearish && c0.close < c1.close && c1.close < c2.close) {
    out.push({
      code: "THREE_CROWS",
      label: "Trois corbeaux noirs",
      side: "SELL",
      weight: 3,
      detail: "Trois clôtures baissières consécutives décroissantes",
    })
  }

  // Pénétrante / couverture en nuage noir
  if (a1.bearish && a0.bullish && c0.open < c1.close && c0.close > (c1.open + c1.close) / 2 && c0.close < c1.open) {
    out.push({
      code: "PIERCING",
      label: "Pénétrante",
      side: "BUY",
      weight: 2,
      detail: "Ouverture sous la clôture précédente puis reprise au-delà de 50% du corps",
    })
  }
  if (a1.bullish && a0.bearish && c0.open > c1.close && c0.close < (c1.open + c1.close) / 2 && c0.close > c1.open) {
    out.push({
      code: "DARK_CLOUD",
      label: "Couverture en nuage noir",
      side: "SELL",
      weight: 2,
      detail: "Ouverture au-dessus de la clôture précédente puis chute sous 50% du corps",
    })
  }

  // Pin bar de rejet
  if (a0.lowerWick > a0.range * 0.6) {
    out.push({
      code: "REJECTION_LOW",
      label: "Rejet du bas",
      side: "BUY",
      weight: 1,
      detail: "Mèche basse > 60% du range : absorption des vendeurs",
    })
  }
  if (a0.upperWick > a0.range * 0.6) {
    out.push({
      code: "REJECTION_HIGH",
      label: "Rejet du haut",
      side: "SELL",
      weight: 1,
      detail: "Mèche haute > 60% du range : absorption des acheteurs",
    })
  }

  return out
}

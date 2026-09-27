import { NextResponse } from "next/server"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { getTwelveDataDiagnostic, verifyTwelveData } from "@/lib/market-data/providers/twelve-data"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Reports the real runtime dependency state. Optional services are explicit so
 * the UI never represents an unconfigured worker or websocket as online.
 */
function publicOrigin(value?: string) {
  if (!value) return null
  return value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`
}

function authenticationCheck() {
  const secret = process.env.BETTER_AUTH_SECRET
  const configuredUrl = publicOrigin(process.env.BETTER_AUTH_URL)
  const expectedUrl = publicOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ?? publicOrigin(process.env.VERCEL_URL) ?? publicOrigin(process.env.V0_RUNTIME_URL)
  const looksDefault = !secret || secret.length < 32 || /change[-_ ]?me|default|secret123/i.test(secret)
  const urlMatchesRuntime = Boolean(configuredUrl && expectedUrl && configuredUrl === expectedUrl)
  return { configured: Boolean(!looksDefault && urlMatchesRuntime), urlMatchesRuntime }
}

export async function GET() {
  let databaseStatus: "connected" | "unavailable" = "unavailable"
  try {
    await db.execute(sql`select 1`)
    databaseStatus = "connected"
  } catch {
    databaseStatus = "unavailable"
  }

  const authentication = authenticationCheck()
  const twelveData = await verifyTwelveData()
  const diagnostic = twelveData.diagnostic ?? getTwelveDataDiagnostic()
  const xauConnected = twelveData.connected && twelveData.data === "VALID" && diagnostic.freshness === "FRESH"
  const rateLimited = diagnostic.rateLimited === true
  const ready = databaseStatus === "connected" && authentication.configured && xauConnected
  const freshnessStatus = diagnostic.freshness === "FRESH" ? "fresh" : diagnostic.freshness === "STALE" ? "stale" : rateLimited ? "rate_limited" : "invalid"

  const response = {
    status: ready ? "ok" : "not_ready",
    database: { status: databaseStatus },
    authentication: { status: authentication.configured ? "configured" : "misconfigured" },
    twelveData: {
      configured: twelveData.apiKeyConfigured,
      provider: "Twelve Data",
      apiCall: twelveData.apiCall.toLowerCase(),
      requestedSymbol: "XAU/USD",
      assetType: "COMMODITY",
    },
    xauUsd: { status: xauConnected ? "connected" : "not_ready", symbol: "XAU/USD", dataValid: xauConnected },
    dataFreshness: { status: freshnessStatus, receivedAt: diagnostic.receivedAt ?? null, ageSeconds: diagnostic.dataAgeSeconds ?? null },
    services: {
      frontend: "online",
      api: "online",
      database: databaseStatus === "connected" ? "online" : "offline",
      authentication: authentication.configured ? "online" : "offline",
      marketData: rateLimited ? "rate_limited" : xauConnected ? "online" : "offline",
    },
    system: ready ? "READY" : rateLimited && databaseStatus === "connected" && authentication.configured ? "DEGRADED" : "NOT READY",
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(response, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } })
}

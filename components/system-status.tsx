'use client'

import { useEffect, useState } from "react"

type HealthResponse = {
  status: "ok" | "not_ready"
  checks?: Record<string, boolean | { required?: boolean; status?: string }>
  errors?: Record<string, string>
  database?: { status: string }
  authentication?: { status: string }
  twelveData?: { configured: boolean; apiCall: string }
  xauUsd?: { status: string; dataValid: boolean }
  fundamentals?: { status: string; regime?: string; blockingReason?: string | null }
  services?: { frontend?: string; api?: string; database?: string; authentication?: string; marketData?: string; fundamentals?: string }
}

const labels: Record<string, string> = {
  frontend: "Frontend",
  backend: "Backend / API",
  database: "Database",
  authentication: "Authentication",
  marketData: "Market data",
  fundamentals: "Fundamentals",
  websocket: "WebSocket",
  redis: "Redis",
  workers: "Workers",
}

export function SystemStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    let active = true
    const check = () => fetch("/api/health", { cache: "no-store" }).then((response) => response.json()).then((value: HealthResponse) => {
      if (active) setHealth(value)
    }).catch(() => {
      if (active) setHealth({ status: "not_ready", checks: { frontend: true, backend: false }, errors: { backend: "Health endpoint unavailable" } })
    })
    check()
    const interval = window.setInterval(check, 30000)
    return () => { active = false; window.clearInterval(interval) }
  }, [])

  const ready = health?.status === "ok"
  const marketRateLimited = health?.services?.marketData === "rate_limited"
  const checks = health?.checks ?? {
    frontend: { status: health?.services?.frontend ?? "online" },
    backend: { status: health?.services?.api ?? "offline" },
    database: { status: health?.services?.database ?? (health?.database?.status === "connected" ? "online" : "offline") },
    authentication: { status: health?.services?.authentication ?? (health?.authentication?.status === "configured" ? "online" : "offline") },
    marketData: { status: health?.services?.marketData ?? (health?.xauUsd?.status === "connected" && health?.twelveData?.apiCall === "pass" ? "online" : "offline") },
    fundamentals: { status: health?.services?.fundamentals ?? (health?.fundamentals?.status === "connected" ? "online" : "offline") },
    websocket: { required: false, status: "offline" },
    redis: { required: false, status: "offline" },
    workers: { required: false, status: "offline" },
  }
  const entries = Object.entries(labels)

  return <section className={`system-status ${ready ? "system-ready" : "system-not-ready"}`} aria-live="polite">
    <div className="system-status-heading"><div><p className="eyebrow">RUNTIME CONTROL PLANE</p><h2>System status</h2></div><span className="system-state"><i />{health ? (ready ? "SYSTEM READY" : marketRateLimited ? "SYSTEM DEGRADED" : "SYSTEM NOT READY") : "CHECKING SERVICES"}</span></div>
    <div className="system-status-grid">{entries.map(([key, label]) => {
      const value = checks[key]
      const state = typeof value === "object" ? value?.status : value ? "online" : "offline"
      const online = state === "online"
      const rateLimited = state === "rate_limited"
      const notRequired = typeof value === "object" && value?.required === false
      return <div className="system-status-item" key={key}><span className={online ? "status-indicator online" : rateLimited ? "status-indicator optional" : notRequired ? "status-indicator optional" : "status-indicator offline"} /> <span>{label}</span><strong>{online ? "ONLINE" : rateLimited ? "RATE LIMITED" : notRequired ? "NOT REQUIRED" : "OFFLINE"}</strong></div>
    })}</div>
    {!ready && health && <p className="system-status-detail">Certaines fonctionnalités sont temporairement indisponibles. {Object.values(health.errors ?? {})[0] ?? "Vérification des services en cours."}</p>}
  </section>
}

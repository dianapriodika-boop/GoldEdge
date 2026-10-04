'use client'

import { useEffect, useMemo, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { useTradingUi } from '@/lib/trading-store'
import type { MarketPayload, Timeframe } from '@/lib/types'
import { SystemStatus } from '@/components/system-status'

const timeframes: Timeframe[] = ['M15', 'M30', 'H1', 'H4']

function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong></div>
}

export default function Dashboard() {
  const { timeframe, setTimeframe } = useTradingUi()
  const [data, setData] = useState<MarketPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<{ user?: { email?: string } } | null>(null)

  useEffect(() => { authClient.getSession().then(({ data }) => setSession(data as typeof session)) }, [])
  useEffect(() => {
    let active = true
    fetch(`/api/market?tf=${timeframe}`, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Flux indisponible')
      return body as MarketPayload
    }).then((body) => { if (active) setData(body) }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Flux indisponible') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [timeframe])

  const visibleCandles = useMemo(() => (data?.candles ?? []).slice(-54), [data?.candles])
  const signal = data?.signal
  const direction = signal?.direction ?? 'NO_SIGNAL'
  const directionTone = direction === 'BUY' ? 'text-bull' : direction === 'SELL' ? 'text-bear' : 'text-muted-foreground'

  if (!session) return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">GE<span>•</span></div><p className="eyebrow">GOLD EDGE PRO / TERMINAL</p><h1>Analysez l&apos;or avec discipline.</h1><p className="muted">Le terminal est protégé par authentification. Créez un compte pour accéder aux données de marché.</p><a href="/sign-in" className="gold-button block text-center">Se connecter</a><a href="/sign-up" className="text-center link mt-4 block">Créer un accès</a></section></main>

  return <main className="terminal-shell">
    <aside className="sidebar"><div className="brand-mark">GE<span>•</span></div><div className="sidebar-label">WORKSPACE</div><nav><a className="nav-item active" href="#market">Market overview</a><a className="nav-item" href="#signals">Signal history</a><a className="nav-item" href="#risk">Risk controls</a></nav><div className="sidebar-bottom"><div className="online-dot" /> Feed live<br /><span>{session.user?.email}</span><button className="signout" onClick={() => authClient.signOut().then(() => location.reload())}>Se déconnecter</button></div></aside>
    <section className="terminal-content"><header className="topbar"><div><p className="eyebrow">GOLD EDGE PRO / INSTITUTIONAL TERMINAL</p><h1>XAU/USD <span className="pair-sub">Spot Gold</span></h1></div><div className="top-actions"><span className="live-pill"><i /> LIVE FEED</span><span className="clock">{data ? new Date(data.serverTime).toLocaleTimeString('fr-FR') : '—'}</span></div></header>
      <SystemStatus />
      <div className="timeframe-row"><div className="timeframe-tabs">{timeframes.map((tf) => <button key={tf} className={timeframe === tf ? 'selected' : ''} onClick={() => setTimeframe(tf)}>{tf}</button>)}</div><span className="feed-note">XAU/USD · Twelve Data · Données serveur</span></div>
      {error ? <div className="status-banner danger">{error}</div> : <><section className="quote-strip"><Metric label="LAST PRICE" value={data?.quote ? `$${data.quote.last.toFixed(2)}` : loading ? 'Loading' : '—'} /><Metric label="24H CHANGE" value={data?.quote ? `${data.quote.changePct >= 0 ? '+' : ''}${data.quote.changePct.toFixed(2)}%` : '—'} tone={data?.quote && data.quote.changePct >= 0 ? 'text-bull' : 'text-bear'} /><Metric label="SIGNAL" value={direction} tone={directionTone} /><Metric label="CONFIDENCE" value={signal ? `${signal.confidence}%` : '—'} /><Metric label="RISK / REWARD" value={signal?.plan ? `1 : ${signal.plan.riskReward.toFixed(1)}` : '—'} /></section><section className="workspace-grid"><div className="chart-panel" id="market"><div className="panel-heading"><div><p className="eyebrow">PRICE ACTION</p><h2>Market structure</h2></div><span className="chart-tag">{timeframe} · CLOSED CANDLES</span></div><div className="chart"><div className="price-axis"><span>—</span><span>—</span><span>—</span><span>—</span></div><div className="candle-field">{visibleCandles.map((candle, index) => { const bullish = candle.close >= candle.open; const height = Math.max(18, Math.min(92, Math.abs(candle.close - candle.open) * 18)); return <div className="candle" key={candle.time}><span className="wick" style={{ height: `${Math.min(100, height + 22)}%` }} /><span className={bullish ? 'body up' : 'body down'} style={{ height: `${height}%` }} /></div> })}</div><div className="chart-labels"><span>— 12:00</span><span>— 16:00</span><span>— 20:00</span><span>— 00:00</span></div></div></div><aside className="signal-panel" id="signals"><div className="panel-heading"><div><p className="eyebrow">DECISION ENGINE</p><h2>Signal state</h2></div><span className={`state-dot ${direction === 'NO_SIGNAL' ? 'neutral' : direction === 'BUY' ? 'bull' : 'bear'}`} /></div><div className={`signal-readout ${directionTone}`}><span className="signal-label">{loading ? 'SCANNING' : 'CURRENT BIAS'}</span><strong>{direction}</strong><p>{signal?.reason ?? 'Aucune décision tant que les verrous ne sont pas validés.'}</p></div><div className="rule-list">{(signal?.rules ?? [{ id: 'RULE_1_CLOSED', name: 'Bougie clôturée', passed: false }, { id: 'RULE_2_TF', name: 'Timeframe autorisé', passed: timeframes.includes(timeframe) }, { id: 'RULE_3_EMA', name: 'EMA 200', passed: false }, { id: 'RULE_4_FUNDAMENTAL', name: 'Fondamentaux', passed: false }, { id: 'RULE_5_CONFLUENCE', name: 'Confluence', passed: false }]).map((rule) => <div className="rule" key={rule.id}><span className={rule.passed ? 'check passed' : 'check'}>{rule.passed ? '✓' : '—'}</span><span>{rule.name}</span><span className={rule.passed ? 'passed-text' : 'blocked-text'}>{rule.passed ? 'PASS' : 'BLOCKED'}</span></div>)}</div></aside></section><section className="bottom-grid"><div className="panel-card" id="risk"><p className="eyebrow">TRADE PLAN</p><h2>Risk framework</h2><div className="plan-grid"><Metric label="ENTRY" value={signal?.plan?.entry ? signal.plan.entry.toFixed(2) : '—'} /><Metric label="STOP LOSS" value={signal?.plan?.stopLoss ? signal.plan.stopLoss.toFixed(2) : '—'} /><Metric label="TAKE PROFIT" value={signal?.plan?.takeProfit1 ? signal.plan.takeProfit1.toFixed(2) : '—'} /></div></div><div className="panel-card"><p className="eyebrow">MARKET CONTEXT</p><h2>Fundamental calendar</h2><div className="event-row"><span className="event-time">LIVE</span><span>Macro filter enforced server-side</span><span className="event-status">{signal?.fundamental?.bias ?? 'BLOCKED'}</span></div></div></section></>}
    </section></main>
}

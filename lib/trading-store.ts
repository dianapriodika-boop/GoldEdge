"use client"

import { create } from "zustand"
import type { Timeframe } from "./types"

export type OverlayKey = "ema" | "zones" | "fvg" | "orderBlocks" | "structure" | "fib" | "plan"

interface TradingUiState {
  timeframe: Timeframe
  chartType: "candles" | "line" | "area"
  overlays: Record<OverlayKey, boolean>
  accountBalance: number
  riskPercent: number
  setTimeframe: (tf: Timeframe) => void
  setChartType: (t: TradingUiState["chartType"]) => void
  toggleOverlay: (key: OverlayKey) => void
  setAccountBalance: (v: number) => void
  setRiskPercent: (v: number) => void
}

export const useTradingUi = create<TradingUiState>((set) => ({
  timeframe: "M15",
  chartType: "candles",
  overlays: {
    ema: true,
    zones: true,
    fvg: true,
    orderBlocks: true,
    structure: true,
    fib: false,
    plan: true,
  },
  accountBalance: 10000,
  riskPercent: 1,
  setTimeframe: (timeframe) => set({ timeframe }),
  setChartType: (chartType) => set({ chartType }),
  toggleOverlay: (key) => set((state) => ({ overlays: { ...state.overlays, [key]: !state.overlays[key] } })),
  setAccountBalance: (accountBalance) => set({ accountBalance }),
  setRiskPercent: (riskPercent) => set({ riskPercent }),
}))

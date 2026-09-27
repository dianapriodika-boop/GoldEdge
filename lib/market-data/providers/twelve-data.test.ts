import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearTwelveDataCache, fetchTwelveDataQuote, isTwelveDataSymbol, verifyTwelveData } from './twelve-data'

describe('Twelve Data XAU/USD provider', () => {
  afterEach(() => {
    clearTwelveDataCache()
    vi.unstubAllGlobals()
    delete process.env.TWELVE_DATA_API_KEY
  })

  it('keeps XAU/USD separate from PAXG-USDT', () => {
    expect(isTwelveDataSymbol('XAU/USD')).toBe(true)
    expect(isTwelveDataSymbol('PAXG-USDT')).toBe(false)
  })

  it('rejects a missing key without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await verifyTwelveData()
    expect(result.apiCall).toBe('NOT EXECUTED')
    expect(result.apiKeyConfigured).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a fresh valid quote', async () => {
    process.env.TWELVE_DATA_API_KEY = 'test-only'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      symbol: 'XAU/USD', is_market_open: true, last_quote_at: Math.floor(Date.now() / 1000) - 10,
      open: '2300', high: '2310', low: '2290', close: '2305', previous_close: '2295',
    }), { status: 200 })))
    await expect(fetchTwelveDataQuote()).resolves.toMatchObject({ last: 2305 })
  })

  it('reports Twelve Data rate limiting without retrying', async () => {
    process.env.TWELVE_DATA_API_KEY = 'test-only'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Too many requests' }), { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await verifyTwelveData()
    expect(result.apiCall).toBe('FAIL')
    expect(result.reason).toContain('RATE LIMITED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale quote and never reports it as connected', async () => {
    process.env.TWELVE_DATA_API_KEY = 'test-only'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      symbol: 'XAU/USD', is_market_open: true, last_quote_at: Math.floor(Date.now() / 1000) - 7 * 60 * 60,
      open: '2300', high: '2310', low: '2290', close: '2305', previous_close: '2295',
    }), { status: 200 })))
    const result = await verifyTwelveData()
    expect(result.connected).toBe(false)
    expect(result.diagnostic.freshness).toBe('STALE')
  })
})

import { expect, test } from '@playwright/test'

const email = process.env.E2E_TEST_EMAIL
const password = process.env.E2E_TEST_PASSWORD

test.describe('GoldEdge Pro authenticated production flow', () => {
  test.beforeAll(() => {
    if (!email || !password) {
      throw new Error('E2E_TEST_EMAIL and E2E_TEST_PASSWORD are required CI secrets')
    }
  })

  test('signs in, reads protected market data, and signs out', async ({ page, request }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email professionnel').fill(email as string)
    await page.getByLabel('Mot de passe').fill(password as string)
    await page.getByRole('button', { name: 'Ouvrir le terminal' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('XAU/USD', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('LIVE FEED')).toBeVisible()

    const sessionResponse = await page.request.get('/api/auth/get-session')
    expect(sessionResponse.status()).toBe(200)
    expect((await sessionResponse.json()).user).toBeTruthy()

    for (const timeframe of ['M15', 'M30', 'H1', 'H4']) {
      const response = await page.request.get(`/api/market?tf=${timeframe}`)
      expect(response.status(), timeframe).toBe(200)
      const body = await response.json()
      expect(body.quote).toBeTruthy()
      expect(body.candles?.length).toBeGreaterThan(0)
      expect(body.feed).toContain('Twelve Data')
      expect(body.displaySymbol).toBe('XAU/USD')
      expect(body.symbol).toBe('XAUUSD')
    }

    for (const timeframe of ['M1', 'M5']) {
      const response = await page.request.get(`/api/market?tf=${timeframe}`)
      expect(response.status(), timeframe).toBe(200)
      const body = await response.json()
      expect(body.candles).toEqual([])
      expect(body.quote).toBeNull()
      expect(body.signal.rejectedBy).toBe('RULE_3_TIMEFRAME')
    }

    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible()

    const protectedResponse = await request.get(`${process.env.E2E_BASE_URL ?? 'https://goldedge-red.vercel.app'}/api/market?timeframe=M15`)
    expect(protectedResponse.status()).toBe(401)
  })
})

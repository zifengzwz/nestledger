import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
const screenshots = new URL('../../docs/screenshots/', import.meta.url).pathname

const THEMES = ['clay', 'forest', 'blue', 'plum', 'coral', 'mango', 'mint', 'berry', 'contrast-ink', 'contrast-navy', 'contrast-wine']

async function contrastSamples(page) {
  return page.evaluate(() => {
    // getComputedStyle may return rgb(), rgba(), color(srgb r g b / a) or, for
    // design tokens read from custom properties, a plain hex string.
    const rgb = text => {
      const value = String(text).trim()
      if (value.startsWith('#')) {
        const hex = value.length === 4
          ? value.slice(1).split('').map(char => char + char).join('')
          : value.slice(1, 7)
        return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16))
      }
      const nums = (value.match(/[\d.]+/g) || []).map(Number)
      if (value.startsWith('color(srgb')) {
        const [r, g, b, a] = nums
        return [r * 255, g * 255, b * 255, a === undefined ? 1 : a]
      }
      return nums.length === 4 ? nums : (nums.length === 3 ? [...nums, 1] : nums)
    }
    const lum = channels => channels.slice(0, 3).map(value => {
      const c = value / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
    const token = name => getComputedStyle(document.documentElement).getPropertyValue(name)
    const surfaceFor = (style, node) => node.matches('.stat-card.balance')
      ? rgb(token('--balance-hi'))
      : lum(rgb(style.color).slice(0, 3)) > 0.5
      ? rgb(token('--accent-fill'))
      : rgb(token('--surface'))
    const out = []
    const pairs = [
      ['sidebar nav button', '.sidebar nav button'],
      ['active nav', '.sidebar nav button.active'],
      ['book name', '.book-name'],
      ['profile name', '.profile strong'],
      ['stat label', '.stat-label'],
      ['stat value', '.stat-card > strong'],
      ['balance value', '.stat-card.balance > strong'],
      ['primary button', '.page-heading .primary'],
      ['muted footnote', '.page-footer'],
    ]
    for (const [name, selector] of pairs) {
      const element = document.querySelector(selector)
      if (!element) continue
      const style = getComputedStyle(element)
      let bg = rgb(style.backgroundColor)
      const alpha = bg[3] ?? 1
      if (style.backgroundImage.includes('gradient')) {
        bg = surfaceFor(style, element)
      } else if (bg.length < 3 || alpha < 1) {
        let node = element.parentElement
        while (node) {
          const styleParent = getComputedStyle(node)
          const parent = rgb(styleParent.backgroundColor)
          if (styleParent.backgroundImage.includes('gradient')) {
            bg = surfaceFor(styleParent, node)
            break
          }
          if (parent.length >= 3 && (parent[3] ?? 1) >= 1) { bg = parent; break }
          node = node.parentElement
        }
      }
      if (bg.length < 3) continue
      const fgRaw = rgb(style.color)
      const fgAlpha = fgRaw[3] ?? 1
      const fg = fgRaw.slice(0, 3).map((channel, i) => channel * fgAlpha + bg[i] * (1 - fgAlpha))
      const a = lum(fg), b = lum(bg)
      out.push({ name, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })
    }
    return out
  })
}
async function tokens(page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    const value = name => style.getPropertyValue(name).trim()
    return {
      theme: document.documentElement.dataset.theme,
      accent: value('--accent'),
      accentStrong: value('--accent-strong'),
      income: value('--income'),
      balance: value('--balance-deep'),
      surface: value('--surface'),
    }
  })
}

test('十一种色调可自选、跨设备同步且不影响布局', async ({ page, browser }) => {
  await page.goto('/')
  const origin = new URL(page.url()).origin
  const headers = { Origin: origin }
  const phone = `186${String(randomInt(100000000)).padStart(8, '0')}`
  const password = 'Theme-Switch-2026!'
  const registration = await registerWithSms(page.request, { headers, data: { phone, password, name: '色调体验用户' } })
  expect(registration.status()).toBe(201)
  const created = await page.request.post('/api/books', { headers, data: { name: '色调验证账本', type: 'personal' } })
  expect(created.status()).toBe(201)
  const book = (await created.json()).data
  try {
    for (const [type, category, amountCents, occurrence] of [
      ['income', '工资薪酬', 880000, '2026-11-17T02:00:00.000Z'],
      ['expense', '餐饮美食', 12800, '2026-11-17T04:00:00.000Z'],
    ]) {
      const response = await page.request.post(`/api/books/${book.id}/records`, { headers, data: {
        type, category, amountCents, occurredAt: occurrence, note: '色调测试', paymentSource: '微信',
      } })
      expect(response.status()).toBe(201)
    }
    await page.reload()
    await page.getByLabel('分析日期', { exact: true }).fill('2026-11-17')
    await expect(page.getByRole('heading', { name: '生活有数，心里有底' })).toBeVisible()

    const initial = await tokens(page)
    expect(initial.theme).toBe('clay')
    expect(initial.accent).toBe('#bf572c')
    const seenAccents = new Set()
    await page.getByRole('button', { name: /色调体验用户.*账户与安全/ }).click()
    await expect(page.getByRole('radiogroup', { name: '界面色调' })).toBeVisible()
    expect(await page.locator('[data-theme-choice]').count()).toBe(THEMES.length)

    for (const theme of [...THEMES, 'clay']) {
      const live = await page.request.get('/api/auth/me')
      expect(live.status()).toBe(200)
      const choice = page.locator(`[data-theme-choice="${theme}"]`)
      if ((await choice.getAttribute('aria-checked')) !== 'true') {
        const saving = page.waitForResponse(response => response.url().endsWith('/api/auth/settings') && response.request().method() === 'PATCH')
        await choice.click()
        const response = await saving
        expect(response.status()).toBe(200)
        expect(response.request().postDataJSON()).toEqual({ theme })
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator(`[data-theme-choice="${theme}"]`)).toHaveAttribute('aria-checked', 'true')
      const now = await tokens(page)
      if (theme !== 'clay') {
        await mkdir(screenshots, { recursive: true })
        await page.getByRole('button', { name: '账本概览', exact: true }).click()
        if (theme.startsWith('contrast-')) {
          await expect(page.locator('.stat-card.balance > strong')).toBeVisible()
          await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
          for (const sample of await contrastSamples(page)) {
            expect(sample.ratio, `${theme} ${sample.name}`).toBeGreaterThanOrEqual(7)
          }
        }
        await page.screenshot({ path: `${screenshots}/theme-${theme}-desktop.png`, fullPage: true, animations: 'disabled' })
        await page.getByRole('button', { name: /色调体验用户.*账户与安全/ }).click()
      }
      expect(now.theme).toBe(theme)
      seenAccents.add(now.accent)
      expect(now.accent).toMatch(/^#[0-9a-f]{6}$/i)
      expect(now.income).not.toBe(now.accent)
      for (const sample of await contrastSamples(page)) {
        expect(sample.ratio, `${theme} ${sample.name}`).toBeGreaterThanOrEqual(4.5)
      }
      // Geometry must not change between themes.
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect() ?? null
        const filter = document.querySelector('.filter-form input')
        return {
          scrollWidth: document.documentElement.scrollWidth,
          width: window.innerWidth,
          sidebar: rect('.sidebar')?.width,
        }
      })
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width)
      expect(geometry.sidebar).toBe(242)
      await page.getByRole('button', { name: '账本概览', exact: true }).click()
      await page.getByRole('button', { name: '收支明细', exact: true }).click()
      const filterHeight = await page.locator('.filter-form input').first().evaluate(el => el.getBoundingClientRect().height)
      expect(filterHeight).toBe(40)
      await page.getByRole('button', { name: /色调体验用户.*账户与安全/ }).click()
    }
    expect(seenAccents.size).toBe(THEMES.length)

    // Persisted on the account, not only in this browser's localStorage.
    const saved = await page.request.get('/api/auth/me')
    expect((await saved.json()).data.theme).toBe('clay')
    await page.getByRole('button', { name: /色调体验用户.*账户与安全/ }).click()
    const pick = page.waitForResponse(response => response.url().endsWith('/api/auth/settings') && response.request().method() === 'PATCH')
    await page.locator('[data-theme-choice="contrast-navy"]').click()
    await pick
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast-navy')

    const context = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })
    try {
      const mobile = await context.newPage()
      const login = await mobile.request.post('/api/auth/login', { headers, data: { phone, password } })
      expect(login.status()).toBe(200)
      await mobile.goto('/')
      await expect(mobile.locator('html')).toHaveAttribute('data-theme', 'contrast-navy')
      await mobile.getByRole('button', { name: '打开导航', exact: true }).tap()
      await mobile.getByRole('button', { name: /色调体验用户.*账户与安全/ }).tap()
      await expect(mobile.getByRole('radiogroup', { name: '界面色调' })).toBeVisible()
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
      await mobile.locator('[data-theme-choice="plum"]').tap()
      await expect(mobile.locator('html')).toHaveAttribute('data-theme', 'plum')
      await mobile.getByRole('button', { name: '打开导航', exact: true }).tap()
      await mobile.getByRole('button', { name: '账本概览', exact: true }).tap()
      await mobile.screenshot({ path: `${screenshots}/theme-plum-mobile.png`, fullPage: true, animations: 'disabled' })
    } finally { await context.close() }

    // Corrupt local preference must not break the app or override the account.
    await page.evaluate(() => localStorage.setItem('nestledger.theme', '{oops'))
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'plum')
    await expect(page.getByRole('heading', { name: '生活有数，心里有底' })).toBeVisible()
  } finally {
    const deleted = await page.request.delete(`/api/books/${book.id}`, { headers, data: {} })
    expect(deleted.status()).toBe(200)
  }
})

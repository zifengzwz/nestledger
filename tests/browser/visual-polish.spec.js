import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
const screenshots = new URL('../../docs/screenshots/', import.meta.url).pathname

test('美化后的桌面小屏和手机布局清晰且不溢出', async ({ page }) => {
  await mkdir(screenshots, { recursive: true })
  await page.goto('/')
  const headers = { Origin: new URL(page.url()).origin }
  const registration = await registerWithSms(page.request, { headers, data: {
    phone: `188${String(randomInt(100000000)).padStart(8, '0')}`, password: 'Visual-Polish-2026!', name: '小家体验用户',
  } })
  expect(registration.status()).toBe(201)
  const created = await page.request.post('/api/books', { headers, data: { name: '小家的生活', type: 'family' } })
  expect(created.status()).toBe(201)
  const book = (await created.json()).data
  try {
    for (const [type, amountCents, category, note] of [
      ['income', 1200000, '工资薪酬', '认真工作的回响'],
      ['expense', 3850, '餐饮美食', '一家人的暖心晚餐'],
      ['expense', 12880, '日用百货', '周末添置生活用品'],
    ]) {
      const response = await page.request.post(`/api/books/${book.id}/records`, { headers, data: {
        type, amountCents, category, note, occurredAt: '2026-11-17T12:00:00.000Z', paymentSource: '微信',
      } })
      expect(response.status()).toBe(201)
    }
    await page.reload()
    await page.getByLabel('分析日期', { exact: true }).fill('2026-11-17')
    await expect(page.locator('.stats-grid')).toContainText('12,000.00')
    await expect(page.locator('.stats-grid')).toContainText('167.30')
    await page.getByRole('heading', { name: '生活有数，心里有底', exact: true }).click()
    if (['blue', 'warm'].includes(process.env.NESTLEDGER_VISUAL_THEME)) {
      const color = await page.evaluate(() => {
        const swatch = document.createElement('span')
        swatch.style.color = getComputedStyle(document.documentElement).getPropertyValue('--green').trim()
        document.body.append(swatch)
        const color = getComputedStyle(swatch).color
        swatch.remove()
        return color.match(/\d+/g).map(Number)
      })
      if (process.env.NESTLEDGER_VISUAL_THEME === 'blue') {
        expect(color[2]).toBeGreaterThan(color[0])
        expect(color[2]).toBeGreaterThan(color[1])
      } else {
        expect(color[0]).toBeGreaterThan(color[1])
        expect(color[1]).toBeGreaterThan(color[2])
      }
      const contrast = await page.evaluate(() => {
        const rgb = text => (text.match(/[\d.]+/g) || []).map(Number)
        const lum = channels => channels.slice(0, 3).map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
        const output = []
        for (const selector of ['.sidebar nav button.active', '.book-option[aria-selected="true"]', '.segmented button.active', '.payment-tag', '.avatar.small', '.count-label']) {
          const element = document.querySelector(selector)
          const style = getComputedStyle(element)
          const bg = rgb(style.backgroundColor), raw = rgb(style.color)
          if (bg.length < 3 || (bg[3] ?? 1) < 1) continue
          const alpha = raw[3] ?? 1
          const fg = raw.slice(0, 3).map((channel, i) => channel * alpha + bg[i] * (1 - alpha))
          const a = lum(fg), b = lum(bg)
          output.push({ selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })
        }
        return output
      })
      for (const sample of contrast) expect(sample.ratio, sample.selector).toBeGreaterThanOrEqual(4.5)
    }
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
      for (const card of await page.locator('.stat-card').all()) {
        const box = await card.boundingBox()
        expect(box.width).toBeGreaterThan(100)
        expect(await card.locator('strong').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy()
      }
      if (width === 390) {
        const container = await page.locator('.records-card .table-wrap').boundingBox()
        const amount = await page.locator('.records-table tbody tr').first().locator('.amount-col').boundingBox()
        expect(amount.x).toBeGreaterThanOrEqual(container.x - 1)
        expect(amount.x + amount.width).toBeLessThanOrEqual(container.x + container.width + 1)
      }
      if (width === 1440) await page.screenshot({ path: `${screenshots}/dashboard-polished-desktop.png`, fullPage: true, animations: 'disabled' })
      if (width === 390) await page.screenshot({ path: `${screenshots}/dashboard-polished-mobile.png`, fullPage: true, animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '收支明细', exact: true }).click()
    const form = page.locator('.filter-form')
    const end = await form.getByLabel('结束日期', { exact: true }).boundingBox()
    for (const name of ['筛选', '重置']) {
      const button = await form.getByRole('button', { name, exact: true }).boundingBox()
      expect(button.y).toBeCloseTo(end.y, 1)
      expect(button.height).toBe(40)
    }
    await page.screenshot({ path: `${screenshots}/records-polished-desktop.png`, fullPage: true, animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    await page.screenshot({ path: `${screenshots}/records-polished-mobile.png`, fullPage: true, animations: 'disabled' })
    // Sticky amount must not cover the edit/delete controls at the scroll end.
    const scroller = page.locator('.records-card .table-wrap')
    await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth })
    const row = page.locator('.records-table tbody tr').first()
    await row.locator('.row-actions button').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await row.locator('.row-actions button').last().click()
    await expect(page.getByRole('dialog', { name: '删除这笔记录？', exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  } finally {
    const response = await page.request.delete(`/api/books/${book.id}`, { headers, data: {} })
    expect(response.status()).toBe(200)
  }
})

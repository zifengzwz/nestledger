import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from '@playwright/test'
import { randomInt } from 'node:crypto'

test('收支明细筛选按钮与结束日期对齐，手机等高且筛选重置正常', async ({ page }) => {
  await page.goto('/')
  const headers = { Origin: new URL(page.url()).origin }
  const registration = await registerWithSms(page.request, { headers, data: {
    phone: `187${String(randomInt(100000000)).padStart(8, '0')}`, password: 'Filter-Layout-2026!', name: '筛选布局测试',
  } })
  expect(registration.status()).toBe(201)
  const created = await page.request.post('/api/books', { headers, data: { name: '筛选布局验证', type: 'personal' } })
  expect(created.status()).toBe(201)
  const book = (await created.json()).data
  try {
    for (const [type, category, occurredAt] of [
      ['income', '工资薪酬', '2026-11-17T09:30:00.000Z'],
      ['expense', '餐饮美食', '2026-11-18T04:00:00.000Z'],
    ]) {
      const response = await page.request.post(`/api/books/${book.id}/records`, { headers, data: {
        type, category, occurredAt, amountCents: 1234, note: '对齐回归', paymentSource: '微信',
      } })
      expect(response.status()).toBe(201)
    }
    await page.reload()
    await page.getByRole('button', { name: '收支明细', exact: true }).click()
    const form = page.locator('.filter-form')
    const detail = page.locator('.records-card-detail')
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      const end = await form.getByLabel('结束日期', { exact: true }).boundingBox()
      const filter = await form.getByRole('button', { name: '筛选', exact: true }).boundingBox()
      const reset = await form.getByRole('button', { name: '重置', exact: true }).boundingBox()
      expect(end.height).toBe(40)
      expect(filter.height).toBe(40)
      expect(reset.height).toBe(40)
      await expect(form.getByLabel('结束日期', { exact: true })).toHaveCSS('font-size', width > 720 ? '12px' : '11px')
      await expect(detail.locator('thead th').first()).toHaveCSS('font-size', '11px')
      await expect(detail.locator('.record-description strong').first()).toHaveCSS('font-size', '13px')
      await expect(detail.locator('.amount-col strong').first()).toHaveCSS('font-size', '14px')
      expect(filter.y).toBeCloseTo(reset.y, 1)
      if (width > 720) {
        expect(filter.y).toBeCloseTo(end.y, 1)
        expect(filter.y + filter.height).toBeCloseTo(end.y + end.height, 1)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    }
    await form.getByLabel('结束日期', { exact: true }).fill('2026-11-17')
    await form.getByRole('button', { name: '筛选', exact: true }).click()
    await expect(page.locator('.records-card tbody tr')).toHaveCount(1)
    await expect(page.locator('.records-card tbody')).toContainText('工资薪酬')
    await form.getByRole('button', { name: '重置', exact: true }).click()
    await expect(form.getByLabel('结束日期', { exact: true })).toHaveValue('')
    await expect(page.locator('.records-card tbody tr')).toHaveCount(2)
  } finally {
    const deleted = await page.request.delete(`/api/books/${book.id}`, { headers, data: {} })
    expect(deleted.status()).toBe(200)
  }
})

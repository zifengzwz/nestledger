import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from '@playwright/test'
import { randomInt } from 'node:crypto'

test('左侧导航字号放大后不截断、账本仍显示五行', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  const headers = { Origin: new URL(page.url()).origin }
  const registration = await registerWithSms(page.request, { headers, data: {
    phone: `189${String(randomInt(100000000)).padStart(8, '0')}`, password: 'Sidebar-Type-2026!', name: '侧栏字号测试',
  } })
  expect(registration.status()).toBe(201)
  const books = []
  try {
    for (let i = 1; i <= 6; i++) {
      const response = await page.request.post('/api/books', { headers, data: { name: `字号验证账本 ${i}`, type: i % 2 ? 'personal' : 'family' } })
      expect(response.status()).toBe(201)
      books.push((await response.json()).data)
    }
    await page.reload()
    await expect(page.locator('.book-list [role="option"]')).toHaveCount(6)

    const sizes = await page.evaluate(() => ({
      nav: parseFloat(getComputedStyle(document.querySelector('.sidebar nav button')).fontSize),
      book: parseFloat(getComputedStyle(document.querySelector('.book-name')).fontSize),
      brand: parseFloat(getComputedStyle(document.querySelector('.sidebar .brand')).fontSize),
      profile: parseFloat(getComputedStyle(document.querySelector('.profile strong')).fontSize),
    }))
    expect(sizes.nav).toBe(13.5)
    expect(sizes.book).toBeGreaterThanOrEqual(13)
    expect(sizes.brand).toBeGreaterThanOrEqual(21)
    expect(sizes.profile).toBeGreaterThanOrEqual(13)

    const metrics = await page.locator('.sidebar').evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
    const clipped = await page.locator('.sidebar').evaluate(root => ({
      nav: [...root.querySelectorAll('nav button')].filter(el => el.scrollWidth > el.clientWidth + 1).length,
      profile: [...root.querySelectorAll('.profile strong, .profile small')].filter(el => el.scrollWidth > el.clientWidth + 1).length,
      bookName: [...root.querySelectorAll('.book-name')].filter(el => el.scrollWidth > el.clientWidth + 1 && !el.textContent?.includes('字号验证账本')).length,
    }))
    expect(clipped.nav).toBe(0)
    expect(clipped.profile).toBe(0)

    // Five visible rows preserved (48px each, 240px list) while text got larger.
    const list = await page.locator('.book-list').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const options = [...element.querySelectorAll('[role="option"]')]
      return {
        height: element.clientHeight,
        row: options[0].getBoundingClientRect().height,
        fullyVisible: options.filter(option => {
          const box = option.getBoundingClientRect()
          return box.top >= bounds.top - 0.5 && box.bottom <= bounds.bottom + 0.5
        }).length,
        scrollable: element.scrollHeight > element.clientHeight,
      }
    })
    expect(list.row).toBe(48)
    expect(list.height).toBe(240)
    expect(list.fullyVisible).toBe(5)
    expect(list.scrollable).toBeTruthy()

    await page.setViewportSize({ width: 320, height: 760 })
    await page.getByRole('button', { name: '打开导航', exact: true }).click()
    await expect(page.locator('.sidebar.open')).toBeVisible()
    await expect(page.locator('.sidebar.open')).toBeInViewport()
    const mobile = await page.locator('.sidebar.open').evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.clientWidth + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    expect(await page.locator('.sidebar nav button').evaluateAll(buttons =>
      buttons.filter(button => button.scrollWidth > button.clientWidth + 1).length)).toBe(0)
  } finally {
    for (const book of books) {
      const response = await page.request.delete(`/api/books/${book.id}`, { headers, data: {} })
      expect(response.status()).toBe(200)
    }
  }
})

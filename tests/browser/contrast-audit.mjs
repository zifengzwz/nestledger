import { registerWithSms } from "./sms-fixture.mjs";
import { chromium } from '@playwright/test'
import { randomInt } from 'node:crypto'

const THEMES = ['clay', 'forest', 'blue', 'plum', 'coral', 'mango', 'mint', 'berry']

const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: new URL(process.env.NESTLEDGER_TEST_URL).origin, viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const headers = { Origin: new URL(process.env.NESTLEDGER_TEST_URL).origin }
let book
try {
  const reg = await registerWithSms(page.request, { headers, data: {
    phone: '185' + String(randomInt(100000000)).padStart(8, '0'), password: 'Contrast-Audit-2026!', name: '对比度检查',
  } })
  if (reg.status() !== 201) throw new Error(await reg.text())
  const created = await page.request.post('/api/books', { headers, data: { name: '对比度账本', type: 'family' } })
  book = (await created.json()).data
  for (const [type, category, amountCents, occurredAt] of [
    ['income', '工资薪酬', 1200000, '2026-11-17T02:00:00.000Z'],
    ['expense', '餐饮美食', 3850, '2026-11-17T04:00:00.000Z'],
    ['expense', '交通出行', 1200, '2026-11-18T04:00:00.000Z'],
  ]) {
    const r = await page.request.post(`/api/books/${book.id}/records`, { headers, data: {
      type, category, amountCents, occurredAt, note: '月度通勤与晚餐', paymentSource: '微信',
    } })
    if (r.status() !== 201) throw new Error(await r.text())
  }
  await page.goto('/')
  await page.getByLabel('分析日期', { exact: true }).fill('2026-11-17')
  await page.waitForSelector('.stat-card')

  const audit = async () => page.evaluate(() => {
    const parse = text => {
      const value = String(text).trim()
      if (value.startsWith('#')) {
        const hex = value.length === 4 ? value.slice(1).split('').map(c => c + c).join('') : value.slice(1, 7)
        return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat([1])
      }
      const nums = (value.match(/[\d.]+/g) || []).map(Number)
      if (value.startsWith('color(srgb')) return [nums[0] * 255, nums[1] * 255, nums[2] * 255, nums[3] ?? 1]
      return nums.length >= 3 ? nums : []
    }
    const lum = c => c.slice(0, 3).map(v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
    const token = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
    const opaque = (color, style) => {
      const c = parse(color)
      if (c.length >= 4 && c[3] === 0) {
        return style.backgroundImage.includes('gradient') ? null : null
      }
      return c
    }
    const bgOf = element => {
      let node = element
      while (node) {
        const style = getComputedStyle(node)
        if (style.backgroundImage.includes('gradient')) {
          const light = lum(parse(style.color).slice(0, 3)) > 0.5
          const isBalance = node.classList?.contains('balance')
          return parse(token(isBalance ? '--balance-hi' : light ? '--accent-fill' : '--surface'))
        }
        const c = parse(style.backgroundColor)
        if (c.length >= 3 && (c[3] ?? 1) >= 0.99) return c
        node = node.parentElement
      }
      return parse(token('--surface'))
    }
    const ratio = (fg, bg) => {
      const f = fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)))
      const a = lum(f), b = lum(bg)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const selectors = {
      eyebrow: '.eyebrow',
      pageSubtitle: '.page-heading p',
      h1: '.page-heading h1',
      nav: '.sidebar nav button',
      navActive: '.sidebar nav button.active',
      navCaption: '.nav-caption',
      bookHeading: '.book-switcher-heading',
      bookName: '.book-name',
      bookKind: '.book-kind',
      scrollHint: '.book-scroll-hint',
      profileName: '.profile strong',
      profileSub: '.profile small',
      logout: '.logout',
      sectionTitle: '.section-head h2',
      sectionSub: '.section-head p',
      statLabel: '.stat-label',
      statValue: '.stat-card > strong',
      statFoot: '.stat-foot',
      balanceLabel: '.balance .stat-label',
      balanceFoot: '.balance .stat-foot',
      chartLabel: '.chart-label',
      chartLegend: '.chart-legend span',
      categoryName: '.category-row > span',
      categorySmall: '.category-item small',
      tableHead: '.records-table th',
      tableCategory: '.record-description strong',
      tableNote: '.record-description small',
      tableDate: '.date-cell',
      paymentTag: '.payment-tag',
      amount: '.amount-col strong',
      countLabel: '.count-label',
      filterLabel: '.filter-form label > span',
      inputText: '.filter-form input',
      placeholderHint: '.tiny.muted',
      footer: '.page-footer',
      empty: '.empty-state p',
      ghostText: '.row-actions .tiny',
    }
    const out = []
    for (const [name, selector] of Object.entries(selectors)) {
      const element = document.querySelector(selector)
      if (!element) continue
      const style = getComputedStyle(element)
      const size = parseFloat(style.fontSize)
      const weight = Number(style.fontWeight) || 400
      const fg = parse(style.color)
      if (fg.length < 3) continue
      const bg = bgOf(element)
      const r = ratio(fg, bg)
      const large = size >= 24 || (size >= 18.66 && weight >= 700)
      out.push({ name, ratio: Number(r.toFixed(2)), size, large, required: large ? 3 : 4.5, pass: r >= (large ? 3 : 4.5) })
    }
    return out
  })

  const report = {}
  for (const theme of THEMES) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t }, theme)
    report[theme] = await audit()
  }
  const failures = []
  for (const [theme, rows] of Object.entries(report)) {
    for (const row of rows) if (!row.pass) failures.push({ theme, ...row })
  }
  console.log('FAILURES', JSON.stringify(failures, null, 1))
  const summary = Object.fromEntries(Object.entries(report).map(([theme, rows]) => {
    const sorted = [...rows].sort((a, b) => a.ratio - b.ratio).slice(0, 6).map(r => `${r.name}=${r.ratio}`)
    return [theme, { lowest: sorted, fails: rows.filter(r => !r.pass).map(r => `${r.name}=${r.ratio}`) }]
  }))
  console.log('SUMMARY', JSON.stringify(summary, null, 1))
} finally {
  if (book) await page.request.delete(`/api/books/${book.id}`, { headers, data: {} })
  await browser.close()
}

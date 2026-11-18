import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../../.runtime/browser-results',
  use: {
    baseURL: process.env.NESTLEDGER_TEST_URL || 'http://127.0.0.1:1',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1100 },
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})

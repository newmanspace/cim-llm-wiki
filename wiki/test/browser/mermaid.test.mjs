import { test, expect } from '@playwright/test'

test('diagrams render across themes and navigation; invalid and hostile input remain data', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/wiki/ci/doc/requirements/req-ci-001')
  const ready = page.locator('.mermaid-diagram[data-render-state="ready"]')
  await expect(ready).toHaveCount(5)
  await expect(ready.first().locator('svg')).toBeVisible()
  await expect(ready.first()).toContainText('采集')
  const failed = page.locator('.mermaid-diagram[data-render-state="error"]')
  await expect(failed).toHaveCount(1)
  await expect(failed).toContainText('图表渲染失败')
  await expect(failed.locator('code')).toContainText('not a valid diagram')
  await expect(page.locator('.mermaid-svg script, .mermaid-svg [onerror], .mermaid-svg a')).toHaveCount(0)
  await expect(page.locator('pre').filter({ hasText: 'ordinary-code-sentinel' })).toBeVisible()
  expect(await page.evaluate(() => window.__mermaidExecuted)).toBeUndefined()

  const firstSVG = await ready.first().locator('svg').innerHTML()
  await page.locator('.VPSwitchAppearance:visible').click()
  await expect(ready).toHaveCount(5)
  await expect.poll(() => ready.first().locator('svg').innerHTML()).not.toBe(firstSVG)
  await expect(failed).toHaveCount(1)

  await page.locator('.VPNavBarTitle a').click()
  await expect(page).toHaveURL(/\/wiki\/$/)
  await expect(ready).toHaveCount(0)
  await page.goBack()
  await expect(ready).toHaveCount(5)
  expect(errors).toEqual([])
})

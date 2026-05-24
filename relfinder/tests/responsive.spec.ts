import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ConnectionPage } from './pages/ConnectionPage'
import { BrowsePage } from './pages/BrowsePage'

const SMALL_TTL = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))

// ── Helpers ───────────────────────────────────────────────────────────────────

async function assertNoHorizontalOverflow(page: Page, context = ''): Promise<void> {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasOverflow, `Horizontal overflow detected${context ? ' — ' + context : ''}`).toBe(false)
}

/** Navigate to /browse via file upload and wait for the schema canvas to appear. */
async function goToBrowseMobile(page: Page): Promise<BrowsePage> {
  const conn = new ConnectionPage(page)
  await conn.goto()
  await conn.selectFileTab()
  await conn.uploadFile(SMALL_TTL)
  await conn.expectFileLoaded(5)
  await conn.clickOpenGraph()
  await expect(page).toHaveURL('/browse', { timeout: 15_000 })
  return new BrowsePage(page)
}

// ── No horizontal overflow at 375 px ─────────────────────────────────────────

test.describe('No horizontal overflow — 375 px (iPhone SE)', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('connection page — SPARQL tab', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()
    await assertNoHorizontalOverflow(page, 'SPARQL tab')
  })

  test('connection page — File tab', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.selectFileTab()
    await assertNoHorizontalOverflow(page, 'File tab')
  })

  test('browse page after file upload', async ({ page }) => {
    await goToBrowseMobile(page)
    await assertNoHorizontalOverflow(page, '/browse')
  })

  test('browse page with sidebar open', async ({ page }) => {
    await goToBrowseMobile(page)
    // Open the mobile sidebar overlay
    await page.locator('.mobile-menu-btn').click()
    await expect(page.getByTestId('nav-schema')).toBeVisible()
    await assertNoHorizontalOverflow(page, '/browse with sidebar open')
  })
})

// ── No horizontal overflow at 768 px (tablet) ─────────────────────────────────

test.describe('No horizontal overflow — 768 px (tablet)', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('connection page', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()
    await assertNoHorizontalOverflow(page, 'tablet — connection')
  })

  test('browse page after file upload', async ({ page }) => {
    await goToBrowseMobile(page)
    await assertNoHorizontalOverflow(page, 'tablet — /browse')
  })
})

// ── Mobile sidebar overlay behaviour ─────────────────────────────────────────

test.describe('Mobile sidebar overlay — 375 px', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('sidebar is collapsed and menu button visible by default', async ({ page }) => {
    await goToBrowseMobile(page)
    await expect(page.locator('.mobile-menu-btn')).toBeVisible()
    await expect(page.getByTestId('nav-schema')).not.toBeVisible()
  })

  test('menu button opens the sidebar overlay', async ({ page }) => {
    await goToBrowseMobile(page)
    await page.locator('.mobile-menu-btn').click()
    await expect(page.getByTestId('nav-schema')).toBeVisible()
    await expect(page.locator('.mobile-menu-btn')).not.toBeVisible()
  })

  test('backdrop click closes the sidebar overlay', async ({ page }) => {
    await goToBrowseMobile(page)
    await page.locator('.mobile-menu-btn').click()
    await expect(page.getByTestId('nav-schema')).toBeVisible()
    await page.locator('.sidebar-backdrop').click()
    await expect(page.getByTestId('nav-schema')).not.toBeVisible({ timeout: 3_000 })
  })

  test('Escape key closes the sidebar overlay', async ({ page }) => {
    await goToBrowseMobile(page)
    await page.locator('.mobile-menu-btn').click()
    await expect(page.getByTestId('nav-schema')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('nav-schema')).not.toBeVisible({ timeout: 3_000 })
  })
})

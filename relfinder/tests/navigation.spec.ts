import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { BrowsePage } from './pages/BrowsePage'
import { GraphPage } from './pages/GraphPage'

const SMALL_TTL = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))

// ── Helpers ───────────────────────────────────────────────────────────────────

async function connectViaFile(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(SMALL_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse')
}

// ── View switching ────────────────────────────────────────────────────────────

test.describe('View navigation', () => {
  test('Schema tab is active on /browse', async ({ page }) => {
    await connectViaFile(page)
    const activeTab = page.locator('[aria-current="page"]')
    await expect(activeTab).toContainText('Schema')
  })

  test('clicking Paths tab navigates to /graph', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph')
  })

  test('Paths tab is active on /graph', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph')
    const activeTab = page.locator('[aria-current="page"]')
    await expect(activeTab).toContainText('Paths')
  })

  test('clicking Schema tab from /graph navigates back to /browse', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph')
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse')
  })

  test('browser back button works from /graph to /browse', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph')
    await page.goBack()
    await expect(page).toHaveURL('/browse')
  })
})

// ── Sidebar collapse ──────────────────────────────────────────────────────────

test.describe('Sidebar collapse', () => {
  test('sidebar collapses when toggle button is clicked', async ({ page }) => {
    await connectViaFile(page)
    const toggleBtn = page.getByRole('button', { name: /Collapse sidebar/i })
    await toggleBtn.click()
    // After collapse, nav links become hidden
    await expect(page.getByTestId('nav-paths')).not.toBeVisible()
  })

  test('sidebar expands again after second click', async ({ page }) => {
    await connectViaFile(page)
    const collapseBtn = page.getByRole('button', { name: /Collapse sidebar/i })
    await collapseBtn.click()
    const expandBtn = page.getByRole('button', { name: /Expand sidebar/i })
    await expandBtn.click()
    await expect(page.getByTestId('nav-paths')).toBeVisible()
  })
})

// ── State persistence across tabs ─────────────────────────────────────────────

test.describe('State persistence', () => {
  test('extraction state persists when switching Schema → Paths → Schema', async ({ page }) => {
    await connectViaFile(page)
    const browse = new BrowsePage(page)

    // Extract schema
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    const nodesBefore = await browse.getNodeCount()

    // Go to Paths
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph')

    // Return to Schema
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse')

    // Schema store is preserved (Pinia state persists across route navigation)
    await browse.expectSchemaLoaded()
    const nodesAfter = await browse.getNodeCount()
    expect(nodesAfter).toBe(nodesBefore)
  })
})

// ── Disconnect ────────────────────────────────────────────────────────────────

test.describe('Disconnect', () => {
  test('clicking disconnect from Browse navigates to connection screen', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('disconnect-btn').click()
    await expect(page).toHaveURL('/')
  })

  test('clicking disconnect from Graph navigates to connection screen', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph')
    await page.getByTestId('disconnect-btn-graph').click()
    await expect(page).toHaveURL('/')
  })

  test('after disconnect, /browse is inaccessible (guard redirects)', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('disconnect-btn').click()
    await expect(page).toHaveURL('/')
    await page.goto('/browse')
    await expect(page).toHaveURL('/')
  })
})

// ── Panels and context ────────────────────────────────────────────────────────

test.describe('Panel context', () => {
  test('Find Relationships button is disabled with no entities selected', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('nav-paths').click()
    const graphPage = new GraphPage(page)
    await graphPage.expectFindButtonDisabled()
  })

  test('Paths view shows entity search sections', async ({ page }) => {
    await connectViaFile(page)
    await page.getByTestId('nav-paths').click()
    await expect(page.getByTestId('entity1-search')).toBeVisible()
    await expect(page.getByTestId('entity2-search')).toBeVisible()
  })
})

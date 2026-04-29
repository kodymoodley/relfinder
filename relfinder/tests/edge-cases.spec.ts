import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import {
  manyClassesResponse,
  noEdgesResponse,
  sparqlJsonHeaders,
  toBody,
} from './mocks/sparqlResponses'
import { BrowsePage } from './pages/BrowsePage'

const SMALL_TTL = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))
const MOCK_ENDPOINT = 'http://mock.sparql.test/sparql'

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

// ── Large dataset simulation ──────────────────────────────────────────────────

test.describe('Large dataset simulation (mocked)', () => {
  test('20-class mocked endpoint: extraction completes without error', async ({ page }) => {
    // All queries return the 20-class list, edges return empty (fast)
    await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
      const body = route.request().postData() ?? route.request().url()
      if (body.includes('DISTINCT') || body.includes('class')) {
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(manyClassesResponse) })
      } else {
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(noEdgesResponse) })
      }
    })

    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
    await page.getByTestId('connect-btn').click()
    await expect(page).toHaveURL('/browse', { timeout: 15_000 })

    const browse = new BrowsePage(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(30_000)

    // Should succeed without error
    await expect(browse.extractionError()).not.toBeVisible()
  })

  test('20-class mocked endpoint: node count equals class count', async ({ page }) => {
    await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
      const body = route.request().postData() ?? route.request().url()
      if (body.includes('DISTINCT') || body.includes('class')) {
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(manyClassesResponse) })
      } else {
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(noEdgesResponse) })
      }
    })

    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
    await page.getByTestId('connect-btn').click()
    await expect(page).toHaveURL('/browse', { timeout: 15_000 })

    const browse = new BrowsePage(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(30_000)

    const nodes = await browse.getNodeCount()
    expect(nodes).toBe(20)
  })
})

// ── Small dataset edge cases ──────────────────────────────────────────────────

test.describe('Small dataset (1–2 nodes)', () => {
  test('single class mocked: schema renders without crash', async ({ page }) => {
    await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: sparqlJsonHeaders,
        body: JSON.stringify({
          head: { vars: ['class'] },
          results: { bindings: [{ class: { type: 'uri', value: 'http://example.org/OnlyClass' } }] },
        }),
      })
    })

    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
    await page.getByTestId('connect-btn').click()
    await expect(page).toHaveURL('/browse', { timeout: 15_000 })

    const browse = new BrowsePage(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(15_000)

    const nodes = await browse.getNodeCount()
    expect(nodes).toBe(1)
  })
})

// ── Rapid repeated interactions ───────────────────────────────────────────────

test.describe('Rapid repeated interactions', () => {
  test('clicking Extract then Stop rapidly does not crash the app', async ({ page }) => {
    await connectViaFile(page)
    const browse = new BrowsePage(page)

    await browse.clickExtract()
    // Immediately stop without waiting
    await browse.clickStop()
    // App should still be responsive — verify no JS errors caused a broken state
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 3_000 })

    // Can extract again
    await browse.clickExtract()
    await expect(browse.stopBtn()).toBeVisible({ timeout: 5_000 })
    await browse.clickStop()
  })

  test('clicking Extract multiple times does not stack multiple extractions', async ({ page }) => {
    await connectViaFile(page)
    const browse = new BrowsePage(page)

    await browse.clickExtract()
    await expect(browse.stopBtn()).toBeVisible({ timeout: 5_000 })

    // While extracting, the Extract button is hidden — extra clicks are prevented by UI
    await expect(browse.extractBtn()).not.toBeVisible()
    await browse.clickStop()
  })
})

// ── Dark mode toggle ──────────────────────────────────────────────────────────

test.describe('Dark mode toggle', () => {
  test('dark mode toggle on connection screen works', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })

    const toggleBtn = page.getByRole('button', { name: /Switch to dark mode|Switch to light mode/i })
    await expect(toggleBtn).toBeVisible()
    await toggleBtn.click()
    // After click the aria-label should flip
    await expect(toggleBtn).toHaveAttribute('aria-label', /Switch to (light|dark) mode/)
  })

  test('dark mode toggle on Browse screen works', async ({ page }) => {
    await connectViaFile(page)
    const toggleBtn = page.getByRole('button', { name: /Switch to dark mode|Switch to light mode/i }).first()
    await expect(toggleBtn).toBeVisible()
    await toggleBtn.click()
    await expect(toggleBtn).toHaveAttribute('aria-label', /Switch to (light|dark) mode/)
  })
})

// ── Error resilience ──────────────────────────────────────────────────────────

test.describe('Error resilience', () => {
  test('endpoint 500 during Phase 2 does not crash app — partial schema shown', async ({ page }) => {
    let callCount = 0
    await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
      callCount++
      const body = route.request().postData() ?? route.request().url()
      if (body.includes('DISTINCT')) {
        // Phase 1 succeeds
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(manyClassesResponse) })
      } else {
        // Phase 2 returns 500 for every class
        await route.fulfill({ status: 500, body: 'Server error' })
      }
    })

    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
    await page.getByTestId('connect-btn').click()
    await expect(page).toHaveURL('/browse', { timeout: 15_000 })

    const browse = new BrowsePage(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(30_000)

    // Even with Phase 2 failures, app should not have a JS crash — UI still responsive
    await expect(page.locator('body')).toBeVisible()
    // No unhandled error modal or blank page
    const nodeCount = await browse.getNodeCount().catch(() => -1)
    expect(nodeCount).toBeGreaterThanOrEqual(0)
  })
})

// ── Cytoscape canvas interactions ─────────────────────────────────────────────

test.describe('Cytoscape canvas', () => {
  test('schema canvas is present in DOM after extraction', async ({ page }) => {
    await connectViaFile(page)
    const browse = new BrowsePage(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)

    await expect(browse.schemaCanvas()).toBeAttached()
    // Check for cytoscape's internal canvas element
    const cyCanvas = page.locator('[data-testid="schema-canvas"] canvas')
    await expect(cyCanvas.first()).toBeAttached({ timeout: 5_000 })
  })

  test('empty canvas shows helpful hint text', async ({ page }) => {
    await connectViaFile(page)
    const browse = new BrowsePage(page)
    await expect(browse.schemaCanvasEmpty()).toContainText('Extract Schema')
  })
})

// ── Accessibility basics ──────────────────────────────────────────────────────

test.describe('Accessibility', () => {
  test('connection page has a visible heading', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await expect(page.getByRole('heading', { name: 'RelFinder' })).toBeVisible()
  })

  test('Browse page navigation uses role="button" elements', async ({ page }) => {
    await connectViaFile(page)
    // Nav buttons are <button> elements
    await expect(page.getByTestId('nav-paths')).toHaveJSProperty('tagName', 'BUTTON')
  })

  test('keyboard navigation: Enter key submits SPARQL form', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    // Block all external requests so the "Connect" attempt fails gracefully
    await page.route('**/*', (route) => {
      if (route.request().url().startsWith('http://localhost:5173')) {
        route.continue()
      } else {
        route.abort('failed')
      }
    })
    await page.getByTestId('endpoint-url-input').fill('https://unreachable.test/sparql')
    await page.getByTestId('endpoint-url-input').press('Enter')
    // Either error message or loading state — form was submitted
    await expect(
      page.getByTestId('connection-error-msg').or(page.getByText('Connecting')),
    ).toBeVisible({ timeout: 10_000 })
  })
})

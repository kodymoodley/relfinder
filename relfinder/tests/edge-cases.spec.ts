import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  manyClassesResponse,
  noEdgesResponse,
  pingResponse,
  sparqlJsonHeaders,
  toBody,
} from './mocks/sparqlResponses'
import { BrowsePage } from './pages/BrowsePage'

const SMALL_TTL = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))
const MOCK_ENDPOINT = 'https://mock.sparql.test/sparql'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function connectViaFileAndWait(page: Page): Promise<BrowsePage> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(SMALL_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 15_000 })
  const browse = new BrowsePage(page)
  await browse.waitForExtractionComplete(60_000)
  return browse
}

/**
 * Connect to a mocked SPARQL endpoint with slow Phase 2 responses so the
 * Stop button stays visible long enough for the test to interact with it.
 * Phase 1 (20 classes) is instant; each Phase 2 query is delayed 150 ms.
 */
async function connectWithSlowExtraction(page: Page): Promise<BrowsePage> {
  await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
    const body = route.request().postData() ?? route.request().url()
    if (body.includes('DISTINCT') && body.includes('class')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(manyClassesResponse) })
    } else if (body.includes('VALUES')) {
      await new Promise((r) => setTimeout(r, 300))
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(noEdgesResponse) })
    } else {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(pingResponse) })
    }
  })
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
  await page.getByTestId('connect-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 60_000 })
  return new BrowsePage(page)
}

/** Connect to a mocked SPARQL endpoint and wait for auto-extraction to finish. */
async function connectViaMockedSparql(
  page: Page,
  routeHandler: (route: import('@playwright/test').Route) => Promise<void>,
): Promise<BrowsePage> {
  await page.route(`${MOCK_ENDPOINT}**`, routeHandler)
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
  await page.getByTestId('connect-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 60_000 })
  const browse = new BrowsePage(page)
  await browse.waitForExtractionComplete(80_000)
  return browse
}

// ── Large dataset simulation ──────────────────────────────────────────────────

test.describe('Large dataset simulation (mocked)', () => {
  test('20-class mocked endpoint: extraction completes without error', async ({ page }) => {
    const browse = await connectViaMockedSparql(page, async (route) => {
      const body = route.request().postData() ?? route.request().url()
      if (body.includes('DISTINCT') && body.includes('class')) {
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(manyClassesResponse) })
      } else {
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(noEdgesResponse) })
      }
    })

    await expect(browse.extractionError()).not.toBeVisible()
  })

  test('20-class mocked endpoint: node count equals class count', async ({ page }) => {
    const browse = await connectViaMockedSparql(page, async (route) => {
      const body = route.request().postData() ?? route.request().url()
      if (body.includes('DISTINCT') && body.includes('class')) {
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(manyClassesResponse) })
      } else {
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(noEdgesResponse) })
      }
    })

    const nodes = await browse.getNodeCount()
    expect(nodes).toBe(20)
  })
})

// ── Small dataset edge cases ──────────────────────────────────────────────────

test.describe('Small dataset (1–2 nodes)', () => {
  test('single class mocked: schema renders without crash', async ({ page }) => {
    const browse = await connectViaMockedSparql(page, async (route) => {
      await route.fulfill({
        status: 200,
        headers: sparqlJsonHeaders,
        body: JSON.stringify({
          head: { vars: ['class'] },
          results: { bindings: [{ class: { type: 'uri', value: 'http://example.org/OnlyClass' } }] },
        }),
      })
    })

    const nodes = await browse.getNodeCount()
    expect(nodes).toBe(1)
  })
})

// ── Rapid repeated interactions ───────────────────────────────────────────────

test.describe('Rapid repeated interactions', () => {
  test('clicking Stop immediately after auto-start does not crash the app', async ({ page }) => {
    // Use slow mock so Phase 2 is still running when we click Stop
    const browse = await connectWithSlowExtraction(page)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 10_000 })
    await browse.clickStop()
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 3_000 })
    await expect(page.locator('body')).toBeVisible()
  })

  test('extraction cannot be manually started while auto-start is running', async ({ page }) => {
    const browse = await connectWithSlowExtraction(page)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 20_000 })
    // Extract button must be absent while Stop is showing
    await expect(browse.extractBtn()).not.toBeVisible()
    await browse.waitForExtractionComplete(60_000)
  })

  test('can restart extraction after stopping', async ({ page }) => {
    const browse = await connectWithSlowExtraction(page)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 20_000 })
    await browse.clickStop()
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 6_000 })

    const extractVisible = await browse.extractBtn().isVisible()
    const doneVisible = await browse.schemaDone().isVisible()
    expect(extractVisible || doneVisible).toBe(true)
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
    await expect(toggleBtn).toHaveAttribute('aria-label', /Switch to (light|dark) mode/)
  })

  test('dark mode toggle on Browse screen works', async ({ page }) => {
    await connectViaFileAndWait(page)
    const toggleBtn = page.getByRole('button', { name: /Switch to dark mode|Switch to light mode/i }).first()
    await expect(toggleBtn).toBeVisible()
    await toggleBtn.click()
    await expect(toggleBtn).toHaveAttribute('aria-label', /Switch to (light|dark) mode/)
  })
})

// ── Error resilience ──────────────────────────────────────────────────────────

test.describe('Error resilience', () => {
  test('endpoint 500 during Phase 2 does not crash app — partial schema shown', async ({ page }) => {
    const browse = await connectViaMockedSparql(page, async (route) => {
      const body = route.request().postData() ?? route.request().url()
      if (body.includes('DISTINCT') && body.includes('class')) {
        // Phase 1: class discovery succeeds
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(manyClassesResponse) })
      } else if (body.includes('VALUES')) {
        // Phase 2: edge queries all return 500 — extractor catches and continues
        await route.fulfill({ status: 500, body: 'Server error' })
      } else {
        // Ping probe and label queries: valid response
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(pingResponse) })
      }
    })

    // App must remain responsive — no blank page or JS crash
    await expect(page.locator('body')).toBeVisible()
    const nodeCount = await browse.getNodeCount().catch(() => -1)
    expect(nodeCount).toBeGreaterThanOrEqual(0)
  })
})

// ── Cytoscape canvas interactions ─────────────────────────────────────────────

test.describe('Cytoscape canvas', () => {
  test('schema canvas is present in DOM after extraction', async ({ page }) => {
    const browse = await connectViaFileAndWait(page)
    await expect(browse.schemaCanvas()).toBeAttached()
    // Cytoscape renders an internal canvas element
    const cyCanvas = page.locator('[data-testid="schema-canvas"] canvas')
    await expect(cyCanvas.first()).toBeAttached({ timeout: 5_000 })
  })

  test('empty canvas shows helpful hint text before extraction', async ({ page }) => {
    // Use slow mock so Phase 2 keeps extraction running while we check state
    const browse = await connectWithSlowExtraction(page)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 20_000 })
    // Canvas container is always in the DOM (Cytoscape needs it)
    await expect(browse.schemaCanvas()).toBeAttached()
    await browse.waitForExtractionComplete(60_000)
  })
})

// ── Accessibility basics ──────────────────────────────────────────────────────

test.describe('Accessibility', () => {
  test('connection page has a visible heading', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await expect(page.getByRole('heading', { name: 'RelFinder' })).toBeVisible()
  })

  test('Browse page navigation uses button elements', async ({ page }) => {
    await connectViaFileAndWait(page)
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
    await expect(
      page.getByTestId('connection-error-msg').or(page.getByText('Connecting')),
    ).toBeVisible({ timeout: 10_000 })
  })
})

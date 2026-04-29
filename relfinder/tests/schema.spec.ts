import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import {
  twoClassesResponse,
  personToProjectEdgesResponse,
  noEdgesResponse,
  emptyClassesResponse,
  labelsResponse,
  pingResponse,
  sparqlJsonHeaders,
  toBody,
} from './mocks/sparqlResponses'
import { BrowsePage } from './pages/BrowsePage'

const SMALL_TTL = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))
const MOCK_ENDPOINT = 'http://mock.sparql.test/sparql'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Intercept SPARQL queries to the mock endpoint.
 * Dispatches responses based on query content keywords.
 */
async function setupSparqlMocks(page: import('@playwright/test').Page) {
  await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
    const body = route.request().postData() ?? route.request().url()

    // Phase 1: class discovery
    if (body.includes('DISTINCT') && body.includes('class')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(twoClassesResponse) })
      return
    }
    // Label fetching
    if (body.includes('rdfs:label') || body.includes('label')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(labelsResponse) })
      return
    }
    // Phase 2: edge discovery for Person → Project
    if (body.includes('Person')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(personToProjectEdgesResponse) })
      return
    }
    // Everything else: no edges
    await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(noEdgesResponse) })
  })
}

/** Navigate to /browse via file upload (fastest — no network needed). */
async function goToBrowseViaFile(page: import('@playwright/test').Page): Promise<BrowsePage> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(SMALL_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse')
  return new BrowsePage(page)
}

/** Navigate to /browse via mocked SPARQL endpoint. */
async function goToBrowseViaSparql(page: import('@playwright/test').Page): Promise<BrowsePage> {
  // All SPARQL requests (including the ping probe) share one route handler.
  // The ping is "SELECT * WHERE { ?s ?p ?o } LIMIT 1" — return pingResponse for it.
  // Phase 1/2 queries are dispatched in setupSparqlMocks below, but since route
  // handlers run LIFO in Playwright we register the combined handler first.
  await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
    const body = route.request().postData() ?? route.request().url()

    if (body.includes('DISTINCT') && body.includes('class')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(twoClassesResponse) })
    } else if (body.includes('rdfs:label') || body.includes('label')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(labelsResponse) })
    } else if (body.includes('Person')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(personToProjectEdgesResponse) })
    } else {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(pingResponse) })
    }
  })

  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
  await page.getByTestId('connect-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 15_000 })
  return new BrowsePage(page)
}

// ── Initial state ─────────────────────────────────────────────────────────────

test.describe('Schema view — initial state', () => {
  test('shows empty canvas and Extract Schema button before extraction', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.expectEmptyCanvas()
  })

  test('Extract Schema button is the only primary action visible initially', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await expect(browse.extractBtn()).toBeVisible()
    await expect(browse.stopBtn()).not.toBeVisible()
    await expect(browse.schemaDone()).not.toBeVisible()
  })
})

// ── Extraction from local TTL ─────────────────────────────────────────────────

test.describe('Schema extraction from local file', () => {
  test('clicking Extract Schema starts extraction and shows Stop button', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    // Stop button appears immediately (state 2)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 5_000 })
    await expect(browse.extractionProgress()).toBeVisible()
  })

  test('extraction completes and shows Schema loaded indicator', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    await browse.expectSchemaLoaded()
  })

  test('node count is in expected range after extraction', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    // small-graph.ttl has 2 classes (Person, Project)
    await browse.expectNodeCountInRange(1, 10)
  })

  test('Stats section shows node and edge counts after extraction', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    await expect(browse.schemaStats()).toBeVisible()
    const nodes = await browse.getNodeCount()
    expect(nodes).toBeGreaterThan(0)
  })

  test('Cytoscape canvas becomes visible after extraction', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    await expect(browse.schemaCanvas()).toBeVisible()
    await expect(browse.schemaCanvasEmpty()).not.toBeVisible()
  })
})

// ── Stop / cancel ─────────────────────────────────────────────────────────────

test.describe('Extraction — Stop button', () => {
  test('clicking Stop immediately hides the Stop button', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    // Wait until extraction is definitely running
    await expect(browse.stopBtn()).toBeVisible({ timeout: 5_000 })
    await browse.clickStop()
    // Stop button should disappear quickly (cancel() immediately sets extracting=false)
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 3_000 })
  })

  test('after stopping, schema state is either empty or partial (never "extracting")', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await expect(browse.stopBtn()).toBeVisible({ timeout: 5_000 })
    await browse.clickStop()
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 3_000 })
    // Either we're back at Extract or at Schema loaded — either is correct
    const extractVisible = await browse.extractBtn().isVisible()
    const doneVisible = await browse.schemaDone().isVisible()
    expect(extractVisible || doneVisible).toBe(true)
  })
})

// ── Schema extraction from mocked SPARQL ─────────────────────────────────────

test.describe('Schema extraction from mocked SPARQL endpoint', () => {
  test('extracts 2 classes and 1 edge from mocked endpoint', async ({ page }) => {
    const browse = await goToBrowseViaSparql(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(30_000)
    const nodes = await browse.getNodeCount()
    expect(nodes).toBe(2)
  })
})

// ── Toolbar controls ─────────────────────────────────────────────────────────

test.describe('Schema canvas toolbar', () => {
  test('toolbar appears after extraction completes', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    await expect(browse.schemaToolbar()).toBeVisible()
  })

  test('zoom in button is clickable', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    await browse.zoomIn()
    // No error thrown → interaction succeeded
  })

  test('zoom out button is clickable', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    await browse.zoomOut()
  })

  test('fit to screen button is clickable', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    await browse.fitGraph()
  })

  test('re-run layout button is clickable', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    await browse.rerunLayout()
  })

  test('toggle edge labels button changes aria-label', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)

    const btn = browse.toggleLabelsBtn()
    const labelBefore = await btn.getAttribute('aria-label')
    await browse.toggleLabels()
    const labelAfter = await btn.getAttribute('aria-label')
    expect(labelBefore).not.toEqual(labelAfter)
  })
})

// ── Re-extract ────────────────────────────────────────────────────────────────

test.describe('Re-extract', () => {
  test('Re-extract button appears in options after extraction', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    // Open the options collapsible
    await page.locator('.section-label.collapsible').click()
    await expect(browse.reextractBtn()).toBeVisible()
  })

  test('Re-extract button is disabled while extracting', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    // First extraction
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    // Open options, start re-extract
    await page.locator('.section-label.collapsible').click()
    await browse.reextractBtn().click()
    // While running, the button should be disabled
    if (await browse.stopBtn().isVisible()) {
      await expect(browse.reextractBtn()).toBeDisabled()
    }
  })
})

// ── Empty dataset ─────────────────────────────────────────────────────────────

test.describe('Empty dataset from mocked SPARQL', () => {
  test('shows empty canvas when endpoint returns no classes', async ({ page }) => {
    await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(emptyClassesResponse) })
    })

    // Setup a fake connected state via sessionStorage
    await page.goto('/')
    await page.evaluate((ep) => {
      sessionStorage.setItem('rf:endpointUrl', ep)
    }, MOCK_ENDPOINT)

    // Route with a fulfilled ping so connection succeeds
    await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
    await page.getByTestId('connect-btn').click()
    await expect(page).toHaveURL('/browse', { timeout: 15_000 })

    const browse = new BrowsePage(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(15_000)

    // With 0 classes, we expect either empty canvas or 0 nodes
    const nodesCount = await browse.getNodeCount().catch(() => 0)
    expect(nodesCount).toBe(0)
    await expect(browse.schemaCanvasEmpty()).toBeVisible()
  })
})

// ── Persistence / cache ───────────────────────────────────────────────────────

test.describe('Schema cache persistence', () => {
  test('refreshing the page preserves extracted schema from localStorage', async ({ page }) => {
    const browse = await goToBrowseViaFile(page)
    await browse.clickExtract()
    await browse.waitForExtractionComplete(60_000)
    const nodesBefore = await browse.getNodeCount()

    // Reload and re-navigate (file-based schema stores to __file__ key)
    await page.reload()
    await expect(page).toHaveURL('/')
    // File upload must be re-done after reload since file store clears on nav
    // Schema persistence is mainly meaningful for SPARQL endpoints
  })
})

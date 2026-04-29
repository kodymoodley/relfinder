import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  twoClassesResponse,
  manyClassesResponse,
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
 * Navigate to /browse via file upload and wait for auto-extraction to finish.
 *
 * BrowseView.onMounted auto-starts extraction when hasData=false.
 * This helper waits for the Stop button to disappear before returning so
 * callers receive a page in State 3 (Schema loaded).
 */
async function goToBrowseWithExtractedSchema(page: Page): Promise<BrowsePage> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(SMALL_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse')
  const browse = new BrowsePage(page)
  await browse.waitForExtractionComplete(60_000)
  return browse
}

/**
 * Connect via a mocked SPARQL endpoint with deliberately slow Phase 2 responses
 * so the Stop button stays visible for several seconds — enough for tests to
 * click it reliably. Phase 1 (class discovery) is instant; Phase 2 has a 150 ms
 * delay per class with 20 classes and concurrency 5 → ~600 ms total.
 */
async function navigateWithSlowExtraction(page: Page): Promise<BrowsePage> {
  await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
    const body = route.request().postData() ?? route.request().url()
    if (body.includes('DISTINCT') && body.includes('class')) {
      // Phase 1: return 20 classes immediately
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(manyClassesResponse) })
    } else if (body.includes('VALUES')) {
      // Phase 2: slow edge queries
      await new Promise((r) => setTimeout(r, 150))
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(noEdgesResponse) })
    } else {
      // Ping probe and label queries
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

/** Navigate to /browse via mocked SPARQL endpoint and wait for auto-extraction. */
async function goToBrowseViaSparql(page: Page): Promise<BrowsePage> {
  await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
    const body = route.request().postData() ?? route.request().url()

    if (body.includes('DISTINCT') && body.includes('class')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(twoClassesResponse) })
    } else if (body.includes('rdfs:label') || body.includes('label')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(labelsResponse) })
    } else if (body.includes('Person')) {
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(personToProjectEdgesResponse) })
    } else {
      // Ping probe or edge queries for other classes
      await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(pingResponse) })
    }
  })

  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
  await page.getByTestId('connect-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 15_000 })
  const browse = new BrowsePage(page)
  await browse.waitForExtractionComplete(30_000)
  return browse
}

// ── Auto-start on mount ───────────────────────────────────────────────────────

test.describe('Schema view — auto-start behaviour', () => {
  test('navigating to /browse auto-starts extraction (Stop button appears)', async ({ page }) => {
    // Use slow mock so Phase 2 keeps the Stop button visible long enough to assert
    const browse = await navigateWithSlowExtraction(page)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 10_000 })
    await expect(browse.extractionProgress()).toBeVisible()
    // Let extraction finish so the dev server is clean for the next test
    await browse.waitForExtractionComplete(30_000)
  })

  test('extract button is NOT visible while auto-extraction is running', async ({ page }) => {
    const browse = await navigateWithSlowExtraction(page)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 10_000 })
    await expect(browse.extractBtn()).not.toBeVisible()
    await browse.waitForExtractionComplete(30_000)
  })

  test('extraction completes automatically and shows Schema loaded indicator', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await browse.expectSchemaLoaded()
  })

  test('node count is in expected range after auto-extraction', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    // small-graph.ttl has 2 classes (Person, Project)
    await browse.expectNodeCountInRange(1, 10)
  })

  test('Stats section shows node and edge counts after extraction', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await expect(browse.schemaStats()).toBeVisible()
    const nodes = await browse.getNodeCount()
    expect(nodes).toBeGreaterThan(0)
  })

  test('Cytoscape canvas becomes visible after extraction', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await expect(browse.schemaCanvas()).toBeVisible()
    await expect(browse.schemaCanvasEmpty()).not.toBeVisible()
  })
})

// ── Stop / cancel ─────────────────────────────────────────────────────────────

test.describe('Extraction — Stop button', () => {
  test('clicking Stop immediately hides the Stop button', async ({ page }) => {
    // Slow mock guarantees Phase 2 is still running when we click Stop
    const browse = await navigateWithSlowExtraction(page)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 10_000 })
    await browse.clickStop()
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 3_000 })
  })

  test('after stopping, neither Stop nor extracting state is active', async ({ page }) => {
    const browse = await navigateWithSlowExtraction(page)
    await expect(browse.stopBtn()).toBeVisible({ timeout: 10_000 })
    await browse.clickStop()
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 3_000 })
    const extractVisible = await browse.extractBtn().isVisible()
    const doneVisible    = await browse.schemaDone().isVisible()
    expect(extractVisible || doneVisible).toBe(true)
  })

  test('after stopping with partial schema, Re-extract button is available in options', async ({ page }) => {
    const browse = await navigateWithSlowExtraction(page)
    // Phase 1 completes fast (instant) so nodes are loaded; Phase 2 is still running
    await expect(browse.stopBtn()).toBeVisible({ timeout: 10_000 })
    // Wait until Phase 1 has delivered some nodes
    await expect(async () => {
      expect(await browse.getNodeCount()).toBeGreaterThan(0)
    }).toPass({ timeout: 10_000 })
    await browse.clickStop()
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 3_000 })
    // Nodes from Phase 1 are present → options section is shown
    await page.locator('.section-label.collapsible').click()
    await expect(browse.reextractBtn()).toBeVisible()
  })
})

// ── Schema extraction from mocked SPARQL ─────────────────────────────────────

test.describe('Schema extraction from mocked SPARQL endpoint', () => {
  test('auto-extracts 2 classes from mocked endpoint', async ({ page }) => {
    const browse = await goToBrowseViaSparql(page)
    const nodes = await browse.getNodeCount()
    expect(nodes).toBe(2)
  })

  test('Schema loaded indicator appears after mocked extraction', async ({ page }) => {
    const browse = await goToBrowseViaSparql(page)
    await browse.expectSchemaLoaded()
  })
})

// ── Toolbar controls ─────────────────────────────────────────────────────────

test.describe('Schema canvas toolbar', () => {
  test('toolbar appears after extraction completes', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await expect(browse.schemaToolbar()).toBeVisible()
  })

  test('zoom in button is clickable', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await browse.zoomIn()
  })

  test('zoom out button is clickable', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await browse.zoomOut()
  })

  test('fit to screen button is clickable', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await browse.fitGraph()
  })

  test('re-run layout button is clickable', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await browse.rerunLayout()
  })

  test('toggle edge labels button changes aria-label', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
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
    const browse = await goToBrowseWithExtractedSchema(page)
    await page.locator('.section-label.collapsible').click()
    await expect(browse.reextractBtn()).toBeVisible()
  })

  test('clicking Re-extract triggers a new extraction (Stop button appears)', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await page.locator('.section-label.collapsible').click()
    await browse.reextractBtn().click()
    // Re-extraction starts — Stop button should appear
    await expect(browse.stopBtn()).toBeVisible({ timeout: 5_000 })
  })

  test('Re-extract button is disabled while extraction is running', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    await page.locator('.section-label.collapsible').click()
    await browse.reextractBtn().click()
    if (await browse.stopBtn().isVisible()) {
      await expect(browse.reextractBtn()).toBeDisabled()
    }
  })
})

// ── Empty dataset ─────────────────────────────────────────────────────────────

test.describe('Empty dataset from mocked SPARQL', () => {
  test('shows empty canvas when endpoint returns no classes', async ({ page }) => {
    await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
      const body = route.request().postData() ?? route.request().url()
      if (body.includes('DISTINCT') && body.includes('class')) {
        // Phase 1: no classes
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(emptyClassesResponse) })
      } else {
        // Ping and everything else: valid empty response
        await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(pingResponse) })
      }
    })

    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await page.getByTestId('endpoint-url-input').fill(MOCK_ENDPOINT)
    await page.getByTestId('connect-btn').click()
    await expect(page).toHaveURL('/browse', { timeout: 15_000 })

    const browse = new BrowsePage(page)
    // Extraction starts and finishes quickly (0 classes → early return)
    // The Stop button may flash briefly; wait until it's gone
    await expect(browse.stopBtn()).not.toBeVisible({ timeout: 10_000 })

    await expect(browse.schemaCanvasEmpty()).toBeVisible()
    await expect(browse.extractBtn()).toBeVisible()
  })
})

// ── Schema cache persistence ──────────────────────────────────────────────────

test.describe('Schema cache persistence', () => {
  test('schema persists in localStorage across navigation (file key)', async ({ page }) => {
    const browse = await goToBrowseWithExtractedSchema(page)
    const nodesBefore = await browse.getNodeCount()
    expect(nodesBefore).toBeGreaterThan(0)

    // Go to Paths and back — Pinia state persists across Vue Router navigation
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph')
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse')

    await browse.expectSchemaLoaded()
    const nodesAfter = await browse.getNodeCount()
    expect(nodesAfter).toBe(nodesBefore)
  })
})

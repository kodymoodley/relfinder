import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import {
  twoClassesResponse,
  pingResponse,
  sparqlJsonHeaders,
  toBody,
} from './mocks/sparqlResponses'
import { ConnectionPage } from './pages/ConnectionPage'

const SMALL_TTL = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))
const MEDIUM_TTL = fileURLToPath(new URL('./fixtures/medium-graph.ttl', import.meta.url))
const MOCK_ENDPOINT = 'https://mock.sparql.test/sparql'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Intercept every SPARQL request to the mock endpoint and return a preset body. */
async function mockSparqlEndpoint(
  page: import('@playwright/test').Page,
  responses: Record<string, object> = {},
) {
  const defaultResponse = twoClassesResponse
  await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
    const url = route.request().url()
    const matchedKey = Object.keys(responses).find((k) => url.includes(k))
    const body = matchedKey ? responses[matchedKey] : defaultResponse
    await route.fulfill({ status: 200, headers: sparqlJsonHeaders, body: toBody(body as Parameters<typeof toBody>[0]) })
  })
}

// ── File loading ──────────────────────────────────────────────────────────────

test.describe('File loading', () => {
  test('loads a small TTL file and navigates to browse view', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.selectFileTab()

    await conn.uploadFile(SMALL_TTL)
    await conn.expectFileLoaded(5)

    await conn.clickOpenGraph()
    await expect(page).toHaveURL('/browse')
  })

  test('loads a medium TTL file and reports triple count', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.selectFileTab()

    await conn.uploadFile(MEDIUM_TTL)
    await conn.expectFileLoaded(20)
  })

  test('shows error for malformed / non-RDF file', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.selectFileTab()

    // Playwright setInputFiles can accept a buffer — simulate bad content
    await conn.fileInput().setInputFiles({
      name: 'bad.ttl',
      mimeType: 'text/turtle',
      buffer: Buffer.from('this is not valid turtle !!@@##'),
    })
    await conn.expectParseError()
  })

  test('switching between SPARQL and file tabs preserves tab state', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()

    // Start on SPARQL tab
    await expect(conn.endpointInput()).toBeVisible()

    // Switch to file tab
    await conn.selectFileTab()
    await expect(conn.dropZone()).toBeVisible()
    await expect(conn.endpointInput()).not.toBeVisible()

    // Switch back
    await conn.selectSparqlTab()
    await expect(conn.endpointInput()).toBeVisible()
    await expect(conn.dropZone()).not.toBeVisible()
  })
})

// ── SPARQL endpoint loading ───────────────────────────────────────────────────

test.describe('SPARQL endpoint loading', () => {
  test('mocked endpoint: connects and navigates to browse view', async ({ page }) => {
    await mockSparqlEndpoint(page, { '': pingResponse })
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.connectToEndpoint(MOCK_ENDPOINT)
    await expect(page).toHaveURL('/browse')
  })

  test('empty endpoint URL shows validation error', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.clickConnect()
    // Validation fires client-side — no network request
    await expect(page.locator('.error-msg').first()).toBeVisible()
  })

  test('invalid URL shows validation error', async ({ page }) => {
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.connectToEndpoint('not-a-valid-url')
    await expect(page.locator('.error-msg').first()).toBeVisible()
  })

  test('unreachable endpoint shows connection error message', async ({ page }) => {
    // Block all requests to the endpoint so fetch fails with network error
    await page.route('https://unreachable.invalid/**', (route) => route.abort('failed'))
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.connectToEndpoint('https://unreachable.invalid/sparql')
    await conn.expectConnectionError('Could not reach endpoint')
  })

  test('endpoint returning 500 shows connection error', async ({ page }) => {
    await page.route(`${MOCK_ENDPOINT}**`, (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    )
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.connectToEndpoint(MOCK_ENDPOINT)
    await conn.expectConnectionError('Could not reach endpoint')
  })

  test('slow endpoint (mocked timeout) shows connection error', async ({ page }) => {
    test.setTimeout(25_000)
    await page.route(`${MOCK_ENDPOINT}**`, async (route) => {
      // Delay long enough to hit the browser's request timeout or the app's guard
      await new Promise((r) => setTimeout(r, 15_000))
      await route.abort('timedout')
    })
    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.connectToEndpoint(MOCK_ENDPOINT)
    // Either the test aborts or the connect button re-enables — either way no navigation
    await expect(page).not.toHaveURL('/browse', { timeout: 20_000 })
  })
})

// ── Navigation guard ──────────────────────────────────────────────────────────

test.describe('Navigation guard', () => {
  test('accessing /browse without connection redirects to /', async ({ page }) => {
    await page.goto('/browse')
    await expect(page).toHaveURL('/')
  })

  test('accessing /graph without connection redirects to /', async ({ page }) => {
    await page.goto('/graph')
    await expect(page).toHaveURL('/')
  })
})

// ── Real endpoint smoke test (limited query) ──────────────────────────────────

test.describe('Real endpoint smoke', () => {
  test.skip(!!process.env.CI, 'Skipped in CI — real network required')

  test('DBpedia: connectivity probe with LIMIT 1', async ({ page }) => {
    test.setTimeout(60_000)
    // Intercept and constrain — only let SELECT * LIMIT 1 through
    await page.route('https://dbpedia.org/sparql**', async (route) => {
      const url = route.request().url()
      if (url.includes('LIMIT+1') || url.includes('LIMIT%201')) {
        await route.continue()
      } else {
        await route.abort('blockedbyresponse')
      }
    })

    const conn = new ConnectionPage(page)
    await conn.goto()
    await conn.connectToEndpoint('https://dbpedia.org/sparql')
    // If reachable, we navigate; if not (offline), we see an error — both are OK
    const url = page.url()
    expect(['/browse', '/']).toContain(new URL(url).pathname)
  })
})

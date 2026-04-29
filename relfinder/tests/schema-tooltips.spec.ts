import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BrowsePage } from './pages/BrowsePage'

const SMALL_TTL = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))

// IRIs from small-graph.ttl  (@prefix : <http://test.example.org/>)
const PERSON_IRI   = 'http://test.example.org/Person'
const PROJECT_IRI  = 'http://test.example.org/Project'
const WORKS_ON_IRI = 'http://test.example.org/worksOn'
const NAME_IRI     = 'http://test.example.org/name'

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Load small-graph.ttl, wait for auto-extraction and Cytoscape to be ready,
 * then wait for the one-time initial fit (800 ms) to settle.
 */
async function loadSchemaAndWait(page: Page): Promise<BrowsePage> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(SMALL_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse')
  const browse = new BrowsePage(page)
  await browse.waitForExtractionComplete(60_000)

  await expect(async () => {
    const zoom = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy?.zoom(),
    )
    expect(typeof zoom).toBe('number')
  }).toPass({ timeout: 5_000 })

  // Wait for the one-time cy.fit() scheduled 800 ms after layout start
  await page.waitForTimeout(1100)
  return browse
}

/**
 * Move the Playwright mouse to the centre of a Cytoscape node (by IRI) and
 * return the viewport coordinates used, so callers can move away again.
 */
async function hoverNode(page: Page, nodeIri: string): Promise<{ x: number; y: number }> {
  const pos = await page.evaluate((iri: string) => {
    const cy = (window as Window & { __schemaCy?: cytoscape.Core }).__schemaCy
    if (!cy) return null
    const node = cy.getElementById(iri)
    if (node.empty()) return null
    const rp = node.renderedPosition()
    const rect = (cy.container() as HTMLElement).getBoundingClientRect()
    return { x: rect.left + rp.x, y: rect.top + rp.y }
  }, nodeIri)

  if (!pos) throw new Error(`Node ${nodeIri} not found in Cytoscape`)
  await page.mouse.move(pos.x, pos.y)
  return pos
}

/**
 * Move the Playwright mouse to the midpoint of the first Cytoscape edge and
 * return its viewport coordinates.
 */
async function hoverFirstEdge(page: Page): Promise<{ x: number; y: number }> {
  const pos = await page.evaluate(() => {
    const cy = (window as Window & { __schemaCy?: cytoscape.Core }).__schemaCy
    if (!cy) return null
    const edge = cy.edges().first()
    if (edge.empty()) return null
    const src = edge.source().renderedPosition()
    const tgt = edge.target().renderedPosition()
    const rect = (cy.container() as HTMLElement).getBoundingClientRect()
    return {
      x: rect.left + (src.x + tgt.x) / 2,
      y: rect.top  + (src.y + tgt.y) / 2,
    }
  })

  if (!pos) throw new Error('No edge found in Cytoscape')
  await page.mouse.move(pos.x, pos.y)
  return pos
}

// ── Node tooltip ──────────────────────────────────────────────────────────────

test.describe('Node hover tooltip', () => {
  test('tooltip becomes visible when hovering a node', async ({ page }) => {
    await loadSchemaAndWait(page)
    await hoverNode(page, PERSON_IRI)
    await expect(page.locator('.cy-tooltip--visible')).toBeVisible({ timeout: 2_000 })
  })

  test('tooltip shows the full class IRI', async ({ page }) => {
    await loadSchemaAndWait(page)
    await hoverNode(page, PERSON_IRI)
    await expect(page.locator('.cy-tooltip--visible .tt-iri')).toContainText(PERSON_IRI, { timeout: 2_000 })
  })

  test('tooltip shows the outgoing object property IRI', async ({ page }) => {
    await loadSchemaAndWait(page)
    // Person has worksOn → Project
    await hoverNode(page, PERSON_IRI)
    await expect(page.locator('.cy-tooltip--visible')).toContainText(WORKS_ON_IRI, { timeout: 2_000 })
  })

  test('tooltip shows the incoming connection section for Project', async ({ page }) => {
    await loadSchemaAndWait(page)
    // Project receives worksOn from Person
    await hoverNode(page, PROJECT_IRI)
    const tooltip = page.locator('.cy-tooltip--visible')
    await expect(tooltip).toContainText('Incoming', { timeout: 2_000 })
    await expect(tooltip).toContainText(WORKS_ON_IRI)
  })

  test('data properties section appears and loads the data property IRI', async ({ page }) => {
    await loadSchemaAndWait(page)
    await hoverNode(page, PERSON_IRI)
    const tooltip = page.locator('.cy-tooltip--visible')
    await expect(tooltip).toContainText('Data Properties', { timeout: 2_000 })
    // Background fetch completes; loading indicator clears
    await expect(tooltip.locator('.tt-loading').filter({ hasText: 'Loading' })).not.toBeVisible({ timeout: 10_000 })
    await expect(tooltip).toContainText(NAME_IRI)
  })

  test('tooltip disappears when the mouse leaves the node', async ({ page }) => {
    await loadSchemaAndWait(page)
    const pos = await hoverNode(page, PERSON_IRI)
    await expect(page.locator('.cy-tooltip--visible')).toBeVisible({ timeout: 2_000 })

    // Move mouse well away from the node
    await page.mouse.move(pos.x + 200, pos.y + 200)
    await expect(page.locator('.cy-tooltip--visible')).not.toBeVisible({ timeout: 2_000 })
  })

  test('tooltip updates to show different content when hovering a different node', async ({ page }) => {
    await loadSchemaAndWait(page)
    await hoverNode(page, PERSON_IRI)
    await expect(page.locator('.cy-tooltip--visible .tt-iri')).toContainText(PERSON_IRI, { timeout: 2_000 })

    await hoverNode(page, PROJECT_IRI)
    await expect(page.locator('.cy-tooltip--visible .tt-iri')).toContainText(PROJECT_IRI, { timeout: 2_000 })
  })
})

// ── Edge tooltip ──────────────────────────────────────────────────────────────

test.describe('Edge hover tooltip', () => {
  test('tooltip shows property IRI when hovering the edge', async ({ page }) => {
    await loadSchemaAndWait(page)
    await hoverFirstEdge(page)
    // Edge tooltip may take a moment to appear as Cytoscape hit-tests the midpoint
    await expect(page.locator('.cy-tooltip--visible')).toContainText(WORKS_ON_IRI, { timeout: 3_000 })
  })

  test('edge tooltip contains the Properties section header', async ({ page }) => {
    await loadSchemaAndWait(page)
    await hoverFirstEdge(page)
    await expect(page.locator('.cy-tooltip--visible')).toContainText('Properties', { timeout: 3_000 })
  })
})

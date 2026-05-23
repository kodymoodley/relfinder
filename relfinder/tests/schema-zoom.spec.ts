import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { BrowsePage } from './pages/BrowsePage'

const SMALL_TTL = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))

async function loadSchemaAndWait(page: import('@playwright/test').Page): Promise<BrowsePage> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(SMALL_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 15_000 })
  const browse = new BrowsePage(page)
  await browse.waitForExtractionComplete(60_000)
  // Wait for Cytoscape to mount and expose __schemaCy
  await expect(async () => {
    const zoom = await page.evaluate(() => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy?.zoom())
    expect(typeof zoom).toBe('number')
  }).toPass({ timeout: 5_000 })
  // runLayout schedules cy.fit() 800 ms after init — wait for it to settle
  // before any test reads or manipulates zoom, otherwise the fit fires mid-test
  await page.waitForTimeout(1500)
  return browse
}

// ── Zoom controls ─────────────────────────────────────────────────────────────

test.describe('Schema canvas zoom', () => {
  test('zoom level increases after clicking zoom-in', async ({ page }) => {
    const browse = await loadSchemaAndWait(page)

    const zoomBefore = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy!.zoom(),
    )

    await browse.zoomIn()
    await browse.zoomIn()

    const zoomAfter = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy!.zoom(),
    )

    expect(zoomAfter).toBeGreaterThan(zoomBefore)
  })

  test('zoom level decreases after clicking zoom-out', async ({ page }) => {
    const browse = await loadSchemaAndWait(page)

    const zoomBefore = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy!.zoom(),
    )

    await browse.zoomOut()
    await browse.zoomOut()

    const zoomAfter = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy!.zoom(),
    )

    expect(zoomAfter).toBeLessThan(zoomBefore)
  })

  test('zoom does not snap back after zooming in (regression: d3-force fit: true)', async ({ page }) => {
    const browse = await loadSchemaAndWait(page)

    // Zoom in a few times to move clearly away from the default level
    await browse.zoomIn()
    await browse.zoomIn()
    await browse.zoomIn()

    const zoomAfterClick = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy!.zoom(),
    )

    // Wait longer than one layout tick — if fit: true were still present the zoom
    // would have snapped back by now
    await page.waitForTimeout(600)

    const zoomAfterWait = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy!.zoom(),
    )

    // Zoom must stay within 5% of what it was immediately after the clicks
    expect(zoomAfterWait).toBeGreaterThan(zoomAfterClick * 0.95)
  })
})

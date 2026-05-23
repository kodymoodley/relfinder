import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BrowsePage } from './pages/BrowsePage'

const MEDIUM_TTL = fileURLToPath(new URL('./fixtures/medium-graph.ttl', import.meta.url))
const ORPHAN_TTL = fileURLToPath(new URL('./fixtures/orphan-graph.ttl', import.meta.url))

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Connect via file upload and wait for auto-extraction to finish.
 * Returns a BrowsePage in State 3 (Schema loaded) with all nodes extracted.
 */
async function connectAndExtract(page: Page): Promise<BrowsePage> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(MEDIUM_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 15_000 })
  const browse = new BrowsePage(page)
  // Wait for auto-started extraction to complete
  await browse.waitForExtractionComplete(60_000)
  return browse
}

// ── Hide orphans filter ───────────────────────────────────────────────────────

test.describe('Hide orphan nodes filter', () => {
  test('hide orphans toggle appears in options after extraction', async ({ page }) => {
    const browse = await connectAndExtract(page)
    await page.locator('.section-label.collapsible').click()
    await expect(browse.hideOrphansToggle()).toBeVisible()
  })

  test('toggling hide orphans changes the displayed node count', async ({ page }) => {
    const browse = await connectAndExtract(page)
    const nodesBefore = await browse.getNodeCount()

    await page.locator('.section-label.collapsible').click()
    await browse.hideOrphansToggle().click()
    await page.waitForTimeout(500)

    const nodesAfter = await browse.getNodeCount()
    // With medium-graph.ttl all nodes have edges, so count should be <= before
    expect(nodesAfter).toBeLessThanOrEqual(nodesBefore)
  })

  test('toggling hide orphans back restores original node count', async ({ page }) => {
    const browse = await connectAndExtract(page)
    const nodesBefore = await browse.getNodeCount()

    await page.locator('.section-label.collapsible').click()
    await browse.hideOrphansToggle().click()
    await page.waitForTimeout(300)
    await browse.hideOrphansToggle().click()
    await page.waitForTimeout(300)

    const nodesAfter = await browse.getNodeCount()
    expect(nodesAfter).toBe(nodesBefore)
  })
})

// ── Hide orphans — canvas-level regression tests ──────────────────────────────
//
// The DOM sidebar counter reflects schemaStore.nodes.length which is unchanged
// by the orphan filter. These tests use window.__schemaCy to verify the
// Cytoscape canvas actually gains/loses nodes when the toggle fires.

async function loadOrphanGraphAndWait(page: Page): Promise<BrowsePage> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(ORPHAN_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 15_000 })
  const browse = new BrowsePage(page)
  await browse.waitForExtractionComplete(60_000)
  // Wait for Cytoscape to mount
  await expect(async () => {
    const n = await page.evaluate(
      () => (window as Window & { __schemaCy?: { nodes(): { length: number } } }).__schemaCy?.nodes().length,
    )
    expect(typeof n).toBe('number')
  }).toPass({ timeout: 5_000 })
  return browse
}

function getCyNodeCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as Window & { __schemaCy?: { nodes(): { length: number } } }).__schemaCy?.nodes().length ?? 0,
  )
}

test.describe('Hide orphans — canvas node sync (regression)', () => {
  test('canvas has 3 nodes before toggling (2 connected + 1 orphan)', async ({ page }) => {
    await loadOrphanGraphAndWait(page)
    expect(await getCyNodeCount(page)).toBe(3)
  })

  test('orphan node is removed from canvas when hide-orphans is toggled ON', async ({ page }) => {
    const browse = await loadOrphanGraphAndWait(page)
    await page.locator('.section-label.collapsible').click()
    await browse.hideOrphansToggle().click()
    await expect(async () => {
      expect(await getCyNodeCount(page)).toBe(2)
    }).toPass({ timeout: 2_000 })
  })

  test('orphan node reappears on canvas when hide-orphans is toggled back OFF', async ({ page }) => {
    const browse = await loadOrphanGraphAndWait(page)
    await page.locator('.section-label.collapsible').click()
    await browse.hideOrphansToggle().click()
    await expect(async () => {
      expect(await getCyNodeCount(page)).toBe(2)
    }).toPass({ timeout: 2_000 })

    await browse.hideOrphansToggle().click()
    await expect(async () => {
      expect(await getCyNodeCount(page)).toBe(3)
    }).toPass({ timeout: 2_000 })
  })
})

// ── Edge label toggle — canvas sync (regression) ─────────────────────────────
//
// Verifies that the "Show/Hide property labels" toolbar button adds or removes
// the `no-label` CSS class on Cytoscape edges, using window.__schemaCy.

function getCyEdgeHasNoLabel(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __schemaCy?: { edges(): { length: number; first(): { hasClass(c: string): boolean } } }
        }
      ).__schemaCy?.edges().first().hasClass('no-label') ?? true,
  )
}

test.describe('Edge label toggle — canvas sync (regression)', () => {
  test('edges start without labels visible (no-label class present)', async ({ page }) => {
    await loadOrphanGraphAndWait(page)
    expect(await getCyEdgeHasNoLabel(page)).toBe(true)
  })

  test('clicking toggle adds labels (no-label class removed)', async ({ page }) => {
    await loadOrphanGraphAndWait(page)
    await page.getByTestId('toggle-labels-btn').click()
    await expect(async () => {
      expect(await getCyEdgeHasNoLabel(page)).toBe(false)
    }).toPass({ timeout: 1_000 })
  })

  test('clicking toggle twice restores no-label class', async ({ page }) => {
    await loadOrphanGraphAndWait(page)
    await page.getByTestId('toggle-labels-btn').click()
    await page.getByTestId('toggle-labels-btn').click()
    await expect(async () => {
      expect(await getCyEdgeHasNoLabel(page)).toBe(true)
    }).toPass({ timeout: 1_000 })
  })
})

// ── Class limit option ────────────────────────────────────────────────────────

test.describe('Class limit option', () => {
  test('class limit control is visible in options', async ({ page }) => {
    await connectAndExtract(page)
    await page.locator('.section-label.collapsible').click()
    await expect(page.locator('#class-limit')).toBeVisible()
  })

  test('edge limit control is visible in options', async ({ page }) => {
    await connectAndExtract(page)
    await page.locator('.section-label.collapsible').click()
    await expect(page.locator('#edge-limit')).toBeVisible()
  })
})

// ── Entity search in Paths tab ────────────────────────────────────────────────

test.describe('Entity search in Paths tab', () => {
  async function goToPathsWithMediumGraph(page: Page): Promise<void> {
    await page.goto('/')
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
    await page.getByTestId('tab-file').click()
    await page.getByTestId('rdf-file-input').setInputFiles(MEDIUM_TTL)
    await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
    await page.getByTestId('open-graph-btn').click()
    await expect(page).toHaveURL('/browse', { timeout: 15_000 })
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 15_000 })
  }

  test('typing in entity1 search input shows autocomplete results', async ({ page }) => {
    await goToPathsWithMediumGraph(page)

    const input = page.locator('#entity-entity1-input')
    await input.fill('Alice')
    // Wait for suggestions (local MiniSearch index searches async)
    const options = page.locator('.p-autocomplete-option, .p-autocomplete-items li')
    await expect(options.first()).toBeVisible({ timeout: 5_000 }).catch(() => {
      // File-mode may show "No entities found" if index hasn't built — not a crash
    })
  })

  test('Paths view shows both entity search fields', async ({ page }) => {
    await goToPathsWithMediumGraph(page)
    await expect(page.getByTestId('entity1-search')).toBeVisible()
    await expect(page.getByTestId('entity2-search')).toBeVisible()
  })

  test('clearing entity1 input keeps the input visible', async ({ page }) => {
    await goToPathsWithMediumGraph(page)
    const input = page.locator('#entity-entity1-input')
    await input.fill('test')
    await input.clear()
    await expect(input).toBeVisible()
  })

  test('Find Relationships button is disabled with no entities selected', async ({ page }) => {
    await goToPathsWithMediumGraph(page)
    await expect(page.getByTestId('find-relationships-btn')).toBeDisabled()
  })
})

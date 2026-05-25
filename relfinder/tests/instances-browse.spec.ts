import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BrowsePage } from './pages/BrowsePage'

const SMALL_TTL   = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))
const PERSON_IRI  = 'http://test.example.org/Person'
const PROJECT_IRI = 'http://test.example.org/Project'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadSchemaAndWait(page: Page): Promise<BrowsePage> {
  await page.goto('/')
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear() })
  await page.getByTestId('tab-file').click()
  await page.getByTestId('rdf-file-input').setInputFiles(SMALL_TTL)
  await expect(page.getByTestId('rdf-drop-zone')).toContainText('triples loaded', { timeout: 10_000 })
  await page.getByTestId('open-graph-btn').click()
  await expect(page).toHaveURL('/browse', { timeout: 15_000 })
  const browse = new BrowsePage(page)
  await browse.waitForExtractionComplete(60_000)

  // Wait for __schemaCy to be available and the initial fit to settle
  await expect(async () => {
    const zoom = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy?.zoom(),
    )
    expect(typeof zoom).toBe('number')
  }).toPass({ timeout: 5_000 })
  await page.waitForTimeout(1100)

  return browse
}

/** Click a Cytoscape node by IRI to open the detail drawer. */
async function clickNode(page: Page, nodeIri: string): Promise<void> {
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
  await page.mouse.click(pos.x, pos.y)
}

// ── Instances panel ───────────────────────────────────────────────────────────

test.describe('Instances panel in SchemaDetailPanel', () => {
  test('clicking a class node opens the detail drawer', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(page.locator('.p-drawer')).toBeVisible({ timeout: 3_000 })
  })

  test('drawer header shows the class label', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(page.locator('.p-drawer-header')).toContainText('Person', { timeout: 3_000 })
  })

  test('Instances section label is visible after opening a class node', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(page.locator('.p-drawer')).toBeVisible({ timeout: 3_000 })
    // The section label contains "Instances" — scoped to drawer to avoid false matches
    await expect(
      page.locator('.p-drawer-content').getByText('Instances'),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('Person class shows Alice and Bob as instances', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(page.locator('.p-drawer')).toBeVisible({ timeout: 3_000 })
    // Instances are prefetched during extraction — should be ready quickly
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Bob' }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Project class shows its instances', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PROJECT_IRI)
    await expect(page.locator('.p-drawer')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('.p-drawer-header')).toContainText('Project', { timeout: 3_000 })
    // Project Alpha and Project Beta are in the fixture
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Project' }).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('"Set as start" button is visible for each instance', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Set as start' }).first()).toBeVisible()
  })

  test('instance search filter narrows the list', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 10_000 })

    // Type in the filter input
    await page.locator('.instance-search-input').fill('ali')
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible()
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Bob' }),
    ).not.toBeVisible()
  })
})

// ── Find Paths flow ───────────────────────────────────────────────────────────

test.describe('Find Paths flow from Browse view', () => {
  test('clicking "Set as start" shows start chip with the entity label', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 10_000 })

    // Set Alice as start
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    await expect(page.locator('.start-chip')).toBeVisible()
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
  })

  test('"Find path →" button appears on non-start instances after setting a start', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 10_000 })

    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // "Find path →" must appear on Bob (the other Person instance)
    await expect(
      page.locator('.instance-item').filter({ hasText: 'Bob' })
        .getByRole('button', { name: /Find path/ }),
    ).toBeVisible()
  })

  test('"Set as start" row shows no action button after selection', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 10_000 })

    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Alice's row must not show "Set as start" or "Find path →"
    const aliceItem = page.locator('.instance-item').filter({ hasText: 'Alice' })
    await expect(aliceItem.getByRole('button', { name: 'Set as start' })).not.toBeVisible()
    await expect(aliceItem.getByRole('button', { name: /Find path/ })).not.toBeVisible()
  })

  test('clicking "Find path →" navigates to /graph', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 10_000 })

    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
  })

  test('/graph is pre-populated with source (Alice) and target (Bob) entities', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickNode(page, PERSON_IRI)
    await expect(
      page.locator('.instance-label').filter({ hasText: 'Alice' }),
    ).toBeVisible({ timeout: 10_000 })

    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // EntitySearch renders chips for preset entities
    const chips = page.locator('.selected-chip .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
  })
})

/**
 * E2E tests for the "Set as start → Find path" cross-component flow and the
 * graphPreset same-route navigation fix.
 *
 * Key scenarios:
 *  1. Shared start-entity state between SchemaDetailPanel and CommandPalette
 *  2. Start entity persists across palette open/close and query changes
 *  3. Find path navigates to /graph with correct entity presets
 *  4. Same-route navigation: graphPreset updates entity slots even when GraphView
 *     is already the active tab (this was the original regression)
 *  5. Creative edge cases analogous to the bugs we fixed
 */
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BrowsePage } from './pages/BrowsePage'

const SMALL_TTL  = fileURLToPath(new URL('./fixtures/small-graph.ttl', import.meta.url))
const PERSON_IRI = 'http://test.example.org/Person'

// ── Setup helpers ─────────────────────────────────────────────────────────────

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

  await expect(async () => {
    const zoom = await page.evaluate(
      () => (window as Window & { __schemaCy?: { zoom(): number } }).__schemaCy?.zoom(),
    )
    expect(typeof zoom).toBe('number')
  }).toPass({ timeout: 5_000 })
  await page.waitForTimeout(1100)

  return browse
}

async function clickSchemaNode(page: Page, nodeIri: string): Promise<void> {
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

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(page.locator('.palette-input')).toBeVisible({ timeout: 2_000 })
}

async function closePalette(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.locator('.palette-input')).not.toBeVisible({ timeout: 2_000 })
}

async function searchInPalette(page: Page, query: string): Promise<void> {
  await page.locator('.palette-input').fill(query)
  // Wait for debounce + async search
  await page.waitForTimeout(500)
}

// ── 1. Cross-component shared start state ─────────────────────────────────────

test.describe('shared pathStartEntity state', () => {
  test('setting start in class pane → palette shows "Find path →" for other instances', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    // Set Alice as start in the class pane
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Open palette and search for Person instances
    await openPalette(page)
    await searchInPalette(page, 'Bob')

    // Bob should show "Find path →" because pathStartEntity (Alice) is already set
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action--path'),
    ).toBeVisible({ timeout: 5_000 })
    // ...and "Set as start" must NOT be shown
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action:not(.palette-inst-action--path)'),
    ).not.toBeVisible()
  })

  test('setting start in palette → class pane shows the start chip', async ({ page }) => {
    await loadSchemaAndWait(page)

    // Open palette, search for Alice, set as start
    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' })
      .locator('.palette-inst-action').click()
    await closePalette(page)

    // Open the Person class drawer — start chip should reflect the palette selection
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.p-drawer')).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    await expect(page.locator('.start-chip')).toBeVisible()
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
  })

  test('start chip is absent in class pane when no start has been set', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    await expect(page.locator('.start-chip')).not.toBeVisible()
  })
})

// ── 2. Start entity persistence ───────────────────────────────────────────────

test.describe('pathStartEntity persistence', () => {
  test('start entity persists after closing and reopening the palette', async ({ page }) => {
    await loadSchemaAndWait(page)

    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()
    await closePalette(page)

    // Reopen — start must still be active
    await openPalette(page)
    await searchInPalette(page, 'Bob')
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action--path'),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('start entity persists after changing the search query in the palette', async ({ page }) => {
    await loadSchemaAndWait(page)

    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()

    // Change the query — must NOT reset the pending start
    await searchInPalette(page, 'Bob')
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action--path'),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('start chip persists when the user switches to a different class node', async ({ page }) => {
    // Verifies that navigating between class nodes does not clear the start.
    // Before the fix, SchemaDetailPanel had a local pendingStart that could
    // be lost on class change; now it's a shared module ref.
    const PROJECT_IRI = 'http://test.example.org/Project'

    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Close drawer and click a different class
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await clickSchemaNode(page, PROJECT_IRI)
    await expect(page.locator('.p-drawer-header')).toContainText('Project', { timeout: 3_000 })
    await expect(page.locator('.instance-label').first()).toBeVisible({ timeout: 10_000 })

    // Start chip must still show Alice
    await expect(page.locator('.start-chip')).toBeVisible()
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
  })

  test('start is cleared by the × button and palette reverts to "Set as start"', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    await expect(page.locator('.start-chip')).toBeVisible()
    await page.locator('.start-chip-clear').click()
    await expect(page.locator('.start-chip')).not.toBeVisible()

    // Palette should now show "Set as start" again
    await openPalette(page)
    await searchInPalette(page, 'Bob')
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action:not(.palette-inst-action--path)'),
    ).toBeVisible({ timeout: 5_000 })
  })
})

// ── 3. Navigation to /graph with correct entity presets ───────────────────────

test.describe('Find path navigation', () => {
  test('class pane find path navigates to /graph', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
  })

  test('/graph is pre-populated with the correct source and target from class pane', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
  })

  test('palette find path navigates to /graph with correct entities', async ({ page }) => {
    await loadSchemaAndWait(page)

    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()

    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action--path').click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
  })

  test('pathStartEntity is null after a successful find-path (palette)', async ({ page }) => {
    // After navigating to /graph, going back to browse and opening the class
    // pane must show no start chip — start was consumed by the navigation.
    await loadSchemaAndWait(page)

    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()
    await searchInPalette(page, 'Bob')
    await page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action--path').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Navigate back to browse
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    await expect(page.locator('.start-chip')).not.toBeVisible()
  })

  test('pathStartEntity is null after a successful find-path (class pane)', async ({ page }) => {
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    await expect(page.locator('.start-chip')).not.toBeVisible()
  })
})

// ── 4. Same-route navigation regression ──────────────────────────────────────
//
// This is the primary bug: when GraphView is already the active tab, calling
// router.push({ name: 'graph', state: { example: ... } }) was a no-op because
// Vue Router deduplicated the navigation and onActivated never re-fired.
// The fix uses a reactive graphPreset ref with { immediate: true } so GraphView
// updates regardless of its activation state.

test.describe('same-route entity preset (graphPreset)', () => {
  test('entity slots update when finding a path via palette while already on /graph', async ({ page }) => {
    // Step 1: navigate to /graph with Alice + Bob already set
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Verify Alice / Bob are in entity slots
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })

    // Step 2: while still on /graph, use the palette to set a new pair
    await openPalette(page)
    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    // Bob is now the new "start"
    await page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action').click()

    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    // Find path from Bob → Alice (same route as before, different direction)
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action--path').click()

    // Still on /graph — entity slots must have updated without a tab switch
    await expect(page).toHaveURL('/graph')
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
  })

  test('entity slots update when finding path via class pane while already on /graph', async ({ page }) => {
    // Navigate to /graph first
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Switch back to browse, open class pane, set Bob → Alice
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
  })
})

// ── 5. Creative edge cases ────────────────────────────────────────────────────
//
// These anticipate bugs analogous to those fixed — same pattern, different surface.

test.describe('creative edge cases', () => {
  test('viewing instance info (ⓘ) does not clear a pending start entity', async ({ page }) => {
    // palettePreviewEntity and pathStartEntity are independent refs.
    // Clicking ⓘ sets palettePreviewEntity; it must not touch pathStartEntity.
    await loadSchemaAndWait(page)

    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click() // Set as start

    // Click the ⓘ info button for Alice — should open NodeDetail, not disturb start
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-info').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 }) // navigated to graph for NodeDetail

    // Navigate back and verify start is still set
    await page.goBack()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })
    await openPalette(page)
    await searchInPalette(page, 'Bob')
    // Bob should show "Find path →" because Alice is still the pending start
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action--path'),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('rapidly clicking "Set as start" twice takes the last entity as start', async ({ page }) => {
    // Ensures last-write-wins for rapid clicks — no intermediate state leaks.
    await loadSchemaAndWait(page)
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    // Click Alice as start, then immediately Bob as start
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    // After Alice is start, Bob shows "Find path →" — click "Set as start" is gone for Alice
    // so we must clear first and re-set Bob
    await page.locator('.start-chip-clear').click()
    await expect(page.locator('.start-chip')).not.toBeVisible()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Bob should now be the start
    await expect(page.locator('.start-chip-label')).toContainText('Bob')
    // Alice should show "Find path →"
    await expect(
      page.locator('.instance-item').filter({ hasText: 'Alice' }).getByRole('button', { name: /Find path/ }),
    ).toBeVisible()
  })

  test('graphPreset applied only once — tab-switching back does not re-apply stale preset', async ({ page }) => {
    // After graphPreset is consumed (set to null), navigating away from and back
    // to /graph must NOT re-apply the old preset. This guards against a
    // hypothetical regression where the immediate watcher re-fires on re-mount
    // with a non-null cached value.
    await loadSchemaAndWait(page)

    // Set a path via class pane
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })

    // Switch away and back — entity slots must retain the last state, not be
    // reset by a ghost graphPreset value
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 3_000 })
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 3_000 })

    // Entities should still show Alice and Bob (from last navigation), not blank
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 3_000 })
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 3_000 })
  })

  test('cross-class find path: start from Person, target from Project', async ({ page }) => {
    // Ensures class: field is preserved correctly when entities come from
    // different classes — the graphPreset stores { class } for each entity.
    const PROJECT_IRI = 'http://test.example.org/Project'

    await loadSchemaAndWait(page)

    // Set Alice (Person) as start from class pane
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Close Person drawer, open Project drawer
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await clickSchemaNode(page, PROJECT_IRI)
    await expect(page.locator('.p-drawer-header')).toContainText('Project', { timeout: 3_000 })

    // Start chip must still show Alice
    await expect(page.locator('.start-chip-label')).toContainText('Alice')

    // Project instances should show "Find path →"
    await expect(
      page.locator('.instance-item').first().getByRole('button', { name: /Find path/ }),
    ).toBeVisible({ timeout: 10_000 })

    // Click find path
    await page.locator('.instance-item').first().getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    // Alice chip must be visible (source is still Alice)
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
  })

  test('palette "Find path →" button absent when start entity matches the result', async ({ page }) => {
    // The same entity cannot be both start and target.
    // Both "Set as start" and "Find path →" must be absent for Alice's own row
    // after Alice is set as start.
    await loadSchemaAndWait(page)

    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()

    // Alice is now the start. Search again — Alice's own row should show no action button.
    await searchInPalette(page, 'Alice')
    const aliceItem = page.locator('.palette-item').filter({ hasText: 'Alice' })
    await expect(aliceItem).toBeVisible({ timeout: 5_000 })
    await expect(aliceItem.locator('.palette-inst-action')).not.toBeVisible()
    await expect(aliceItem.locator('.palette-inst-action--path')).not.toBeVisible()
  })

  test('palette label for the start entity has the --start highlight class', async ({ page }) => {
    await loadSchemaAndWait(page)

    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()

    // Search again — Alice's label span should carry the --start modifier
    await searchInPalette(page, 'Alice')
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-label--start'),
    ).toBeVisible({ timeout: 5_000 })
  })
})

// ── 6. Interaction-ordering permutations ──────────────────────────────────────
//
// These test multi-step, back-and-forth sequences that stress the shared mutable
// state. Each test picks a different ordering of: set-start source (palette vs.
// class-pane), clear, overwrite, find-path sink (palette vs. class-pane), and
// manual navigation — looking for state leaks or ghost values.

test.describe('interaction-ordering permutations', () => {

  // ── Palette start → class-pane find path ─────────────────────────────────
  // Inverse of the "class pane start → palette find path" test above.

  test('[palette start] → [class pane find path] produces correct entities', async ({ page }) => {
    await loadSchemaAndWait(page)

    // Set Alice as start from the palette
    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()
    await closePalette(page)

    // Open the class drawer — chip must show Alice, Bob must offer "Find path →"
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')

    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
  })

  // ── Overwrite start: class pane → palette ────────────────────────────────
  // Set start in class pane, then overwrite it from the palette with a different
  // entity. The final start should be the palette's choice everywhere.

  test('[class pane: set Alice] → [palette: overwrite with Bob] → both views show Bob as start', async ({ page }) => {
    await loadSchemaAndWait(page)

    // Set Alice as start from class pane
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await expect(page.locator('.start-chip-label')).toContainText('Alice')

    // Overwrite with Bob from the palette
    await openPalette(page)
    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    // Bob shows "Find path →" (because Alice is current start), not "Set as start"
    // — click the "Find path →" then immediately re-open to overwrite the start
    // Actually: we want to SET Bob as start, so we need to first clear Alice.
    // The palette doesn't have a clear button; clear from the class pane chip.
    await closePalette(page)

    await page.locator('.start-chip-clear').click()
    await expect(page.locator('.start-chip')).not.toBeVisible()

    // Now set Bob as start from the palette
    await openPalette(page)
    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action').click()
    await closePalette(page)

    // Class pane chip must reflect Bob, not Alice
    await expect(page.locator('.start-chip-label')).toContainText('Bob')
    // Alice's row must show "Find path →"
    await expect(
      page.locator('.instance-item').filter({ hasText: 'Alice' }).getByRole('button', { name: /Find path/ }),
    ).toBeVisible()
  })

  // ── Overwrite start: palette → class pane ────────────────────────────────

  test('[palette: set Alice] → [class pane: clear] → [class pane: set Bob] → find path navigates correctly', async ({ page }) => {
    await loadSchemaAndWait(page)

    // Set Alice from palette
    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()
    await closePalette(page)

    // Open class pane — clear Alice, set Bob
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
    await page.locator('.start-chip-clear').click()
    await expect(page.locator('.start-chip')).not.toBeVisible()

    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: 'Set as start' }).click()
    await expect(page.locator('.start-chip-label')).toContainText('Bob')

    // Find path from class pane (Alice as target)
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
  })

  // ── Two consecutive find-path operations ─────────────────────────────────
  // First path: class pane. Second path: palette. Verifies no state bleeds
  // between operations and graphPreset is correctly reset each time.

  test('[class pane path: Alice→Bob] → [palette path: Bob→Alice] both update /graph correctly', async ({ page }) => {
    await loadSchemaAndWait(page)

    // First path via class pane
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })

    // Second path via palette (reversed) while already on /graph
    await openPalette(page)
    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action').click()
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action--path').click()

    await expect(page).toHaveURL('/graph')
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
  })

  // ── Manual nav to /graph while start is pending ──────────────────────────
  // User sets start then navigates to /graph manually (not via "Find path →").
  // The pending start must survive and still be visible in the class pane
  // when the user navigates back to browse.

  test('[set start in class pane] → [manual nav to /graph] → [back to browse] → start chip still present', async ({ page }) => {
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Navigate to /graph via the Paths tab (not "Find path →")
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Navigate back
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    // Start chip must still show Alice (pending start was not consumed by manual nav)
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
  })

  // ── Set start, close drawer, reopen same class, start still there ─────────
  // Guards against a regression where closing the drawer and reopening it for
  // the same class could reset pendingStart (it was local state before the fix).

  test('[set start] → [close drawer] → [reopen same class] → start chip still visible', async ({ page }) => {
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Close the drawer
    await page.keyboard.press('Escape')
    await expect(page.locator('.p-drawer')).not.toBeVisible({ timeout: 2_000 })

    // Reopen the same class node
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    await expect(page.locator('.start-chip-label')).toContainText('Alice')
    await expect(
      page.locator('.instance-item').filter({ hasText: 'Bob' }).getByRole('button', { name: /Find path/ }),
    ).toBeVisible()
  })

  // ── Browse → /graph → browse → palette → find path (long round-trip) ──────
  // A multi-step journey that ends with a palette-driven same-route update.
  // Validates that no accumulated state or stale closure causes a wrong result.

  test('[class pane path] → [back to browse] → [palette set start] → [palette find path on /graph] → correct entities', async ({ page }) => {
    await loadSchemaAndWait(page)

    // Step 1: initial path via class pane
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Step 2: go back to browse
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })

    // Step 3: set new start in palette
    await openPalette(page)
    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action').click()
    await closePalette(page)

    // Step 4: navigate to /graph manually
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Step 5: palette find path (already on /graph — same-route)
    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action--path').click()

    await expect(page).toHaveURL('/graph')
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
  })

  // ── Palette: set start → search changes → start entity no longer in results ─
  // The start entity may not appear in new search results (e.g., typed a different
  // name). "Find path →" must still appear on results, using the hidden start.

  test('start entity absent from current palette results still drives "Find path →"', async ({ page }) => {
    await loadSchemaAndWait(page)

    // Set Alice as start
    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()

    // Search for something unrelated — Alice no longer visible
    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).not.toBeVisible()

    // Bob (not Alice) should show "Find path →", proving pathStartEntity is still Alice
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action--path'),
    ).toBeVisible()
    // And NOT "Set as start"
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action:not(.palette-inst-action--path)'),
    ).not.toBeVisible()
  })

  // ── Three-step palette flow: set start → close → reopen → overwrite start ──
  // Checks that closing the palette between setting and overwriting a start
  // doesn't resurrect the old start.

  test('[palette: set Alice] → [close] → [reopen: overwrite with Bob] → find path uses Bob as start', async ({ page }) => {
    await loadSchemaAndWait(page)

    // Set Alice as start
    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()
    await closePalette(page)

    // Reopen and clear (via class pane chip), then re-set Bob
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
    await page.locator('.start-chip-clear').click()

    await openPalette(page)
    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-action').click()

    await searchInPalette(page, 'Alice')
    await expect(
      page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action--path'),
    ).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action--path').click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    const chips = page.locator('.selected-chip--locked .chip-label')
    // Bob is the start, Alice is the target
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
  })
})

// ── 7. Pane open/close and tab-switch sequences ───────────────────────────────
//
// Tests that methodically combine: opening/closing class drawers in different
// orders, multiple tab switches, and browser back/forward — checking that
// pathStartEntity and graphPreset survive every transition.

test.describe('pane open/close and tab-switch sequences', () => {

  // ── Multiple consecutive class-drawer switches ────────────────────────────
  // Set start in Person, close, open Project, close, reopen Person — chip intact.

  test('[Person: set Alice] → [close] → [open Project] → [close] → [reopen Person] → chip still Alice', async ({ page }) => {
    const PROJECT_IRI = 'http://test.example.org/Project'
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Close Person drawer
    await page.keyboard.press('Escape')
    await expect(page.locator('.p-drawer')).not.toBeVisible({ timeout: 2_000 })

    // Open Project drawer
    await clickSchemaNode(page, PROJECT_IRI)
    await expect(page.locator('.p-drawer-header')).toContainText('Project', { timeout: 3_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')

    // Close Project drawer
    await page.keyboard.press('Escape')
    await expect(page.locator('.p-drawer')).not.toBeVisible({ timeout: 2_000 })

    // Reopen Person drawer
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
    await expect(
      page.locator('.instance-item').filter({ hasText: 'Bob' }).getByRole('button', { name: /Find path/ }),
    ).toBeVisible()
  })

  // ── Multiple consecutive tab switches ─────────────────────────────────────
  // browse → graph → browse → graph → browse: start chip survives all hops.

  test('[set start] → [browse→graph→browse→graph→browse] → chip still present at end', async ({ page }) => {
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    // Close drawer before switching tabs
    await page.keyboard.press('Escape')

    // hop 1: browse → graph
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    // hop 2: graph → browse
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })
    // hop 3: browse → graph
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    // hop 4: graph → browse
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
  })

  // ── Browser back/forward navigation ───────────────────────────────────────

  test('browser back from /graph to /browse preserves the start chip', async ({ page }) => {
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Navigate to /graph via Paths tab button (pushes a history entry)
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Browser back
    await page.goBack()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
  })

  test('browser back after find-path: start chip is gone (was consumed by find-path)', async ({ page }) => {
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Browser back to browse
    await page.goBack()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    // start was consumed — chip must be absent
    await expect(page.locator('.start-chip')).not.toBeVisible()
  })

  test('browser back → forward → entity slots on /graph are still correct', async ({ page }) => {
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })

    // Back then forward
    await page.goBack()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })
    await page.goForward()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Entity chips must still reflect the last find-path (Alice + Bob)
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
  })

  // ── NodeDetail drawer on /graph while start is pending ────────────────────
  // Opening the NodeDetail pane via the ⓘ button in the palette navigates to
  // /graph and sets palettePreviewEntity. This must not evict pathStartEntity.
  // Then navigating back to browse must still show the start chip.

  test('[set start in palette] → [open NodeDetail via ⓘ] → [browser back] → start chip intact on browse', async ({ page }) => {
    await loadSchemaAndWait(page)

    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    // Set Alice as start
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()

    // Now click ⓘ on Bob — opens NodeDetail in GraphView
    await searchInPalette(page, 'Bob')
    await expect(page.locator('.palette-item').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Bob' }).locator('.palette-inst-info').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    // NodeDetail drawer should be open
    await expect(page.locator('.p-drawer')).toBeVisible({ timeout: 3_000 })

    // Close NodeDetail and go back to browse
    await page.keyboard.press('Escape')
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })

    // Start chip must still reflect Alice
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
    // Bob should offer "Find path →" (Alice is still pending start)
    await expect(
      page.locator('.instance-item').filter({ hasText: 'Bob' }).getByRole('button', { name: /Find path/ }),
    ).toBeVisible()
  })

  // ── Palette open while class drawer is already open ───────────────────────
  // Tests that both overlays coexist cleanly: class drawer open, palette opens
  // on top, start is set in palette, palette closes, class drawer still reactive.

  test('[open class drawer] → [open palette on top] → [set start in palette] → [close palette] → class drawer shows chip', async ({ page }) => {
    await loadSchemaAndWait(page)

    // Open Person class drawer first
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })

    // Open palette on top (class drawer still open behind it)
    await openPalette(page)
    await searchInPalette(page, 'Alice')
    await expect(page.locator('.palette-item').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await page.locator('.palette-item').filter({ hasText: 'Alice' }).locator('.palette-inst-action').click()
    await closePalette(page)

    // Class drawer should still be open and show the start chip
    await expect(page.locator('.p-drawer')).toBeVisible({ timeout: 2_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
    await expect(
      page.locator('.instance-item').filter({ hasText: 'Bob' }).getByRole('button', { name: /Find path/ }),
    ).toBeVisible()
  })

  // ── Tab switch mid-sequence: set start → switch tab → switch back → find path
  // The tab switch must not silently reset entity state or ghost-apply graphPreset.

  test('[set start in class pane] → [switch to Paths tab] → [switch back] → [find path] → correct entities', async ({ page }) => {
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Switch to Paths tab and back
    await page.keyboard.press('Escape')
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })

    // Reopen Person — start chip intact, find path works correctly
    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Bob' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
    await page.locator('.instance-item').filter({ hasText: 'Bob' })
      .getByRole('button', { name: /Find path/ }).click()

    await expect(page).toHaveURL('/graph', { timeout: 5_000 })
    const chips = page.locator('.selected-chip--locked .chip-label')
    await expect(chips.filter({ hasText: 'Alice' })).toBeVisible({ timeout: 5_000 })
    await expect(chips.filter({ hasText: 'Bob' })).toBeVisible({ timeout: 5_000 })
  })

  // ── Class drawer open → tab switch → tab back: drawer state ──────────────
  // Verifies that keep-alive preserves the open drawer state across tab switches.

  test('[open class drawer with start set] → [tab to /graph] → [tab back] → drawer still shows chip', async ({ page }) => {
    await loadSchemaAndWait(page)

    await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await page.locator('.instance-item').filter({ hasText: 'Alice' })
      .getByRole('button', { name: 'Set as start' }).click()

    // Switch to Paths tab (keep-alive deactivates BrowseView but doesn't unmount it)
    await page.getByTestId('nav-paths').click()
    await expect(page).toHaveURL('/graph', { timeout: 5_000 })

    // Switch back — BrowseView reactivates
    await page.getByTestId('nav-schema-graph').click()
    await expect(page).toHaveURL('/browse', { timeout: 5_000 })

    // Drawer may have closed on navigation; reopen and verify chip still present
    const drawerOpen = await page.locator('.p-drawer').isVisible()
    if (!drawerOpen) await clickSchemaNode(page, PERSON_IRI)
    await expect(page.locator('.instance-label').filter({ hasText: 'Alice' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.start-chip-label')).toContainText('Alice')
  })
})

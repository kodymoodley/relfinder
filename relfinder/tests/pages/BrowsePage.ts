import { expect } from '@playwright/test'
import { AppPage } from './AppPage'

/**
 * Page object for the Browse/Schema view (/browse).
 */
export class BrowsePage extends AppPage {
  // ── Locators ───────────────────────────────────────────────────────────────

  readonly extractBtn           = () => this.page.getByTestId('extract-schema-btn')
  readonly stopBtn              = () => this.page.getByTestId('stop-extraction-btn')
  readonly schemaDone           = () => this.page.getByTestId('schema-done-indicator')
  readonly extractionProgress   = () => this.page.getByTestId('extraction-progress')
  readonly schemaStats          = () => this.page.getByTestId('schema-stats')
  readonly nodesCount           = () => this.page.getByTestId('nodes-count')
  readonly edgesCount           = () => this.page.getByTestId('edges-count')
  readonly reextractBtn         = () => this.page.getByTestId('reextract-btn')
  readonly hideOrphansToggle    = () => this.page.getByTestId('hide-orphans-toggle')
  readonly disconnectBtn        = () => this.page.getByTestId('disconnect-btn')
  readonly navSchema            = () => this.page.getByTestId('nav-schema')
  readonly navPaths             = () => this.page.getByTestId('nav-paths')
  readonly schemaCanvas         = () => this.page.getByTestId('schema-canvas')
  readonly schemaCanvasEmpty    = () => this.page.getByTestId('schema-canvas-empty')
  readonly schemaToolbar        = () => this.page.getByTestId('schema-toolbar')
  readonly zoomInBtn            = () => this.page.getByTestId('zoom-in-btn')
  readonly zoomOutBtn           = () => this.page.getByTestId('zoom-out-btn')
  readonly fitBtn               = () => this.page.getByTestId('fit-btn')
  readonly rerunLayoutBtn       = () => this.page.getByTestId('rerun-layout-btn')
  readonly toggleLabelsBtn      = () => this.page.getByTestId('toggle-labels-btn')
  readonly extractionError      = () => this.page.getByTestId('extraction-error-msg')

  // ── Navigation ─────────────────────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto('/browse')
    await expect(this.page).toHaveURL('/browse')
  }

  async goToPaths(): Promise<void> {
    await this.navPaths().click()
    await this.page.waitForURL('/graph')
  }

  // ── Extraction ─────────────────────────────────────────────────────────────

  async clickExtract(): Promise<void> {
    await this.extractBtn().click()
  }

  async clickStop(): Promise<void> {
    await this.stopBtn().click()
  }

  /**
   * Wait until extraction is no longer running (either done or stopped).
   * Polls every 200 ms; times out after `timeoutMs`.
   */
  async waitForExtractionComplete(timeoutMs = 30_000): Promise<void> {
    await expect(this.stopBtn()).not.toBeVisible({ timeout: timeoutMs })
  }

  /**
   * Wait until the schema has at least `minNodes` nodes rendered.
   */
  async waitForSchemaWithNodes(minNodes: number, timeoutMs = 30_000): Promise<void> {
    await expect(async () => {
      const count = await this.getNodeCount()
      expect(count).toBeGreaterThanOrEqual(minNodes)
    }).toPass({ timeout: timeoutMs })
  }

  // ── Cytoscape helpers ──────────────────────────────────────────────────────

  /**
   * Read the node count displayed in the sidebar stats (fast, DOM-based).
   */
  async getNodeCount(): Promise<number> {
    const text = await this.nodesCount().textContent()
    return parseInt(text?.trim() ?? '0', 10)
  }

  async getEdgeCount(): Promise<number> {
    const text = await this.edgesCount().textContent()
    return parseInt(text?.trim() ?? '0', 10)
  }

  // ── Toolbar actions ────────────────────────────────────────────────────────

  async zoomIn(): Promise<void>  { await this.zoomInBtn().click() }
  async zoomOut(): Promise<void> { await this.zoomOutBtn().click() }
  async fitGraph(): Promise<void> { await this.fitBtn().click() }
  async rerunLayout(): Promise<void> { await this.rerunLayoutBtn().click() }
  async toggleLabels(): Promise<void> { await this.toggleLabelsBtn().click() }

  // ── Assertions ──────────────────────────────────────────────────────────────

  async expectEmptyCanvas(): Promise<void> {
    await expect(this.schemaCanvasEmpty()).toBeVisible()
    await expect(this.extractBtn()).toBeVisible()
  }

  async expectExtracting(): Promise<void> {
    await expect(this.stopBtn()).toBeVisible()
    await expect(this.extractionProgress()).toBeVisible()
  }

  async expectSchemaLoaded(): Promise<void> {
    await expect(this.schemaDone()).toBeVisible()
    await expect(this.schemaStats()).toBeVisible()
  }

  async expectNodeCountInRange(min: number, max: number): Promise<void> {
    const count = await this.getNodeCount()
    expect(count).toBeGreaterThanOrEqual(min)
    expect(count).toBeLessThanOrEqual(max)
  }
}

import { expect } from '@playwright/test'
import { AppPage } from './AppPage'

/**
 * Page object for the Graph/Paths view (/graph).
 */
export class GraphPage extends AppPage {
  // ── Locators ───────────────────────────────────────────────────────────────

  readonly entity1Section     = () => this.page.getByTestId('entity1-search')
  readonly entity2Section     = () => this.page.getByTestId('entity2-search')
  readonly entity1Input       = () => this.page.locator('#entity-entity1-input')
  readonly entity2Input       = () => this.page.locator('#entity-entity2-input')
  readonly findBtn            = () => this.page.getByTestId('find-relationships-btn')
  readonly graphCanvas        = () => this.page.getByTestId('graph-canvas')
  readonly navSchema          = () => this.page.getByTestId('nav-schema-graph')
  readonly navPaths           = () => this.page.getByTestId('nav-paths-graph')
  readonly disconnectBtn      = () => this.page.getByTestId('disconnect-btn-graph')

  // ── Navigation ─────────────────────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto('/graph')
    await expect(this.page).toHaveURL('/graph')
  }

  async goToSchema(): Promise<void> {
    await this.navSchema().click()
    await this.page.waitForURL('/browse')
  }

  // ── Entity search ──────────────────────────────────────────────────────────

  async searchEntity1(query: string): Promise<void> {
    await this.entity1Input().fill(query)
    // Wait for autocomplete to populate
    await this.page.waitForTimeout(600)
  }

  async searchEntity2(query: string): Promise<void> {
    await this.entity2Input().fill(query)
    await this.page.waitForTimeout(600)
  }

  async selectFirstSuggestion(): Promise<void> {
    await this.page.locator('.p-autocomplete-option').first().click()
  }

  // ── Path finding ──────────────────────────────────────────────────────────

  async clickFind(): Promise<void> {
    await this.findBtn().click()
  }

  // ── Assertions ──────────────────────────────────────────────────────────────

  async expectGraphCanvasVisible(): Promise<void> {
    await expect(this.graphCanvas()).toBeVisible()
  }

  async expectFindButtonEnabled(): Promise<void> {
    await expect(this.findBtn()).toBeEnabled()
  }

  async expectFindButtonDisabled(): Promise<void> {
    await expect(this.findBtn()).toBeDisabled()
  }
}

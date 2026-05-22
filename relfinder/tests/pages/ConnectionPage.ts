import { expect } from '@playwright/test'
import { AppPage } from './AppPage'

/**
 * Page object for the Connection screen (/).
 */
export class ConnectionPage extends AppPage {
  // ── Locators ───────────────────────────────────────────────────────────────

  readonly sparqlTab      = () => this.page.getByTestId('tab-sparql')
  readonly fileTab        = () => this.page.getByTestId('tab-file')
  readonly endpointInput  = () => this.page.getByTestId('endpoint-url-input')
  readonly connectBtn     = () => this.page.getByTestId('connect-btn')
  readonly connectionError = () => this.page.getByTestId('connection-error-msg')
  readonly dropZone       = () => this.page.getByTestId('rdf-drop-zone')
  readonly fileInput      = () => this.page.getByTestId('rdf-file-input')
  readonly openGraphBtn   = () => this.page.getByTestId('open-graph-btn')
  readonly parseError     = () => this.page.getByTestId('parse-error-msg')

  // ── Navigation ─────────────────────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto('/')
    await this.clearStorage()
    await expect(this.page).toHaveURL('/')
  }

  // ── SPARQL tab actions ──────────────────────────────────────────────────────

  async selectSparqlTab(): Promise<void> {
    await this.sparqlTab().click()
  }

  async fillEndpoint(url: string): Promise<void> {
    await this.endpointInput().fill(url)
  }

  async clickConnect(): Promise<void> {
    await this.connectBtn().click()
  }

  async connectToEndpoint(url: string): Promise<void> {
    await this.fillEndpoint(url)
    await this.clickConnect()
  }

  // ── File tab actions ────────────────────────────────────────────────────────

  async selectFileTab(): Promise<void> {
    await this.fileTab().click()
  }

  async uploadFile(filePath: string): Promise<void> {
    await this.fileInput().setInputFiles(filePath)
  }

  async clickOpenGraph(): Promise<void> {
    await this.openGraphBtn().click()
  }

  // ── Assertions ──────────────────────────────────────────────────────────────

  async expectConnectionError(messageFragment: string): Promise<void> {
    await expect(this.connectionError()).toBeVisible()
    await expect(this.connectionError()).toContainText(messageFragment)
  }

  async expectParseError(): Promise<void> {
    await expect(this.parseError()).toBeVisible()
  }

  async expectFileLoaded(tripleCountMin = 1): Promise<void> {
    // Drop zone shows triple count when file is loaded
    await expect(this.dropZone()).toContainText('triples loaded')
    const text = await this.dropZone().textContent()
    const match = text?.match(/(\d[\d,]*)\s+triples/)
    if (match) {
      const count = parseInt(match[1].replace(/,/g, ''), 10)
      expect(count).toBeGreaterThanOrEqual(tripleCountMin)
    }
  }
}

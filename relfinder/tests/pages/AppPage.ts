import type { Page } from '@playwright/test'

/**
 * Base page object — shared utilities used by all page-specific POMs.
 */
export class AppPage {
  constructor(protected readonly page: Page) {}

  /** Clear all browser storage so each test starts clean. */
  async clearStorage(): Promise<void> {
    await this.page.evaluate(() => {
      sessionStorage.clear()
      localStorage.clear()
    })
  }

  /** Navigate to the app root and clear storage. */
  async goto(): Promise<void> {
    await this.page.goto('/')
    await this.clearStorage()
  }

  /** Wait until no network requests are in-flight for 500 ms. */
  async waitForNetworkIdle(): Promise<void> {
    await this.page.waitForLoadState('networkidle')
  }

  /** Wait for a specific URL pattern. */
  async waitForRoute(urlPattern: string | RegExp): Promise<void> {
    await this.page.waitForURL(urlPattern)
  }
}

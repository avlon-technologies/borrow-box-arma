import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;
// Uses Microsoft Edge if installed (always on Windows); set PW_CHANNEL=chromium
// after `npx playwright install chromium` to use Playwright's own browser.
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: channel === 'chromium' ? undefined : channel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], channel: channel === 'chromium' ? undefined : channel } }],
  webServer: {
    // A throwaway database, freshly seeded, so the suite never touches your data.
    command: 'node server/seed.ts --reset && node server/index.ts',
    env: { BORROWBOX_DATA_DIR: '.tmp/e2e-data', PORT: String(PORT) },
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

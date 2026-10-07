import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "gate1.spec.js",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  retries: 0,
  outputDir: "../../../test-results/gate1",
  reporter: [["list"], ["json", { outputFile: "test-results/gate1-results.json" }]],
  use: { browserName: "chromium", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});

import { spawnSync } from "node:child_process";
import { gateEnvironment } from "./environment.js";

try {
  gateEnvironment();
  const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config=dist-test/tests/e2e/playwright.config.js"], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Gate 1 startup failed");
  process.exitCode = 1;
}

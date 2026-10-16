import { formatSandboxSmokeReport, redactSandboxError, runMercadoPagoSandboxSmoke } from "./mercado-pago-sandbox-runner.js";

async function main(): Promise<void> {
  const report = await runMercadoPagoSandboxSmoke(process.env);
  console.log(formatSandboxSmokeReport(report));
}

void main().catch((error: unknown) => {
  console.error(redactSandboxError(error, process.env));
  process.exitCode = 1;
});

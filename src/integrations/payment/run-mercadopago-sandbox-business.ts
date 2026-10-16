import { prepareMercadoPagoSandboxBusiness, redactSandboxError } from "./mercado-pago-sandbox-runner.js";

async function main(): Promise<void> {
  const result = await prepareMercadoPagoSandboxBusiness(process.env);
  console.log(`sandbox business ready: sandbox-mp-business (${result.created ? "created" : "already existed"})`);
  console.log("sandbox billing profile persisted");
}

void main().catch((error: unknown) => {
  console.error(redactSandboxError(error, process.env));
  process.exitCode = 1;
});

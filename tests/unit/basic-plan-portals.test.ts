import assert from "node:assert/strict";
import { test } from "node:test";
import { server } from "../../src/app/run-operator-preview.js";
import { renderAmpliviewAdminUi, type AmpliviewAdminDemoData } from "../../src/infrastructure/http/ampliview-admin-ui.js";

test("preview serves the workshop portals and internal Ampliview portal", async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const root = await fetch(base, { redirect: "manual" });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get("location"), "/login");

    const login = await fetch(`${base}/login`);
    const loginHtml = await login.text();
    assert.equal(login.status, 200);
    assert.match(login.headers.get("content-type") ?? "", /text\/html/);
    assert.match(loginHtml, /E-mail/);
    assert.match(loginHtml, /Senha/);
    assert.match(loginHtml, /type="password"/);
    assert.match(loginHtml, /Criar minha conta/);
    assert.doesNotMatch(loginHtml, /localStorage|sessionStorage/);

    const registration = await fetch(`${base}/cadastro`);
    const registrationHtml = await registration.text();
    assert.equal(registration.status, 200);
    assert.match(registrationHtml, /Sua conta/);
    assert.match(registrationHtml, /Dados da sua empresa/);
    assert.match(registrationHtml, /WORKSHOP/);
    assert.match(registrationHtml, /AUTO_CENTER/);
    assert.match(registrationHtml, /type="password"/);
    assert.doesNotMatch(registrationHtml, /localStorage|sessionStorage/);

    const adminLogin = await fetch(`${base}/admin/login`);
    const adminLoginHtml = await adminLogin.text();
    assert.equal(adminLogin.status, 200);
    assert.match(adminLoginHtml, /Portal Ampliview/);
    assert.match(adminLoginHtml, /E-mail/);
    assert.match(adminLoginHtml, /Senha/);
    assert.match(adminLoginHtml, /type="password"/);

    const admin = await fetch(`${base}/admin`);
    const adminHtml = await admin.text();
    assert.equal(admin.status, 200);
    assert.match(admin.headers.get("content-type") ?? "", /text\/html/);
    for (const section of ["Visão Geral", "Atendimentos", "Problemas Recorrentes", "Demanda", "Merchandising", "Empresas"]) {
      assert.ok(adminHtml.includes(section), `missing ${section}`);
    }
    assert.match(adminHtml, /Dados de demonstração/);
    assert.match(adminHtml, /ainda não representam dados reais da operação/);
    assert.doesNotMatch(adminHtml, /GROQ_API_KEY|dummy-secret|stack trace|localStorage|sessionStorage/);

    const operator = await fetch(`${base}/operator`);
    const operatorHtml = await operator.text();
    assert.equal(operator.status, 200);
    assert.match(operatorHtml, /Ampliview/);
    assert.match(operatorHtml, /Oficina de Demonstração/);
    assert.doesNotMatch(operatorHtml, /GROQ_API_KEY/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("admin renderer safely serializes untrusted demo values", () => {
  const maliciousName = "</script><script>alert(1)</script>";
  const demo: AmpliviewAdminDemoData = {
    overview: { attendances: 1, requestedQuotes: 1, respondedQuotes: 1, authorizedAmountCents: 0, activeBusinesses: 1 },
    conversations: [],
    recurringProblems: [],
    demand: [],
    merchandising: [],
    insights: [],
    businesses: [{ name: maliciousName, type: "OTHER", attendances: 0, quotes: 0, lastActivity: "—" }],
  };
  const html = renderAmpliviewAdminUi(demo);
  assert.ok(html.includes("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"));
  assert.ok(!html.includes(maliciousName));
  assert.doesNotMatch(html, /innerHTML/);
});

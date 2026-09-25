import assert from "node:assert/strict";
import { test } from "node:test";
import { server } from "../../src/app/run-operator-preview.js";
import { MANAUS_COMMERCIAL_CLUSTERS, MANAUS_COMMERCIAL_REGIONS, MANAUS_MAPPED_BUSINESSES } from "../../src/app/manaus-market-mapping.js";
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
    assert.match(loginHtml, /Ambiente de demonstração: este acesso não valida credenciais reais\./);
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
    assert.ok(adminHtml.includes("Mercado Mapeado"));
    for (const section of ["Visão Geral", "Atendimentos", "Saúde do Atendente", "Adesão e Cobertura", "Demanda", "Merchandising", "Empresas"]) {
      assert.ok(adminHtml.includes(section), `missing ${section}`);
    }
    assert.match(adminHtml, /Dados de demonstração/);
    assert.match(adminHtml, /não representam clientes Ampliview/);
    assert.match(adminHtml, /Baixa confiança/);
    assert.match(adminHtml, /Falha de integração/);
    assert.match(adminHtml, /Simulação de cobertura Ampliview/);
    assert.match(adminHtml, /Demandas em crescimento/);
    assert.match(adminHtml, /Gap comercial/);
    assert.ok(adminHtml.includes("Ponta Negra / Tarumã") && adminHtml.includes("Colônia Antônio Aleixo / Puraquequara"));
    assert.ok(adminHtml.includes("Empresas encontradas neste levantamento são estabelecimentos do mercado e não representam clientes Ampliview"));
    assert.ok(adminHtml.includes("Empresas mapeadas") && adminHtml.includes('"mappedBusinessCount":0'));
    assert.ok(adminHtml.includes("Carga de estabelecimentos validada ainda não integrada."));
    assert.ok(adminHtml.includes("Alvorada / Dom Pedro / Redenção / Planalto"));
    assert.deepEqual(MANAUS_COMMERCIAL_REGIONS, ["Norte", "Sul", "Leste", "Oeste"]);
    assert.equal(MANAUS_COMMERCIAL_CLUSTERS.length, 16);
    assert.deepEqual(new Set(MANAUS_COMMERCIAL_CLUSTERS.map(({ region }) => region)), new Set(["Norte", "Sul", "Leste", "Oeste"]));
    assert.ok(MANAUS_COMMERCIAL_CLUSTERS.every((cluster) => !("demoSignal" in cluster)));
    assert.deepEqual(MANAUS_MAPPED_BUSINESSES, []);
    assert.ok(adminHtml.includes('"city":"Manaus"') && adminHtml.includes('"state":"AM"'));
    assert.doesNotMatch(adminHtml, /Barulho ao frear|Não gela|Pedal baixo/);
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
    overview: {
      activeBusinesses: 1,
      attendances: 1,
      commercialRequests: 1,
      respondedQuotes: 1,
      authorizedAmountCents: 0,
      aiResolutionPercent: 0,
      attendancePeriods: [],
      businessesByRegion: [],
      channels: [],
      commercialResults: [],
      operationalAlerts: [],
    },
    attendances: [],
    assistantHealth: { issues: [], causes: [] },
    regionalAdoption: [],
    coverageDeficits: [],
    demand: [],
    merchandising: { unexploredDemand: [], opportunitiesByRegion: [], opportunitiesBySegment: [], productTrends: [] },
    businesses: [{ name: maliciousName, type: "OTHER", city: "", state: "", region: "", attendances: 0, requests: 0, conversion: "—", lastActivity: "—" }],
  };
  const html = renderAmpliviewAdminUi(demo, {
    regions: MANAUS_COMMERCIAL_REGIONS,
    clusters: MANAUS_COMMERCIAL_CLUSTERS,
    mappedBusinessCount: MANAUS_MAPPED_BUSINESSES.length,
  });
  assert.ok(html.includes("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"));
  assert.ok(!html.includes(maliciousName));
  assert.doesNotMatch(html, /innerHTML/);
});

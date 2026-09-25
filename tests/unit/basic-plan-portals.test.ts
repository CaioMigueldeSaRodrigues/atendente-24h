import assert from "node:assert/strict";
import { test } from "node:test";
import { server } from "../../src/app/run-operator-preview.js";
import { MANAUS_COMMERCIAL_CLUSTERS, MANAUS_COMMERCIAL_REGIONS, MANAUS_MAPPED_BUSINESSES, type ManausMarketVerificationStatus } from "../../src/app/manaus-market-mapping.js";
import { renderAmpliviewAdminUi, type AmpliviewAdminData } from "../../src/infrastructure/http/ampliview-admin-ui.js";

type Assert<T extends true> = T;
type IsEqual<Actual, Expected> = (<T>() => T extends Actual ? 1 : 2) extends (<T>() => T extends Expected ? 1 : 2) ? true : false;
type VerificationStatusesAreExact = Assert<IsEqual<ManausMarketVerificationStatus,
  "PUBLIC_LISTING_ONLY" | "CNPJ_VALIDATED" | "CNPJ_NOT_FOUND" | "CNPJ_AMBIGUOUS"
>>;

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
    const adminScript = adminHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(adminScript);
    assert.doesNotThrow(() => new Function(adminScript));
    assert.equal(admin.status, 200);
    assert.match(admin.headers.get("content-type") ?? "", /text\/html/);
    assert.ok(adminHtml.includes("Mercado Mapeado"));
    for (const section of ["Visão Geral", "Atendimentos", "Saúde do Atendente", "Adesão e Cobertura", "Demanda", "Merchandising", "Empresas"]) {
      assert.ok(adminHtml.includes(section), `missing ${section}`);
    }
    assert.match(adminHtml, /não representam clientes Ampliview/);
    assert.match(adminHtml, /Dados operacionais/);
    assert.match(adminHtml, /Este painel exibe somente dados reais disponíveis\. Onde ainda não houver operação registrada, as áreas permanecem vazias\. Dados de Mercado Mapeado pertencem a levantamento público externo e não representam clientes Ampliview\./);
    for (const emptyState of [
      "Ainda não há atendimentos reais registrados.",
      "Ainda não há clientes Ampliview ativos por região.",
      "Ainda não há utilização real de canais registrada.",
      "Ainda não há resultados comerciais reais registrados.",
      "Nenhum evento operacional real registrado até o momento.",
      "Nenhum atendimento real registrado até o momento.",
      "Nenhum evento técnico real registrado até o momento.",
      "Ainda não há causas técnicas reais consolidadas.",
      "Nenhum cliente Ampliview ativo ainda.",
      "A cobertura comercial será calculada quando houver clientes reais suficientes.",
      "Ainda não há dados operacionais suficientes para consolidar demanda real.",
      "Ainda não há dados comerciais suficientes para identificar oportunidades de merchandising.",
      "Nenhuma empresa cliente Ampliview ativa ainda.",
    ]) assert.ok(adminHtml.includes(emptyState), `missing empty state: ${emptyState}`);
    assert.doesNotMatch(adminHtml, /Dados de demonstração|indicadores demonstrativos|exemplos demonstrativos|simulação/i);
    for (const fakeValue of ["Oficina Prime", "Auto Glass Manaus", "ClimaCar", "Carlos Almeida", "Mariana Souza", "Roberto Lima", "1284", "382", "291", "18475000"]) {
      assert.ok(!adminHtml.includes(fakeValue), `fictitious operational value leaked into admin: ${fakeValue}`);
    }
    const serializedOperational = adminHtml.match(/const operational=(\{[^;]+\});/);
    assert.ok(serializedOperational?.[1]);
    const operationalData = JSON.parse(serializedOperational[1]) as AmpliviewAdminData;
    assert.deepEqual(operationalData, {
      overview: {
        activeBusinesses: 0,
        attendances: 0,
        commercialRequests: 0,
        respondedQuotes: 0,
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
      businesses: [],
    });
    assert.match((0 / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), /^R\$\s0,00$/);
    assert.ok(adminHtml.includes("Ponta Negra / Tarumã") && adminHtml.includes("Colônia Antônio Aleixo / Puraquequara"));
    assert.ok(adminHtml.includes("Empresas encontradas neste levantamento são estabelecimentos do mercado e não representam clientes Ampliview"));
    assert.ok(adminHtml.includes("Empresas mapeadas") && adminHtml.includes("market.mappedBusinesses.length"));
    assert.ok(adminHtml.includes("Conglomerados com registros") && adminHtml.includes("mappedClusters.length"));
    assert.ok(adminHtml.includes("Estabelecimentos encontrados"));
    assert.ok(adminHtml.includes("Listagem pública — CNPJ ainda não validado"));
    for (const filterLabel of ["Buscar estabelecimento", "Macrorregião", "Conglomerado", "Segmento", "Limpar filtros", "Exibindo", "Endereço", "Nenhum estabelecimento encontrado com os filtros selecionados."]) {
      assert.ok(adminHtml.includes(filterLabel), `missing market filter/table label: ${filterLabel}`);
    }
    assert.ok(adminHtml.includes("market-search") && adminHtml.includes("market-region") && adminHtml.includes("market-cluster") && adminHtml.includes("market-segment"));
    for (const label of ["Qualidade do levantamento", "Registros públicos", "Com fonte rastreável", "CNPJ validado", "Aguardando validação cadastral", "Validação inconclusiva", "Mapeado em"]) {
      assert.ok(adminHtml.includes(label), `missing market quality/date label: ${label}`);
    }
    assert.ok(adminScript.includes("business.verificationStatus"));
    assert.ok(adminScript.includes("statusLabel(business.verificationStatus)"));
    assert.ok(adminScript.includes("Status de validação não reconhecido"));
    assert.ok(adminScript.includes("business.sourceUrl"));
    assert.ok(adminScript.includes('new URL(value).protocol==="https:"'));
    assert.ok(adminScript.includes('if(isValidHttpsUrl(business.sourceUrl)){const link=document.createElement("a")'));
    assert.ok(adminScript.includes('}else{sourceCell.textContent=business.sourceName;}'));
    assert.ok(adminScript.includes('link.setAttribute("href",business.sourceUrl)'));
    assert.ok(adminScript.includes('link.setAttribute("target","_blank")'));
    assert.ok(adminScript.includes('link.setAttribute("rel","noopener noreferrer")'));
    assert.ok(adminScript.includes("function formatMappedDate(value)"));
    assert.ok(adminScript.includes('match[3]+"/"+match[2]+"/"+match[1]'));
    const cnpjFormatterSource = adminScript.match(/function formatCnpj\(value\)\{[\s\S]*?(?=function formatMappedDate)/)?.[0];
    assert.ok(cnpjFormatterSource);
    const formatCnpj = new Function(`${cnpjFormatterSource}; return formatCnpj;`)() as (value: string) => string;
    assert.equal(formatCnpj("12345678000190"), "12.345.678/0001-90");
    assert.equal(formatCnpj("1234567800019"), "1234567800019");
    assert.ok(adminScript.includes('business.verificationStatus==="CNPJ_VALIDATED"'));
    assert.ok(adminScript.includes('business.verificationStatus==="PUBLIC_LISTING_ONLY"'));
    assert.ok(adminScript.includes('business.verificationStatus==="CNPJ_NOT_FOUND"||business.verificationStatus==="CNPJ_AMBIGUOUS"'));
    for (const statusLabel of ["CNPJ validado", "CNPJ não localizado", "Validação cadastral inconclusiva", "Status de validação não reconhecido"]) {
      assert.ok(adminScript.includes(statusLabel), `missing validation status label: ${statusLabel}`);
    }
    assert.ok(adminScript.includes("cell.colSpan=9"));
    assert.doesNotMatch(adminHtml, /innerHTML/);
    assert.doesNotMatch(adminHtml, /Carga de estabelecimentos validada ainda não integrada/);
    assert.ok(adminHtml.includes("Alvorada / Dom Pedro / Redenção / Planalto"));
    assert.deepEqual(MANAUS_COMMERCIAL_REGIONS, ["Norte", "Sul", "Leste", "Oeste"]);
    assert.equal(MANAUS_COMMERCIAL_CLUSTERS.length, 16);
    assert.deepEqual(new Set(MANAUS_COMMERCIAL_CLUSTERS.map(({ region }) => region)), new Set(["Norte", "Sul", "Leste", "Oeste"]));
    assert.ok(MANAUS_COMMERCIAL_CLUSTERS.every((cluster) => !("demoSignal" in cluster)));
    assert.equal(MANAUS_MAPPED_BUSINESSES.length, 31);
    assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ verificationStatus }) => verificationStatus === "CNPJ_VALIDATED").length, 0);
    assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ verificationStatus }) => verificationStatus === "PUBLIC_LISTING_ONLY").length, 31);
    assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ verificationStatus }) => verificationStatus === "CNPJ_NOT_FOUND" || verificationStatus === "CNPJ_AMBIGUOUS").length, 0);
    const serializedMarket = adminHtml.match(/const market=(\{[^;]+\});/);
    const serializedMarketJson = serializedMarket?.[1];
    assert.ok(serializedMarketJson);
    const htmlMarketData = JSON.parse(serializedMarketJson) as { mappedBusinesses: Array<Record<string, unknown>> };
    assert.equal(htmlMarketData.mappedBusinesses.length, MANAUS_MAPPED_BUSINESSES.length);
    assert.equal(htmlMarketData.mappedBusinesses.filter((business) => typeof business.sourceUrl === "string").length, 2);
    assert.equal((adminHtml.match(/https:\/\/www\.solutudo\.com\.br/g) ?? []).length, 2);
    for (const business of htmlMarketData.mappedBusinesses) {
      assert.ok("verificationStatus" in business);
      assert.ok("mappedAt" in business);
      assert.ok("sourceKind" in business);
    }
    const mappedClusterKeys = new Set<string>();
    for (const business of MANAUS_MAPPED_BUSINESSES) {
      const cluster = MANAUS_COMMERCIAL_CLUSTERS.find((candidate) => candidate.name === business.cluster);
      assert.ok(cluster, "unknown cluster: " + business.cluster);
      assert.equal(cluster.region, business.region);
      assert.ok(business.name.trim());
      assert.ok(business.address.trim());
      assert.ok(business.neighborhood.trim());
      assert.ok(business.segments.length > 0);
      assert.equal(business.mappedAt, "2026-09-25");
      assert.equal(business.verificationStatus, "PUBLIC_LISTING_ONLY");
      assert.ok(!("cnpj" in business));
      assert.ok(!("legalName" in business));
      assert.ok(!("validatedAt" in business));
      assert.ok(["PUBLIC_MAP_LISTING", "PUBLIC_DIRECTORY"].includes(business.sourceKind));
      assert.ok(!business.name.includes("Ampliview"));
      assert.ok(!("businessId" in business) && !("customerId" in business));
      if (business.sourceKind === "PUBLIC_DIRECTORY") assert.ok(business.sourceUrl);
      if (business.sourceKind === "PUBLIC_MAP_LISTING") {
        assert.equal(business.sourceName, "Listagem pública de mapa");
        assert.equal(business.sourceUrl, undefined);
      }
      mappedClusterKeys.add(business.region + "|" + business.cluster);
    }
    assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ sourceKind }) => sourceKind === "PUBLIC_DIRECTORY").length, 2);
    assert.ok(MANAUS_MAPPED_BUSINESSES.filter(({ sourceKind }) => sourceKind === "PUBLIC_DIRECTORY").every((business) => business.sourceName === "Solutudo" && business.sourceUrl));
    assert.equal(mappedClusterKeys.size, 16);
    assert.equal(MANAUS_COMMERCIAL_CLUSTERS.filter((cluster) => mappedClusterKeys.has(cluster.region + "|" + cluster.name)).length, 16);
    assert.deepEqual(
      Object.fromEntries(MANAUS_COMMERCIAL_REGIONS.map((region) => [
        region,
        MANAUS_MAPPED_BUSINESSES.filter((business) => business.region === region).length,
      ])),
      { Norte: 6, Sul: 10, Leste: 8, Oeste: 7 },
    );
    assert.equal(MANAUS_MAPPED_BUSINESSES.filter((business) => business.sourceUrl && /^https:\/\//i.test(business.sourceUrl)).length, 2);
    assert.ok(adminHtml.includes("Ambiente de validação"));
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
  const demo: AmpliviewAdminData = {
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
    mappedBusinesses: [],
  });
  assert.ok(html.includes("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"));
  assert.ok(!html.includes(maliciousName));
  assert.doesNotMatch(html, /innerHTML/);
});

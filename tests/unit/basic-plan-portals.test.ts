import assert from "node:assert/strict";
import { test } from "node:test";
import { server } from "../../src/app/run-operator-preview.js";
import { MANAUS_COMMERCIAL_CLUSTERS, MANAUS_COMMERCIAL_REGIONS, MANAUS_MAPPED_BUSINESSES, type ManausMarketVerificationStatus } from "../../src/app/manaus-market-mapping.js";
import { renderAmpliviewAdminUi } from "../../src/infrastructure/http/ampliview-admin-ui.js";

type Assert<T extends true> = T;
type IsEqual<Actual, Expected> = (<T>() => T extends Actual ? 1 : 2) extends (<T>() => T extends Expected ? 1 : 2) ? true : false;
type VerificationStatusesAreExact = Assert<IsEqual<ManausMarketVerificationStatus, "PUBLIC_LISTING_ONLY" | "CNPJ_VALIDATED" | "CNPJ_NOT_FOUND" | "CNPJ_AMBIGUOUS">>;

test("preview keeps the existing portals and serves admin data through the real API", async () => {
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
    for (const section of ["Visão Geral", "Atendimentos", "Saúde da Plataforma", "Adesão e Planos", "Demanda", "Merchandising", "Empresas", "Mercado Mapeado"]) {
      assert.ok(adminHtml.includes(section), `missing ${section}`);
    }
    assert.match(adminHtml, /não representam clientes Ampliview/);
    assert.match(adminHtml, /Dados operacionais/);
    assert.match(adminHtml, /Dados ainda não conectados/);
    for (const emptyState of [
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
    assert.doesNotMatch(adminHtml, /Resolução pela IA|Conversão de vendas|Perda/);
    assert.doesNotMatch(adminHtml, /innerHTML/);
    assert.doesNotMatch(adminHtml, /OPENAI_API_KEY|dummy-secret|stack trace|localStorage|sessionStorage/);
    assert.ok(adminHtml.includes("/v1/admin/overview") && adminHtml.includes("/v1/admin/conversations"));
    assert.ok(adminHtml.includes("Intl.NumberFormat"));
    assert.ok(adminHtml.includes("Carregando dados administrativos"));
    assert.ok(adminHtml.includes("Nenhum atendimento encontrado neste período."));
    assert.ok(adminHtml.includes("Não foi possível carregar os dados administrativos."));
    assert.ok(adminHtml.includes("/v1/admin/demand"));
    assert.ok(adminHtml.includes("/v1/admin/inventory"));
    for (const inventoryLabel of ["Estoque e disponibilidade", "Consultas de estoque", "Disponível", "Baixo estoque", "Sem estoque", "Desconhecido", "Demanda × disponibilidade"]) {
      assert.ok(adminHtml.includes(inventoryLabel), `missing inventory visual label: ${inventoryLabel}`);
    }
    for (const demandLabel of ["Demanda", "Participação da demanda por serviço", "Solicitados:", "Respondidos:", "Publicados:", "Entregues:", "Perfil dos veículos atendidos", "Demanda ao longo do tempo", "Progressão dos orçamentos"]) {
      assert.ok(adminHtml.includes(demandLabel), `missing demand visual label: ${demandLabel}`);
    }
    assert.match(adminHtml, /Math\.min\(100,Number\(item\.quantity\)\/total\*100\)/);
    for (const segmentLabel of ["Oficina", "Auto Center", "Elétrica automotiva", "Acessórios", "Ar-condicionado", "Pneus e rodas", "Baterias"]) assert.ok(adminHtml.includes(segmentLabel), `missing market segment label: ${segmentLabel}`);
    assert.doesNotMatch(adminHtml, /Percentual contratado|Contratado|Conversão de vendas/i);
    assert.match(adminHtml, /options\[0\]\.value=\"\"/);
    assert.match(adminHtml, /Concentração de oficinas|Concentração por cluster/);
    assert.match(adminHtml, /Oficinas por segmento/);
    assert.match(adminHtml, /Auditoria geográfica/);
    assert.match(adminHtml, /Latitude/);
    assert.match(adminHtml, /Longitude/);
    assert.match(adminHtml, /não representa coordenadas geográficas/);
    for (const visualLabel of ["Conversas", "Orçamentos solicitados", "Orçamentos respondidos", "Entregas concluídas", "Ticket médio autorizado", "Clientes", "Veículos", "Orçamentos publicados", "Falhas de entrega", "Valor autorizado", "Tempo médio do fluxo"]) {
      assert.ok(adminHtml.includes(visualLabel), `missing visual label: ${visualLabel}`);
    }
    assert.match(adminHtml, /Fluxo de orçamento/);
    assert.match(adminHtml, /Situação das entregas/);
    assert.match(adminHtml, /Ver atendimento/);
    assert.match(adminHtml, /formatUpdatedAt/);
    assert.match(adminHtml, /aria-label.*Fluxo de orçamento/);
    assert.match(adminHtml, /statusClass/);
    assert.match(adminHtml, /R\$|Intl\.NumberFormat/);
    assert.match(adminHtml, /—/);
    assert.doesNotMatch(adminHtml, /<th[^>]*>Canal<\/th>|<th[^>]*>Intenção<\/th>/);
    assert.match(adminHtml, /QUOTE_REQUEST.*Orçamento/);
    assert.doesNotMatch(adminHtml, />\s*(QUOTE_REQUEST|Brand|Model|Year)\s*</);

    const overviewResponse = await fetch(`${base}/v1/admin/overview?businessId=preview-business`);
    const overview = await overviewResponse.json() as Record<string, unknown>;
    assert.equal(overviewResponse.status, 200);
    assert.equal(overview.conversations, 4);
    assert.equal(overview.customers, 4);
    assert.equal(overview.vehicles, 4);
    assert.equal(overview.quoteRequests, 4);
    assert.equal(overview.quoteResponded, 3);
    assert.equal(overview.quotePublished, 2);
    assert.equal(overview.deliveriesDelivered, 1);
    assert.equal(overview.deliveriesPending, 0);
    assert.equal(overview.deliveriesFailed, 1);
    assert.deepEqual(overview.authorizedValueTotal, { amountCents: 279000, currency: "BRL" });
    assert.notEqual(overview.authorizedTicketAverage, null);
    assert.notEqual(overview.averageRequestToResponseMs, null);
    assert.notEqual(overview.averageResponseToPublishMs, null);
    assert.notEqual(overview.averagePublishToDeliveryMs, null);

    const demandResponse = await fetch(`${base}/v1/admin/demand?businessId=preview-business&channel=WHATSAPP`);
    const demand = await demandResponse.json() as { services: Array<{ name: string; quantity: number; requested: number; responded: number; published: number; delivered: number }>; brands: Array<{ name: string; quantity: number }>; models: Array<{ brand: string; model: string; quantity: number }>; years: Array<{ year: number; quantity: number }>; timeline: Array<{ period: string; quantity: number }>; quotes: { requested: number; responded: number; published: number } };
    assert.equal(demandResponse.status, 200);
    assert.deepEqual(demand.quotes, { requested: 4, responded: 3, published: 2 });
    assert.equal(demand.services.reduce((total, item) => total + item.quantity, 0), 4);
    assert.equal(demand.services.reduce((total, item) => total + item.requested, 0), demand.quotes.requested);
    assert.equal(demand.services.reduce((total, item) => total + Math.round(item.quantity / demand.quotes.requested * 100), 0), 100);
    assert.equal(demand.services.find((item) => item.name === "troca de pastilhas")?.delivered, 1);
    assert.equal(demand.brands.reduce((total, item) => total + item.quantity, 0), 4);
    assert.ok(demand.models.some((item) => item.brand === "Honda" && item.model === "Civic" && item.quantity === 1));
    assert.ok(demand.years.some((item) => item.year === 2019 && item.quantity === 1));
    assert.ok(demand.timeline.length >= 1);
    assert.equal((await fetch(`${base}/v1/admin/demand?businessId=other-business`)).status, 403);

    const inventoryResponse = await fetch(`${base}/v1/admin/inventory?businessId=preview-business`);
    const inventory = await inventoryResponse.json() as { summary: { total: number; available: number; lowStock: number; outOfStock: number; unknown: number; withoutAvailability: number }; items: Array<{ requestedItem: string; queries: number }> };
    assert.equal(inventoryResponse.status, 200);
    assert.deepEqual(inventory.summary, { total: 4, available: 1, lowStock: 1, outOfStock: 1, unknown: 1, withoutAvailability: 2 });
    assert.equal(inventory.items.reduce((total, item) => total + item.queries, 0), 4);
    assert.equal((await fetch(`${base}/v1/admin/inventory?businessId=other-business`)).status, 403);

    const listResponse = await fetch(`${base}/v1/admin/conversations?businessId=preview-business&page=1&pageSize=25`);
    const list = await listResponse.json() as { page: number; pageSize: number; total: number; items: Array<{ conversationId: string; customer?: { email?: string; primaryPhone?: string }; vehicle?: { version?: string; year?: number }; quoteRequest?: { status: string; authorizedPrice?: { amountCents: number } }; delivery?: { status: string }; lastMessage?: { content: string } }> };
    assert.equal(listResponse.status, 200);
    assert.equal(list.page, 1);
    assert.equal(list.pageSize, 25);
    assert.equal(list.total, 4);
    assert.equal(list.items.length, 4);
    assert.ok(list.items.some((item) => item.customer?.primaryPhone));
    assert.ok(list.items.some((item) => item.customer?.email === undefined));
    assert.ok(list.items.some((item) => item.vehicle?.version === undefined && item.vehicle?.year === undefined));
    assert.ok(list.items.some((item) => item.quoteRequest?.status === "WAITING_BUSINESS"));
    assert.ok(list.items.some((item) => item.quoteRequest?.status === "RESPONDED" && item.quoteRequest.authorizedPrice?.amountCents === 65000));
    assert.ok(list.items.some((item) => item.delivery?.status === "DELIVERED"));
    assert.ok(list.items.some((item) => item.delivery?.status === "FAILED_RETRYABLE"));
    assert.ok(list.items.every((item) => item.lastMessage?.content));
    const pageTwo = await fetch(`${base}/v1/admin/conversations?businessId=preview-business&page=2&pageSize=3`);
    assert.equal((await pageTwo.json() as { items: unknown[] }).items.length, 1);

    const detailResponse = await fetch(`${base}/v1/admin/conversations/preview-business-conversation-delivered?businessId=preview-business`);
    const detail = await detailResponse.json() as { customer?: { name?: string; primaryPhone?: string; email?: string }; vehicle?: { brand?: string; model?: string; year?: number; version?: string; licensePlate?: string; mileage?: number }; quoteRequests: Array<{ requestDescription: string; status: string; authorizedPrice?: { amountCents: number }; requestedAt: string; respondedAt?: string }>; outboundDeliveries: Array<{ status: string; attempts: number; deliveredAt?: string }>; messages: Array<{ senderType: string; createdAt: string }>; commercialEvents: unknown[] };
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.customer?.name, "Carla Mendes");
    assert.equal(detail.customer?.primaryPhone, "5511999990003");
    assert.equal(detail.vehicle?.brand, "Honda");
    assert.equal(detail.vehicle?.model, "Civic");
    assert.equal(detail.vehicle?.year, 2019);
    assert.equal(detail.vehicle?.version, "Touring");
    assert.equal(detail.vehicle?.licensePlate, "GHI7F89");
    assert.equal(detail.quoteRequests[0]?.status, "RESPONDED");
    assert.equal(detail.quoteRequests[0]?.authorizedPrice?.amountCents, 125000);
    assert.equal(detail.outboundDeliveries[0]?.status, "DELIVERED");
    assert.equal(detail.outboundDeliveries[0]?.attempts, 1);
    assert.ok(detail.outboundDeliveries[0]?.deliveredAt);
    assert.deepEqual(detail.messages.map((message) => message.senderType), ["CUSTOMER", "ASSISTANT"]);
    assert.equal(detail.messages.length, 2);
    assert.ok(detail.messages[0] && detail.messages[1] && detail.messages[0].createdAt <= detail.messages[1].createdAt);
    assert.ok(detail.commercialEvents.length > 0);

    assert.equal((await fetch(`${base}/v1/admin/overview?businessId=other-business`)).status, 403);
    assert.equal((await fetch(`${base}/v1/admin/overview`)).status, 400);

    /* Old Fase 5 assertions treated workshop plans as Admin UI versions. The platform API below replaces them.
    const basicAnalytics = await fetch(`${base}/v1/admin/analytics/intermediate?businessId=preview-business`);
    assert.equal(basicAnalytics.status, 403);
    const intermediateAnalytics = await fetch(`${base}/v1/admin/analytics/intermediate?businessId=preview-business&plan=INTERMEDIATE`);
    const intermediateBody = await intermediateAnalytics.json() as { plan: string; demand: { totalRequests: number; services: Array<{ sharePercent: number; requested: number; responded: number; published: number; delivered: number }> }; market: { status: string; regions: Array<{ quantity: number }>; segments: Array<{ name: string; quantity: number }> }; operation: { retries: number } };
    assert.equal(intermediateAnalytics.status, 200);
    assert.equal(intermediateBody.plan, "INTERMEDIATE");
    assert.equal(intermediateBody.demand.totalRequests, 4);
    assert.equal(intermediateBody.demand.services.reduce((total, item) => total + item.requested, 0), 4);
    assert.equal(intermediateBody.demand.services.reduce((total, item) => total + item.sharePercent, 0), 100);
    assert.equal(intermediateBody.market.status, "AVAILABLE");
    assert.equal(intermediateBody.market.regions.reduce((total, item) => total + item.quantity, 0), 31);
    assert.equal(intermediateBody.market.segments.reduce((total, item) => total + item.quantity, 0), 45);
    assert.equal(intermediateBody.operation.retries, 1);
    assert.equal((await fetch(`${base}/v1/admin/analytics/advanced?businessId=preview-business&plan=INTERMEDIATE`)).status, 403);
    const advancedAnalytics = await fetch(`${base}/v1/admin/analytics/advanced?businessId=preview-business&plan=ADVANCED`);
    const advancedBody = await advancedAnalytics.json() as { plan: string; forecast: { status: string; availableObservations: number; minimumRequired: number }; opportunities: Array<{ description: string; evidence: unknown[] }>; comparison: { status: string }; trends: Array<{ currentQuantity: number; previousQuantity: number }> };
    assert.equal(advancedAnalytics.status, 200);
    assert.equal(advancedBody.plan, "ADVANCED");
    assert.equal(advancedBody.forecast.status, "INSUFFICIENT_DATA");
    assert.equal(advancedBody.forecast.minimumRequired, 3);
    assert.equal(advancedBody.comparison.status, "INSUFFICIENT_DATA");
    assert.ok(advancedBody.trends.every((item) => item.previousQuantity === 0));
    assert.ok(advancedBody.opportunities.every((item) => !/contratad|conversão|venda perdida/i.test(item.description)));
    assert.equal((await fetch(`${base}/v1/admin/analytics/intermediate?businessId=other-business&plan=ADVANCED`)).status, 403);
    const comparedAnalytics = await fetch(`${base}/v1/admin/analytics/advanced?businessId=preview-business&plan=ADVANCED&from=2026-09-29T00:00:00.000Z&to=2026-09-30T00:00:00.000Z`);
    const comparedBody = await comparedAnalytics.json() as { comparison: { status: string; metrics: Array<{ current: number; previous: number }> } };
    assert.equal(comparedAnalytics.status, 200);
    assert.equal(comparedBody.comparison.status, "AVAILABLE");
    assert.ok(comparedBody.comparison.metrics.some((metric) => metric.current === 4 && metric.previous === 0));
    assert.equal((await fetch(`${base}/v1/admin/analytics/intermediate?businessId=preview-business&plan=INTERMEDIATE&from=invalid`)).status, 400);

    const intermediateAdmin = await fetch(`${base}/admin?plan=INTERMEDIATE`);
    const intermediateHtml = await intermediateAdmin.text();
    assert.equal(intermediateAdmin.status, 200);
    assert.match(intermediateHtml, /adminPlan!=="BASIC"/);
    assert.match(intermediateHtml, /el\("button","Analytics"/);
    assert.match(intermediateHtml, /\/v1\/admin\/analytics\/intermediate/);
    const advancedAdmin = await fetch(`${base}/admin?plan=ADVANCED`);
    const advancedHtml = await advancedAdmin.text();
    assert.equal(advancedAdmin.status, 200);
    assert.match(advancedHtml, /Tendências|Gargalos|Oportunidades|Alertas/);

    */
    const platformOverview = await fetch(`${base}/v1/admin/platform/overview`);
    const platformBody = await platformOverview.json() as { businesses: { total: number; active: number }; plans: Array<{ plan: string; businesses: number; sharePercent: number }>; mostAdoptedPlan: string | null; geography: { status: string } };
    assert.equal(platformOverview.status, 200);
    assert.equal((await fetch(`${base}/v1/admin/analytics/intermediate?businessId=preview-business`)).status, 404);
    assert.equal((await fetch(`${base}/v1/admin/analytics/advanced?businessId=preview-business`)).status, 404);
    assert.equal(platformBody.businesses.total, 3);
    assert.equal(platformBody.businesses.active, 3);
    assert.deepEqual(platformBody.plans.map((item) => [item.plan, item.businesses]), [["BASIC", 1], ["INTERMEDIATE", 1], ["ADVANCED", 1]]);
    assert.ok(platformBody.plans.every((item) => item.sharePercent === 33.33));
    assert.equal(platformBody.mostAdoptedPlan, null);
    assert.equal(platformBody.geography.status, "NOT_AVAILABLE");
    for (const plan of ["BASIC", "INTERMEDIATE", "ADVANCED"]) {
      const filtered = await fetch(`${base}/v1/admin/platform/overview?plan=${plan}`);
      const filteredBody = await filtered.json() as { businesses: { total: number }; plans: Array<{ plan: string; businesses: number }> };
      assert.equal(filtered.status, 200);
      assert.equal(filteredBody.businesses.total, 1);
      assert.equal(filteredBody.plans.find((item) => item.plan === plan)?.businesses, 1);
    }
    const platformHealth = await fetch(`${base}/v1/admin/platform/health`);
    const healthBody = await platformHealth.json() as { status: string; issues: Array<{ type: string; byPlan: Array<{ plan: string }> }> };
    assert.equal(platformHealth.status, 200);
    assert.equal(healthBody.status, "ATTENTION");
    assert.ok(healthBody.issues.some((item) => item.type === "DELIVERY_FAILED_RETRYABLE" && item.byPlan.some((plan) => plan.plan === "ADVANCED")));
    const stockIssues = await fetch(`${base}/v1/admin/platform/issues?issueType=STOCK_UNKNOWN`);
    const stockIssueBody = await stockIssues.json() as Array<{ type: string }>;
    assert.deepEqual(stockIssueBody.map((item) => item.type), ["STOCK_UNKNOWN"]);
    const globalAdminHtml = await (await fetch(`${base}/admin`)).text();
    assert.match(globalAdminHtml, /Saúde da Plataforma|Adesão e Planos|Super Admin/);
    assert.doesNotMatch(globalAdminHtml, /admin\?plan=/);
    assert.match(globalAdminHtml, /<meta charset="UTF-8">/);
    assert.doesNotMatch(globalAdminHtml, /Ã[\u0080-\u00FF]|Â[\u0080-\u00FF]|â€|�/);
    assert.match(globalAdminHtml, /Empate/);
    assert.match(globalAdminHtml, /Pendentes < 1h/);
    assert.match(globalAdminHtml, /Pendentes 1h–2h/);
    assert.match(globalAdminHtml, /Pendentes > 2h/);
    assert.doesNotMatch(globalAdminHtml, /Pendentes há mais de 1h/);
    assert.match(globalAdminHtml, /Orçamentos e valores/);
    assert.match(globalAdminHtml, /Mediana/);
    assert.match(globalAdminHtml, /inferior/);
    assert.match(globalAdminHtml, /observada/);
    assert.match(globalAdminHtml, /superior/);
    assert.match(globalAdminHtml, /Valores consolidados a partir das/);
    assert.doesNotMatch(globalAdminHtml, /Menor or[^<]{0,3}amento|Maior or[^<]{0,3}amento/);
    assert.match(globalAdminHtml, /Distribuição geográfica ainda indisponível/);
    assert.match(globalAdminHtml, /Problema.*Ocorrências.*Empresas afetadas.*Plano/);
    assert.doesNotMatch(globalAdminHtml, /Sem plano/);

    const operator = await fetch(`${base}/operator`);
    const operatorHtml = await operator.text();
    assert.equal(operator.status, 200);
    assert.match(operatorHtml, /Ampliview/);
    for (const inventoryLabel of ["Disponibilidade", "Quantidade", "Unidade", "Fonte", "Consultado em", "Não consultado / desconhecido"]) assert.ok(operatorHtml.includes(inventoryLabel), `missing operator inventory label: ${inventoryLabel}`);
    assert.match(operatorHtml, /Empresa não configurada/);
    assert.match(operatorHtml, /Nenhum orçamento aguardando atendimento\./);
    for (const fictitiousOperatorValue of ["Oficina de Demonstração", "Carlos Almeida", "Mariana Souza", "Roberto Lima", "Toyota Corolla", "Volkswagen T-Cross", "Chevrolet Onix"]) {
      assert.ok(!operatorHtml.includes(fictitiousOperatorValue), `operator preview contains ${fictitiousOperatorValue}`);
    }
    assert.doesNotMatch(operatorHtml, /OPENAI_API_KEY/);
    const pendingOperator = await (await fetch(`${base}/v1/businesses/preview-business/quotes/pending`)).json() as { items: Array<{ quote: { id: string; status: string } }> };
    assert.equal(pendingOperator.items.length, 1);
    assert.equal(pendingOperator.items[0]?.quote.status, "WAITING_BUSINESS");
    const operatorInventory = await fetch(`${base}/v1/businesses/preview-business/quotes/preview-business-quote-waiting/inventory`);
    assert.equal(operatorInventory.status, 200);
    const operatorInventoryBody = await operatorInventory.json() as { availability: string; availableQuantity: number; unit: string; source: string };
    assert.deepEqual({ availability: operatorInventoryBody.availability, availableQuantity: operatorInventoryBody.availableQuantity, unit: operatorInventoryBody.unit, source: operatorInventoryBody.source }, {
      availability: "AVAILABLE", availableQuantity: 8, unit: "unidade", source: "local-fixture",
    });
    assert.equal((await fetch(`${base}/v1/businesses/other-business/quotes/preview-business-quote-waiting/inventory`)).status, 404);
    assert.equal((await fetch(`${base}/v1/businesses/preview-business/conversations/unknown-conversation/messages`)).status, 404);
    assert.equal((await fetch(`${base}/v1/businesses/preview-business/quotes/unknown-quote/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountCents: 10000, currency: "BRL" }) })).status, 404);
    assert.equal((await fetch(`${base}/v1/businesses/preview-business/quotes/unknown-quote/publish`, { method: "POST" })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("market mapping keeps its old data invariants and safe renderer guarantees", () => {
  assert.deepEqual(MANAUS_COMMERCIAL_REGIONS, ["Norte", "Sul", "Leste", "Oeste"]);
  assert.equal(MANAUS_COMMERCIAL_CLUSTERS.length, 16);
  assert.deepEqual(new Set(MANAUS_COMMERCIAL_CLUSTERS.map(({ region }) => region)), new Set(MANAUS_COMMERCIAL_REGIONS));
  assert.ok(MANAUS_COMMERCIAL_CLUSTERS.every((cluster) => !("demoSignal" in cluster)));
  assert.equal(MANAUS_MAPPED_BUSINESSES.length, 31);
  assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ verificationStatus }) => verificationStatus === "PUBLIC_LISTING_ONLY").length, 31);
  assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ verificationStatus }) => verificationStatus !== "PUBLIC_LISTING_ONLY").length, 0);
  assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ sourceKind }) => sourceKind === "PUBLIC_DIRECTORY").length, 2);
  assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ sourceUrl }) => sourceUrl && /^https:\/\//i.test(sourceUrl)).length, 2);
  for (const business of MANAUS_MAPPED_BUSINESSES) {
    const cluster = MANAUS_COMMERCIAL_CLUSTERS.find((candidate) => candidate.name === business.cluster);
    assert.ok(cluster);
    assert.equal(cluster.region, business.region);
    assert.ok(business.name.trim() && business.address.trim() && business.neighborhood.trim() && business.segments.length > 0);
    assert.equal(business.mappedAt, "2026-09-25");
    assert.equal(business.verificationStatus, "PUBLIC_LISTING_ONLY");
    assert.ok(!("cnpj" in business) && !("legalName" in business) && !("validatedAt" in business));
    assert.ok(["PUBLIC_MAP_LISTING", "PUBLIC_DIRECTORY"].includes(business.sourceKind));
    assert.ok(!business.name.includes("Ampliview") && !("businessId" in business) && !("customerId" in business));
    if (business.sourceKind === "PUBLIC_DIRECTORY") assert.ok(business.sourceName === "Solutudo" && business.sourceUrl);
    if (business.sourceKind === "PUBLIC_MAP_LISTING") assert.equal(business.sourceName, "Listagem pública de mapa");
  }
  const mappedClusterKeys = new Set(MANAUS_MAPPED_BUSINESSES.map((business) => business.region + "|" + business.cluster));
  assert.equal(mappedClusterKeys.size, 16);
  assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ region }) => region === "Norte").length, 6);
  assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ region }) => region === "Sul").length, 10);
  assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ region }) => region === "Leste").length, 8);
  assert.equal(MANAUS_MAPPED_BUSINESSES.filter(({ region }) => region === "Oeste").length, 7);

  const maliciousName = "</script><script>alert(1)</script>";
  const html = renderAmpliviewAdminUi({
    businessId: "preview-business",
    marketMapping: { regions: MANAUS_COMMERCIAL_REGIONS, clusters: MANAUS_COMMERCIAL_CLUSTERS, mappedBusinesses: [{
      name: maliciousName, region: "Norte", cluster: "cluster", neighborhood: "bairro", address: "endereço", segments: ["SERVICE"],
      sourceKind: "PUBLIC_DIRECTORY", sourceName: "Fonte", sourceUrl: "javascript:alert(2)", verificationStatus: "PUBLIC_LISTING_ONLY", mappedAt: "2026-09-25",
    }] },
  });
  assert.ok(html.includes("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"));
  assert.ok(!html.includes(maliciousName));
  assert.doesNotMatch(html, /innerHTML/);
  assert.doesNotMatch(html, /href=\"javascript:/i);
  assert.match(html, /isValidHttpsUrl/);
  assert.match(html, /formatCnpj/);
  assert.match(html, /formatMappedDate/);
  assert.match(html, /target/,);
  assert.match(html, /noopener noreferrer/);
  assert.match(html, /CNPJ validado|CNPJ não localizado|Validação cadastral inconclusiva|Status de validação não reconhecido/);
  const adminScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(adminScript);
  const cnpjFormatterSource = adminScript.match(/function formatCnpj\(value\)\{[\s\S]*?(?=function formatMappedDate)/)?.[0];
  assert.ok(cnpjFormatterSource);
  const formatCnpj = new Function(`${cnpjFormatterSource}; return formatCnpj;`)() as (value: string) => string;
  assert.equal(formatCnpj("12345678000190"), "12.345.678/0001-90");
  assert.equal(formatCnpj("1234567800019"), "1234567800019");
  const legacyMalicious = renderAmpliviewAdminUi({ name: maliciousName }, { regions: [], clusters: [], mappedBusinesses: [] });
  assert.ok(!legacyMalicious.includes(maliciousName));
  assert.doesNotMatch(legacyMalicious, /innerHTML/);
});

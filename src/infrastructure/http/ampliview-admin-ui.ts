export type AmpliviewAdminDemoData = {
  overview: {
    activeBusinesses: number;
    attendances: number;
    commercialRequests: number;
    respondedQuotes: number;
    authorizedAmountCents: number;
    aiResolutionPercent: number;
    attendancePeriods: Array<{ label: string; count: number }>;
    businessesByRegion: Array<{ region: string; count: number }>;
    channels: Array<{ channel: string; count: number }>;
    commercialResults: Array<{ result: string; count: number }>;
    operationalAlerts: Array<{ label: string; count: number }>;
  };
  attendances: Array<{
    business: string;
    channel: string;
    customer: string;
    vehicle: string;
    intent: string;
    requestedItem: string;
    outcome: string;
    occurredAt: string;
  }>;
  assistantHealth: {
    issues: Array<{ issue: string; occurrences: number; percent: string; businessesAffected: number; trend: string }>;
    causes: string[];
  };
  regionalAdoption: Array<{
    region: string;
    activeBusinesses: number;
    newBusinesses: number;
    segments: string[];
    penetrationPercent: number;
    trend: string;
  }>;
  coverageDeficits: Array<{ area: string; signal: string; coverage: string }>;
  demand: Array<{ item: string; volume: number; changePercent: number; regions: string[]; segments: string[] }>;
  merchandising: {
    unexploredDemand: Array<{ item: string; interests: number; offers: number; conversions: number; gap: number }>;
    opportunitiesByRegion: Array<{ region: string; segment: string; demand: string; coverage: string }>;
    opportunitiesBySegment: Array<{ segment: string; signal: string }>;
    productTrends: Array<{ item: string; changePercent: number }>;
  };
  businesses: Array<{
    name: string;
    type: string;
    city: string;
    state: string;
    region: string;
    attendances: number;
    requests: number;
    conversion: string;
    lastActivity: string;
  }>;
};

const sections = [
  ["overview", "Visão Geral"],
  ["attendances", "Atendimentos"],
  ["health", "Saúde do Atendente"],
  ["adoption", "Adesão e Cobertura"],
  ["mapped-market", "Mercado Mapeado"],
  ["demand", "Demanda"],
  ["merchandising", "Merchandising"],
  ["businesses", "Empresas"],
] as const;

type AmpliviewAdminMarketData = {
  regions: readonly string[];
  clusters: readonly { region: string; name: string; neighborhoods: readonly string[] }[];
  mappedBusinesses: readonly {
    name: string;
    region: string;
    cluster: string;
    neighborhood: string;
    address: string;
    segments: readonly string[];
    sourceKind: "PUBLIC_MAP_LISTING" | "PUBLIC_DIRECTORY";
    sourceName: string;
    sourceUrl?: string;
    verificationStatus: "PUBLIC_LISTING_ONLY";
    mappedAt: string;
  }[];
};

export function renderAmpliviewAdminUi(data: AmpliviewAdminDemoData, marketMapping: AmpliviewAdminMarketData): string {
  const safeData = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const safeMarketMapping = JSON.stringify({
    regions: marketMapping.regions,
    clusters: marketMapping.clusters,
    mappedBusinesses: marketMapping.mappedBusinesses.map(({ name, region, cluster, neighborhood, address, segments, sourceName }) => ({
      name, region, cluster, neighborhood, address, segments, sourceName,
    })),
  })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const nav = sections.map(([id, label], index) =>
    `<button type="button" class="nav-item" data-view="${id}"${index === 0 ? ' aria-current="page"' : ""}>${label}</button>`,
  ).join("");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Portal Ampliview</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#172d38;background:#f2f5f6}*{box-sizing:border-box}body{margin:0;min-width:320px}.shell{min-height:100vh;display:grid;grid-template-columns:248px minmax(0,1fr)}.sidebar{background:#102f3e;color:#f4f8f9;padding:24px 16px}.brand{display:flex;align-items:center;gap:11px;padding:0 9px 25px;border-bottom:1px solid #ffffff22}.mark{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:#39b98a;color:#103746;font-weight:800}.brand strong,.brand small{display:block}.brand small{margin-top:3px;color:#c1d2d8;font-size:11px}.portal-label{margin:22px 9px 10px;color:#9fb5be;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.navigation{display:grid;gap:4px}.nav-item{width:100%;padding:11px 12px;border:0;border-radius:8px;background:transparent;color:#d9e5e9;text-align:left;font:inherit;font-size:13px;cursor:pointer}.nav-item:hover,.nav-item[aria-current=page]{background:#ffffff16;color:white}.nav-item[aria-current=page]{box-shadow:inset 3px 0 #39b98a}.main{min-width:0;padding:28px clamp(18px,3vw,42px) 46px}.topline{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:18px}.portal-title{margin:0;color:#536a74;font-size:13px;font-weight:650}.demo-badge{padding:8px 11px;border:1px solid #f0cf8a;border-radius:999px;background:#fff6df;color:#755311;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}.demo-notice{margin:0 0 25px;padding:15px 17px;border:1px solid #efd18e;border-left:4px solid #d69a2b;border-radius:9px;background:#fff8e8;color:#654a16}.demo-notice strong{display:block;margin-bottom:4px;font-size:13px}.demo-notice p{margin:0;font-size:12px;line-height:1.5}.view-title{margin:0;font-size:27px;letter-spacing:-.035em}.view-subtitle{margin:7px 0 22px;color:#687b84;font-size:14px}.metric-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:11px}.metric-card,.panel,.data-card{min-width:0;border:1px solid #dfe7e9;border-radius:11px;background:#fff;box-shadow:0 3px 12px #16384708}.metric-card{padding:15px}.metric-label{margin:0;color:#637780;font-size:11px;line-height:1.4}.metric-value{display:block;margin-top:9px;color:#153e4d;font-size:21px;font-weight:780;letter-spacing:-.04em}.section-heading{margin:24px 0 12px;font-size:16px}.panel{padding:16px}.table-panel{padding:0;overflow:hidden}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th,td{padding:11px 12px;border-bottom:1px solid #edf1f2;white-space:nowrap}th{background:#f7f9fa;color:#536973;font-size:10px;letter-spacing:.04em;text-transform:uppercase}tbody tr:last-child td{border-bottom:0}.dashboard-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin-top:19px}.data-card{padding:16px}.data-card h2,.panel h2{margin:0 0 13px;font-size:14px}.bar-list{display:grid;gap:13px}.bar-row{display:grid;grid-template-columns:minmax(118px,175px) 1fr 40px;align-items:center;gap:10px;font-size:12px}.bar-track{height:8px;overflow:hidden;border-radius:99px;background:#eaf0f1}.bar-fill{height:100%;border-radius:inherit;background:#21936c}.bar-count{text-align:right;color:#526a74;font-variant-numeric:tabular-nums}.simple-list{display:grid;gap:8px}.simple-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #edf1f2;color:#50656e;font-size:12px}.simple-row:last-child{border:0}.alerts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.alert-card{padding:13px;border:1px solid #efd8bd;border-radius:9px;background:#fff9f2}.alert-count{display:block;color:#98591e;font-size:21px;font-weight:800}.alert-label{color:#71583f;font-size:11px;line-height:1.4}.filters{display:flex;flex-wrap:wrap;gap:9px;margin:15px 0}.filters label{color:#647780;font-size:11px}.filters select{display:block;min-width:120px;margin-top:5px;padding:8px;border:1px solid #d5e0e3;border-radius:7px;background:#f8fafb;color:#71818a;font:inherit;font-size:12px}.two-column{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.opportunity-card{position:relative;padding:15px;border:1px solid #dfe7e9;border-radius:10px;background:#fff}.opportunity-card h3{margin:0 0 8px;font-size:14px}.opportunity-card p{margin:5px 0;color:#60737b;font-size:12px}.demo-tag{display:inline-block;margin-top:8px;padding:5px 8px;border-radius:999px;background:#fff3d5;color:#755311;font-size:10px;font-weight:750}.footer-note{margin-top:25px;color:#839097;font-size:11px}@media(max-width:1250px){.metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:760px){.shell{display:block}.sidebar{padding:14px 14px 10px}.brand{padding:0 4px 12px;border:0}.portal-label{display:none}.navigation{display:flex;overflow-x:auto;gap:6px;padding:3px 0 5px}.nav-item{width:auto;flex:0 0 auto;padding:9px 11px;font-size:12px}.main{padding:19px 15px 35px}.topline{align-items:flex-start}.demo-badge{font-size:9px}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-grid,.two-column{grid-template-columns:1fr}.alerts{grid-template-columns:repeat(2,minmax(0,1fr))}.view-title{font-size:24px}.bar-row{grid-template-columns:minmax(105px,145px) 1fr 34px;gap:8px}}@media(max-width:420px){.metric-card{padding:12px}.metric-value{font-size:19px}.metric-label{font-size:10px}.bar-row{grid-template-columns:105px 1fr 30px;font-size:11px}}
.cluster-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cluster-card{padding:14px;border:1px solid #dfe7e9;border-radius:10px;background:#fff}.cluster-card h3{margin:0 0 7px;font-size:14px}.cluster-card p{margin:5px 0;color:#60737b;font-size:12px;line-height:1.45}@media(max-width:760px){.cluster-grid{grid-template-columns:1fr}}
.market-notice{margin:0 0 18px;padding:18px;border:2px solid #d69a2b;border-left-width:7px;border-radius:10px;background:#fff8e8;color:#654a16}.market-notice strong{display:block;margin-bottom:6px;font-size:14px}.market-notice p{margin:0;font-size:13px;line-height:1.5}.empty-state{margin:18px 0;padding:14px;border:1px dashed #97aab1;border-radius:9px;background:#fff;color:#536a74;font-weight:700}.cluster-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cluster-card{padding:14px;border:1px solid #dfe7e9;border-radius:10px;background:#fff}.cluster-card h3{margin:0 0 7px;font-size:14px}.cluster-card p{margin:5px 0;color:#60737b;font-size:12px;line-height:1.45}@media(max-width:760px){.cluster-grid{grid-template-columns:1fr}}.validation-status{display:inline-block;padding:5px 8px;border-radius:999px;background:#fff3d5;color:#755311;font-size:10px;font-weight:750}.market-notice{font-size:13px}</style></head><body><div class="shell"><aside class="sidebar"><div class="brand"><span class="mark" aria-hidden="true">A</span><span><strong>Ampliview</strong><small>Inteligência comercial e operacional</small></span></div><p class="portal-label">Portal interno</p><nav class="navigation" aria-label="Navegação do painel">${nav}</nav></aside><main class="main"><div class="topline"><p class="portal-title">Portal Ampliview</p><span class="demo-badge">Ambiente de validação</span></div><aside class="demo-notice" role="note"><strong>Ambiente de validação</strong><p>Indicadores operacionais da Ampliview são demonstrativos. Dados identificados como Mercado Mapeado pertencem a levantamento público externo e não representam clientes Ampliview.</p></aside><section id="admin-content" aria-live="polite"></section><p class="footer-note">Ampliview · ambiente de demonstração</p></main></div>
<script>
"use strict";
const demo=${safeData};
const market=${safeMarketMapping};
const content=document.getElementById("admin-content");
const navButtons=Array.from(document.querySelectorAll("[data-view]"));
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;}
function heading(title,subtitle){content.replaceChildren();content.append(el("h1",title,"view-title"),el("p",subtitle,"view-subtitle"));}
function table(headers,rows){const wrap=el("div",undefined,"panel table-panel table-wrap");const tableNode=document.createElement("table");const head=document.createElement("thead");const headRow=document.createElement("tr");for(const value of headers)headRow.append(el("th",value));head.append(headRow);const body=document.createElement("tbody");for(const row of rows){const tr=document.createElement("tr");for(const value of row)tr.append(el("td",value));body.append(tr);}tableNode.append(head,body);wrap.append(tableNode);return wrap;}
function bars(items,labelKey,valueKey,suffix){const list=el("div",undefined,"bar-list");const maximum=Math.max(1,...items.map(item=>Number(item[valueKey])));for(const item of items){const row=el("div",undefined,"bar-row");row.append(el("span",item[labelKey]));const track=el("div",undefined,"bar-track");const fill=el("div",undefined,"bar-fill");fill.style.width=(Number(item[valueKey])/maximum*100)+"%";track.append(fill);row.append(track,el("strong",String(item[valueKey])+suffix,"bar-count"));list.append(row);}return list;}
function card(title,child){const node=el("article",undefined,"data-card");node.append(el("h2",title));node.append(child);return node;}
function renderOverview(){heading("Visão Geral","Resumo executivo demonstrativo da operação Ampliview.");const kpis=[["Empresas ativas",demo.overview.activeBusinesses],["Atendimentos",demo.overview.attendances],["Solicitações comerciais",demo.overview.commercialRequests],["Orçamentos respondidos",demo.overview.respondedQuotes], ["Valor autorizado",(demo.overview.authorizedAmountCents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})],["Resolução pela IA",demo.overview.aiResolutionPercent+"%"]];const grid=el("div",undefined,"metric-grid");for(const [label,value] of kpis){const metric=el("article",undefined,"metric-card");metric.append(el("p",label,"metric-label"),el("strong",typeof value==="number"?value.toLocaleString("pt-BR"):value,"metric-value"));grid.append(metric);}const distributions=el("div",undefined,"dashboard-grid");distributions.append(card("Atendimentos por período",bars(demo.overview.attendancePeriods,"label","count","")),card("Empresas por região",bars(demo.overview.businessesByRegion,"region","count","")));const channelRows=el("div",undefined,"simple-list");for(const entry of demo.overview.channels){const row=el("div",undefined,"simple-row");row.append(el("span",entry.channel),el("strong",entry.count));channelRows.append(row);}const resultRows=el("div",undefined,"simple-list");for(const entry of demo.overview.commercialResults){const row=el("div",undefined,"simple-row");row.append(el("span",entry.result),el("strong",entry.count));resultRows.append(row);}distributions.append(card("Canais utilizados",channelRows),card("Resultados comerciais",resultRows));content.append(grid,distributions,el("h2","Atenção operacional","section-heading"));const alerts=el("div",undefined,"alerts");for(const alert of demo.overview.operationalAlerts){const box=el("article",undefined,"alert-card");box.append(el("strong",alert.count,"alert-count"),el("span",alert.label,"alert-label"));alerts.append(box);}content.append(alerts);}
function renderAttendances(){heading("Atendimentos","Registros demonstrativos preparados para análise estruturada.");content.append(table(["Empresa","Canal","Cliente","Veículo","Intenção","Solicitação","Resultado","Data/hora"],demo.attendances.map(x=>[x.business,x.channel,x.customer,x.vehicle,x.intent,x.requestedItem,x.outcome,x.occurredAt])));}
function renderHealth(){heading("Saúde do Atendente","Indicadores técnicos e operacionais demonstrativos.");const filters=el("div",undefined,"filters");for(const label of ["Empresa","Canal","Tipo de negócio","Modelo de IA","Período"]){const group=el("label",label);const select=document.createElement("select");select.disabled=true;select.append(el("option","Todos"));group.append(select);filters.append(group);}content.append(filters,table(["Problema","Ocorrências","% dos atendimentos","Empresas afetadas","Tendência"],demo.assistantHealth.issues.map(x=>[x.issue,x.occurrences,x.percent,x.businessesAffected,x.trend])),el("h2","Principais causas técnicas","section-heading"));const causes=el("div",undefined,"two-column");for(const cause of demo.assistantHealth.causes)causes.append(el("article",cause,"opportunity-card"));content.append(causes);}
function renderAdoption(){heading("Adesão e Cobertura","Indicadores demonstrativos de adesão de clientes Ampliview por macrorregião.");content.append(table(["Macrorregião","Empresas ativas","Novas empresas","Segmentos atendidos","Penetração relativa","Tendência"],demo.regionalAdoption.map(x=>[x.region,x.activeBusinesses,x.newBusinesses,x.segments.join(" / "),x.penetrationPercent+"%",x.trend])));content.append(el("h2","Simulação de cobertura Ampliview","section-heading"),el("p","Exemplos demonstrativos da cobertura Ampliview; não representam déficit real do mercado automotivo de Manaus.","view-subtitle"));const coverage=el("div",undefined,"two-column");for(const row of demo.coverageDeficits){const item=el("article",undefined,"opportunity-card");item.append(el("h3",row.area),el("p",row.signal),el("p",row.coverage),el("span","Dados de demonstração","demo-tag"));coverage.append(item);}content.append(coverage);}
function renderMappedMarket(){heading("Mercado Mapeado","Levantamento público do mercado automotivo de Manaus por macrorregião e conglomerado.");const notice=el("aside",undefined,"market-notice");notice.append(el("strong","Empresas encontradas neste levantamento são estabelecimentos do mercado e não representam clientes Ampliview."),el("p","O levantamento é progressivo e não constitui censo completo do setor; não comprova situação cadastral ou CNPJ."));const mappedClusters=market.clusters.filter(cluster=>market.mappedBusinesses.some(business=>business.region===cluster.region&&business.cluster===cluster.name));const metrics=el("div",undefined,"metric-grid");for(const entry of [["Macrorregiões",market.regions.length],["Conglomerados definidos",market.clusters.length],["Empresas mapeadas",market.mappedBusinesses.length],["Conglomerados com registros",mappedClusters.length]]){const metric=el("article",undefined,"metric-card");metric.append(el("p",entry[0],"metric-label"),el("strong",Number(entry[1]).toLocaleString("pt-BR"),"metric-value"));metrics.append(metric);}content.append(notice,metrics,el("h2","Registros mapeados por macrorregião","section-heading"));content.append(table(["Macrorregião","Registros incorporados ao levantamento"],market.regions.map(region=>[region,market.mappedBusinesses.filter(business=>business.region===region).length])));content.append(el("p","Contagem referente apenas aos estabelecimentos já incorporados ao levantamento público.","view-subtitle"),el("h2","Conglomerados comerciais","section-heading"));for(const region of market.regions){const clusters=market.clusters.filter(cluster=>cluster.region===region);content.append(el("h3",region,"section-heading"));const list=el("div",undefined,"cluster-grid");for(const cluster of clusters){const item=el("article",undefined,"cluster-card");item.append(el("h4",cluster.name),el("p",cluster.neighborhoods.join(" · ")));list.append(item);}content.append(list);}content.append(el("h2","Estabelecimentos encontrados","section-heading"));const listings=table(["Empresa","Segmento","Bairro","Conglomerado","Macrorregião","Fonte","Status da validação"],[]);const listingBody=listings.querySelector("tbody");for(const business of market.mappedBusinesses){const row=document.createElement("tr");const values=[business.name,business.segments.join(" / "),business.neighborhood,business.cluster,business.region,business.sourceName];for(const value of values)row.append(el("td",value));const statusCell=el("td");statusCell.append(el("span","Listagem pública — CNPJ ainda não validado","validation-status"));row.append(statusCell);listingBody.append(row);}content.append(listings);}
function renderDemand(){heading("Demanda","Tendências agregadas demonstrativas do mercado atendido.");content.append(table(["Produto/serviço","Volume identificado","Variação no período","Regiões com maior procura","Segmentos predominantes"],demo.demand.map(x=>[x.item,x.volume,"+"+x.changePercent+"%",x.regions.join(" / "),x.segments.join(" / ")])),el("h2","Demandas em crescimento","section-heading"));const sorted=[...demo.demand].sort((a,b)=>b.changePercent-a.changePercent).map(x=>({item:x.item,count:x.changePercent}));content.append(card("Demandas em crescimento",bars(sorted,"item","count","%")));}
function renderMerchandising(){heading("Merchandising","Oportunidades e tendências demonstrativas da operação Ampliview.");content.append(el("h2","Demanda não explorada","section-heading"),table(["Produto/serviço","Interesse identificado","Oferta apresentada","Conversão","Gap comercial"],demo.merchandising.unexploredDemand.map(x=>[x.item,x.interests,x.offers,x.conversions,x.gap])));const regions=el("div",undefined,"two-column");for(const item of demo.merchandising.opportunitiesByRegion){const box=el("article",undefined,"opportunity-card");box.append(el("h3","Macrorregião "+item.region),el("p",item.segment),el("p",item.demand+" · "+item.coverage),el("span","Dados de demonstração","demo-tag"));regions.append(box);}content.append(el("h2","Oportunidades demonstrativas por macrorregião","section-heading"),regions,el("h2","Oportunidades por segmento","section-heading"),table(["Segmento","Sinal demonstrativo"],demo.merchandising.opportunitiesBySegment.map(x=>[x.segment,x.signal])),el("h2","Tendências de produtos/serviços","section-heading"),card("Variação demonstrativa",bars(demo.merchandising.productTrends.map(x=>({item:x.item,count:x.changePercent})),"item","count","%")));}
function renderBusinesses(){heading("Empresas","Exemplos demonstrativos de empresas clientes Ampliview.");content.append(table(["Empresa","Tipo","Cidade","UF","Região","Atendimentos","Solicitações","Conversão","Última atividade"],demo.businesses.map(x=>[x.name,x.type,x.city,x.state,x.region,x.attendances,x.requests,x.conversion,x.lastActivity])));}
const renderers={overview:renderOverview,attendances:renderAttendances,health:renderHealth,adoption:renderAdoption,"mapped-market":renderMappedMarket,demand:renderDemand,merchandising:renderMerchandising,businesses:renderBusinesses};function show(view){(renderers[view]||renderOverview)();for(const button of navButtons){if(button.dataset.view===view)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");}}for(const button of navButtons)button.addEventListener("click",()=>show(button.dataset.view));show("overview");
</script></body></html>`;
}

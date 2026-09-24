export type BasicPlanOperatorConfig = {
  businessId: string;
  businessName: string;
};

export function renderBasicPlanOperatorUi(operator: BasicPlanOperatorConfig): string {
  const safeConfig = JSON.stringify(operator)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Orçamentos | Ampliview</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17212b; background: #f3f6f8; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; }
    header { background: #102d3d; color: #fff; border-bottom: 4px solid #39b98a; }
    .header-inner, main { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }
    .header-inner { min-height: 82px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .brand { display: flex; align-items: center; gap: 13px; }
    .brand-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 11px; background: #39b98a; color: #102d3d; font-weight: 800; font-size: 19px; }
    .brand-name { margin: 0; font-size: 18px; letter-spacing: -.03em; }
    .brand-caption { margin: 3px 0 0; color: #c6d5dc; font-size: 12px; }
    .business-name { color: #e3edf0; font-size: 14px; text-align: right; }
    main { padding: 38px 0 56px; }
    .page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 25px; }
    h1 { margin: 0; font-size: clamp(27px, 4vw, 34px); letter-spacing: -.04em; }
    .subtitle { margin: 8px 0 0; color: #63727d; }
    button { border: 0; border-radius: 9px; padding: 11px 16px; background: #147a5a; color: white; font: inherit; font-weight: 700; cursor: pointer; transition: background .15s ease, transform .15s ease; }
    button:hover:not(:disabled) { background: #0e6348; }
    button:active:not(:disabled) { transform: translateY(1px); }
    button:disabled { cursor: wait; opacity: .65; }
    button:focus-visible, input:focus-visible { outline: 3px solid #f0ae45; outline-offset: 3px; }
    .summary { display: flex; align-items: center; gap: 14px; padding: 16px 19px; margin-bottom: 18px; border: 1px solid #dce5e9; border-radius: 12px; background: #fff; }
    .summary-count { color: #147a5a; font-size: 27px; font-weight: 800; line-height: 1; }
    .summary-label { color: #52616b; font-size: 14px; }
    .feedback { margin: 0 0 18px; padding: 13px 15px; border-radius: 9px; background: #fff2de; color: #754600; font-size: 14px; }
    .feedback[hidden] { display: none; }
    .feedback[data-kind="success"] { background: #e6f7ef; color: #145b3d; }
    .feedback[data-kind="error"] { background: #fff0ee; color: #8a2d25; }
    .empty-state { padding: 44px 20px; border: 1px dashed #cbd8dd; border-radius: 12px; background: #fff; color: #63727d; text-align: center; }
    .empty-state strong { display: block; margin-bottom: 6px; color: #243640; font-size: 16px; }
    .quote-list { display: grid; gap: 15px; }
    .quote-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(235px, 285px); gap: 24px; padding: 21px; border: 1px solid #dce5e9; border-radius: 13px; background: #fff; box-shadow: 0 3px 12px #19384a0b; }
    .card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .customer-name { margin: 0; font-size: 19px; }
    .contact { margin: 5px 0 0; color: #63727d; font-size: 13px; }
    .status { display: inline-flex; flex-shrink: 0; padding: 6px 9px; border-radius: 999px; background: #fff2de; color: #80520d; font-size: 12px; font-weight: 700; }
    .details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 20px; margin: 21px 0 0; }
    .detail { min-width: 0; }
    .detail-label { display: block; margin-bottom: 4px; color: #71808a; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .detail-value { color: #243640; font-size: 14px; overflow-wrap: anywhere; }
    .request-detail { grid-column: 1 / -1; }
    .action-panel { align-self: start; padding: 17px; border-radius: 10px; background: #f4f8f7; }
    .action-panel h3 { margin: 0 0 14px; font-size: 15px; }
    .price-label { display: block; margin-bottom: 7px; color: #44545d; font-size: 13px; font-weight: 650; }
    .price-control { display: flex; align-items: center; margin-bottom: 12px; border: 1px solid #b9c9c7; border-radius: 8px; background: #fff; }
    .price-prefix { padding-left: 12px; color: #52616b; }
    input { width: 100%; min-width: 0; border: 0; border-radius: 8px; padding: 11px 10px; color: #17212b; font: inherit; background: transparent; }
    .send-button { width: 100%; }
    .card-message { min-height: 20px; margin: 10px 0 0; color: #52616b; font-size: 12px; line-height: 1.5; }
    .card-message[data-kind="error"] { color: #8a2d25; }
    .card-message[data-kind="success"] { color: #145b3d; }
    @media (max-width: 720px) {
      .header-inner, main { width: min(100% - 28px, 560px); }
      .header-inner { min-height: 72px; }
      .brand-caption { font-size: 11px; }
      .business-name { max-width: 42%; font-size: 12px; }
      main { padding-top: 27px; }
      .page-heading { align-items: flex-start; flex-direction: column; }
      .page-heading button { width: 100%; }
      .quote-card { grid-template-columns: 1fr; gap: 17px; padding: 17px; }
      .action-panel { width: 100%; }
    }
    @media (max-width: 430px) {
      .brand-mark { width: 34px; height: 34px; }
      .brand-name { font-size: 16px; }
      .business-name { max-width: 38%; font-size: 11px; }
      .details { grid-template-columns: 1fr; gap: 12px; }
      .request-detail { grid-column: auto; }
      .card-top { flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">A</span>
        <div><p class="brand-name">Ampliview</p><p class="brand-caption">Atendente Automotivo 24/7</p></div>
      </div>
      <div class="business-name">${escapeHtml(operator.businessName)}</div>
    </div>
  </header>
  <main>
    <section class="page-heading" aria-labelledby="page-title">
      <div><h1 id="page-title">Orçamentos</h1><p class="subtitle">Solicitações que precisam de atenção</p></div>
      <button id="refresh-button" type="button">Atualizar</button>
    </section>
    <section class="summary" aria-label="Resumo da fila">
      <span id="queue-count" class="summary-count">—</span>
      <span class="summary-label">orçamentos na fila</span>
    </section>
    <div id="feedback" class="feedback" role="status" aria-live="polite" hidden></div>
    <section id="queue" aria-label="Orçamentos pendentes"></section>
  </main>
  <script>
    "use strict";
    const operator = ${safeConfig};
    const queue = document.getElementById("queue");
    const count = document.getElementById("queue-count");
    const feedback = document.getElementById("feedback");
    const refreshButton = document.getElementById("refresh-button");
    let sending = false;
    let loading = false;

    function setFeedback(message, kind) {
      feedback.textContent = message;
      feedback.dataset.kind = kind || "info";
      feedback.hidden = !message;
    }

    function text(value) {
      if (typeof value === "string" && value.trim()) return value;
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return "—";
    }

    function addDetail(parent, label, value, extraClass) {
      const wrapper = document.createElement("div");
      wrapper.className = extraClass ? "detail " + extraClass : "detail";
      const labelNode = document.createElement("span");
      labelNode.className = "detail-label";
      labelNode.textContent = label;
      const valueNode = document.createElement("span");
      valueNode.className = "detail-value";
      valueNode.textContent = text(value);
      wrapper.append(labelNode, valueNode);
      parent.append(wrapper);
    }

    function statusLabel(status) {
      if (status === "WAITING_BUSINESS") return "Aguardando orçamento";
      if (status === "WAITING_INFORMATION") return "Aguardando informações do cliente";
      if (status === "REQUESTED") return "Solicitado";
      return "—";
    }

    function dateLabel(value) {
      if (typeof value !== "string" || !value) return "—";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
    }

    function priceToCents(value) {
      const normalized = value.trim();
      const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(normalized);
      if (!match) return null;
      try {
        const whole = BigInt(match[1]);
        const fraction = BigInt((match[2] || "").padEnd(2, "0"));
        const cents = whole * 100n + fraction;
        if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        const result = Number(cents);
        return Number.isSafeInteger(result) ? result : null;
      } catch {
        return null;
      }
    }

    function makeCard(item) {
      const quote = item.quote || {};
      const customer = item.customer;
      const vehicle = item.vehicle;
      const card = document.createElement("article");
      card.className = "quote-card";
      const details = document.createElement("div");
      const top = document.createElement("div");
      top.className = "card-top";
      const identity = document.createElement("div");
      const customerName = document.createElement("h2");
      customerName.className = "customer-name";
      customerName.textContent = text(customer && customer.name);
      const contact = document.createElement("p");
      contact.className = "contact";
      contact.textContent = text(customer && customer.primaryPhone);
      identity.append(customerName, contact);
      const status = document.createElement("span");
      status.className = "status";
      status.textContent = statusLabel(quote.status);
      top.append(identity, status);
      details.append(top);

      const fields = document.createElement("div");
      fields.className = "details";
      const vehicleName = vehicle ? [vehicle.brand, vehicle.model].filter((part) => typeof part === "string" && part.trim()).join(" ") : "";
      addDetail(fields, "Veículo", vehicleName || "—");
      addDetail(fields, "Ano", vehicle && vehicle.year);
      addDetail(fields, "Versão", vehicle && vehicle.version);
      addDetail(fields, "Solicitação", quote.requestDescription, "request-detail");
      addDetail(fields, "Sintoma", quote.symptomDescription, "request-detail");
      addDetail(fields, "Solicitado em", dateLabel(quote.requestedAt));
      details.append(fields);

      if (quote.status === "WAITING_BUSINESS") {
        const panel = document.createElement("form");
        panel.className = "action-panel";
        const heading = document.createElement("h3");
        heading.textContent = "Autorizar valor";
        const inputId = "authorized-price-" + String(quote.id || "quote").replace(/[^a-zA-Z0-9_-]/g, "-");
        const label = document.createElement("label");
        label.className = "price-label";
        label.htmlFor = inputId;
        label.textContent = "Valor autorizado";
        const control = document.createElement("div");
        control.className = "price-control";
        const prefix = document.createElement("span");
        prefix.className = "price-prefix";
        prefix.textContent = "R$";
        const input = document.createElement("input");
        input.id = inputId;
        input.type = "text";
        input.inputMode = "decimal";
        input.autocomplete = "off";
        input.setAttribute("aria-label", "Valor autorizado em reais");
        control.append(prefix, input);
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.className = "send-button";
        submit.textContent = "Autorizar e enviar";
        const message = document.createElement("p");
        message.className = "card-message";
        message.setAttribute("aria-live", "polite");
        panel.append(heading, label, control, submit, message);
        panel.addEventListener("submit", (event) => {
          event.preventDefault();
          void authorizeAndPublish(String(quote.id || ""), input, submit, message);
        });
        card.append(details, panel);
      } else {
        card.append(details);
      }
      return card;
    }

    async function authorizeAndPublish(quoteId, input, button, message) {
      const amountCents = priceToCents(input.value);
      if (amountCents === null) {
        message.textContent = "Informe um valor válido.";
        message.dataset.kind = "error";
        input.focus();
        return;
      }
      if (!quoteId || sending) return;
      sending = true;
      button.disabled = true;
      button.textContent = "Processando...";
      message.textContent = "Processando...";
      message.dataset.kind = "info";
      let priceAuthorized = false;
      const base = "/v1/businesses/" + encodeURIComponent(operator.businessId) + "/quotes/" + encodeURIComponent(quoteId);
      try {
        const respond = await fetch(base + "/respond", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountCents, currency: "BRL" })
        });
        if (!respond.ok) {
          message.textContent = "Não foi possível autorizar o preço. Verifique os dados e tente novamente.";
          message.dataset.kind = "error";
          return;
        }
        priceAuthorized = true;
        const publish = await fetch(base + "/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}"
        });
        if (!publish.ok) throw new Error("publish failed");
        message.textContent = "Orçamento enviado com sucesso.";
        message.dataset.kind = "success";
        setFeedback("Orçamento enviado com sucesso.", "success");
        await loadQueue();
      } catch {
        const error = priceAuthorized
          ? "Preço autorizado, mas o envio não foi concluído. Não autorize novamente. Verifique o atendimento."
          : "Não foi possível concluir a operação. Verifique sua conexão e tente novamente.";
        message.textContent = error;
        message.dataset.kind = "error";
        setFeedback(error, "error");
      } finally {
        sending = false;
        button.disabled = false;
        button.textContent = "Autorizar e enviar";
      }
    }

    async function loadQueue() {
      if (loading || sending) return;
      loading = true;
      refreshButton.disabled = true;
      const previousKind = feedback.dataset.kind;
      try {
        const response = await fetch("/v1/businesses/" + encodeURIComponent(operator.businessId) + "/quotes/pending");
        if (!response.ok) throw new Error("load failed");
        const data = await response.json();
        const items = Array.isArray(data && data.items) ? data.items : [];
        count.textContent = String(items.length);
        queue.replaceChildren();
        if (items.length === 0) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          const title = document.createElement("strong");
          title.textContent = "Nenhum orçamento aguardando atendimento.";
          empty.append(title);
          queue.append(empty);
        } else {
          const list = document.createElement("div");
          list.className = "quote-list";
          for (const item of items) list.append(makeCard(item));
          queue.append(list);
        }
        if (previousKind === "load-error") setFeedback("", "info");
      } catch {
        setFeedback("Não foi possível carregar os orçamentos.", "load-error");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Tentar novamente";
        retry.addEventListener("click", () => void loadQueue());
        feedback.append(document.createTextNode(" "), retry);
      } finally {
        loading = false;
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", () => void loadQueue());
    void loadQueue();
    window.setInterval(() => {
      if (!sending) void loadQueue();
    }, 30000);
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

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
    .header-inner, main { width: min(1280px, calc(100% - 40px)); margin: 0 auto; }
    .header-inner { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .brand { display: flex; align-items: center; gap: 13px; }
    .brand-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 11px; background: #39b98a; color: #102d3d; font-weight: 800; font-size: 19px; }
    .brand-name { margin: 0; font-size: 18px; letter-spacing: -.03em; }
    .brand-caption { margin: 3px 0 0; color: #c6d5dc; font-size: 12px; }
    .business-name { color: #e3edf0; font-size: 14px; text-align: right; }
    main { padding: 28px 0 42px; }
    .page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: clamp(27px, 4vw, 34px); letter-spacing: -.04em; }
    .subtitle { margin: 8px 0 0; color: #63727d; }
    button { border: 0; border-radius: 9px; padding: 11px 16px; background: #147a5a; color: white; font: inherit; font-weight: 700; cursor: pointer; transition: background .15s ease, transform .15s ease; }
    button:hover:not(:disabled) { background: #0e6348; }
    button:active:not(:disabled) { transform: translateY(1px); }
    button:disabled { cursor: wait; opacity: .65; }
    button:focus-visible, input:focus-visible { outline: 3px solid #f0ae45; outline-offset: 3px; }
    .overview { display: flex; align-items: center; gap: 13px; padding: 13px 16px; margin-bottom: 13px; border: 1px solid #dce5e9; border-radius: 11px; background: #fff; }
    .summary-count { color: #147a5a; font-size: 24px; font-weight: 800; line-height: 1; }
    .summary-label { color: #52616b; font-size: 13px; }
    .feedback { margin: 0 0 14px; padding: 12px 15px; border-radius: 9px; background: #fff2de; color: #754600; font-size: 14px; }
    .feedback[hidden] { display: none; }
    .feedback[data-kind="success"] { background: #e6f7ef; color: #145b3d; }
    .feedback[data-kind="error"] { background: #fff0ee; color: #8a2d25; }
    .workspace { display: grid; grid-template-columns: minmax(275px, 350px) minmax(0, 1fr); gap: 16px; align-items: stretch; min-height: 560px; }
    .queue-panel, .detail-panel { min-width: 0; overflow: hidden; border: 1px solid #dce5e9; border-radius: 13px; background: #fff; box-shadow: 0 3px 12px #19384a0b; }
    .queue-panel { display: flex; flex-direction: column; }
    .panel-heading { margin: 0; padding: 17px 18px 14px; border-bottom: 1px solid #e7edef; color: #52616b; font-size: 12px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
    .quote-list { display: grid; align-content: start; overflow-y: auto; }
    .quote-option { width: 100%; display: block; border: 0; border-radius: 0; border-bottom: 1px solid #edf1f2; padding: 15px 17px; background: #fff; color: #243640; text-align: left; }
    .quote-option:hover { background: #f5faf8; }
    .quote-option[aria-current="true"] { background: #edf7f3; box-shadow: inset 3px 0 #16805e; }
    .option-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .option-customer { margin: 0; font-size: 14px; font-weight: 750; }
    .option-request { display: block; margin-top: 7px; color: #63727d; font-size: 12px; line-height: 1.4; }
    .status { display: inline-flex; flex-shrink: 0; padding: 5px 8px; border-radius: 999px; background: #fff2de; color: #80520d; font-size: 10px; font-weight: 750; }
    .empty-state, .detail-placeholder { display: grid; min-height: 220px; place-items: center; padding: 25px; color: #63727d; text-align: center; }
    .empty-state strong { color: #243640; }
    .detail-panel { display: flex; flex-direction: column; }
    .detail-placeholder { flex: 1; min-height: 500px; font-size: 15px; }
    .detail-content { min-height: 0; display: flex; flex-direction: column; }
    .detail-toolbar { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #e7edef; }
    .back-button { display: none; padding: 8px 10px; background: #eaf1f3; color: #26424e; font-size: 13px; }
    .back-button:hover:not(:disabled) { background: #dce8eb; }
    .detail-title { min-width: 0; flex: 1; margin: 0; font-size: 17px; }
    .detail-status { display: inline-flex; padding: 6px 9px; border-radius: 999px; background: #fff2de; color: #80520d; font-size: 11px; font-weight: 750; }
    .detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 16px 20px; border-bottom: 1px solid #e7edef; }
    .info-block { min-width: 0; padding: 13px; border-radius: 9px; background: #f6f8f9; }
    .info-block h3 { margin: 0 0 10px; color: #52616b; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; }
    .info-value { margin: 5px 0 0; color: #243640; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
    .info-label { color: #71808a; font-size: 11px; }
    .request-block { grid-column: 1 / -1; }
    .history-heading { margin: 0; padding: 15px 20px 10px; font-size: 14px; }
    .history-loading, .history-error, .history-empty { margin: 0; padding: 10px 20px 18px; color: #63727d; font-size: 13px; }
    .history-error { color: #8a2d25; }
    .history-error button { margin-left: 9px; padding: 7px 10px; font-size: 12px; }
    .conversation-history { display: grid; gap: 9px; max-height: 300px; overflow-y: auto; padding: 8px 20px 18px; list-style: none; }
    .message { max-width: 88%; padding: 10px 12px; border: 1px solid #e3e9eb; border-radius: 10px; background: #f5f7f8; }
    .message[data-sender="CUSTOMER"] { justify-self: start; border-left: 3px solid #6f8792; background: #f2f5f6; }
    .message[data-sender="ASSISTANT"] { justify-self: end; border-color: #cce6da; border-right: 3px solid #16805e; background: #eef8f3; }
    .message[data-sender="HUMAN_AGENT"] { justify-self: end; border-right: 3px solid #527aa2; background: #eef3f8; }
    .message[data-sender="SYSTEM"] { justify-self: center; max-width: 96%; border-style: dashed; background: #fafafa; }
    .message-meta { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 5px; color: #61717b; font-size: 10px; font-weight: 700; }
    .message-time { font-weight: 400; white-space: nowrap; }
    .message-content { margin: 0; color: #263943; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
    .action-panel { margin: 0 20px 20px; padding: 16px; border: 1px solid #d7e6df; border-radius: 10px; background: #f3f8f5; }
    .action-panel h3 { margin: 0 0 12px; font-size: 14px; }
    .price-label { display: block; margin-bottom: 7px; color: #44545d; font-size: 13px; font-weight: 650; }
    .price-control { display: flex; align-items: center; max-width: 290px; margin-bottom: 11px; border: 1px solid #b9c9c7; border-radius: 8px; background: #fff; }
    .price-prefix { padding-left: 12px; color: #52616b; }
    input { width: 100%; min-width: 0; border: 0; border-radius: 8px; padding: 10px; color: #17212b; font: inherit; background: transparent; }
    .send-button { min-width: 190px; }
    .action-message { min-height: 20px; margin: 9px 0 0; color: #52616b; font-size: 12px; line-height: 1.5; }
    .action-message[data-kind="error"] { color: #8a2d25; }
    .action-message[data-kind="success"] { color: #145b3d; }
    @media (max-width: 850px) {
      .header-inner, main { width: min(100% - 28px, 680px); }
      .workspace { display: block; min-height: 0; }
      .detail-panel { display: none; }
      body.detail-open > header { display: none; }
      body.detail-open .page-heading, body.detail-open .overview { display: none; }
      body.detail-open main { width: 100%; padding: 0; }
      body.detail-open .feedback { margin: 0; border-radius: 0; }
      body.detail-open .workspace { min-height: 100dvh; }
      body.detail-open .queue-panel { display: none; }
      body.detail-open .detail-panel { display: flex; min-height: 100dvh; border: 0; border-radius: 0; box-shadow: none; }
      body.detail-open .back-button { display: inline-block; }
      body.detail-open .detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      body.detail-open .conversation-history { max-height: none; }
      body.detail-open .detail-content { min-height: 100dvh; }
    }
    @media (max-width: 500px) {
      .header-inner { min-height: 68px; }
      .business-name { max-width: 42%; font-size: 11px; }
      main { padding-top: 22px; }
      .page-heading { align-items: flex-start; flex-direction: column; }
      .page-heading button { width: 100%; }
      .detail-toolbar { padding: 11px 13px; }
      .detail-title { font-size: 15px; }
      .detail-grid, body.detail-open .detail-grid { grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px; }
      .info-block { padding: 10px; }
      .request-block { grid-column: 1 / -1; }
      .history-heading { padding-left: 13px; }
      .conversation-history { padding-right: 13px; padding-left: 13px; }
      .message { max-width: 94%; }
      .action-panel { margin: 0 12px 14px; }
      .send-button { width: 100%; }
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
    <div id="feedback" class="feedback" role="status" aria-live="polite" hidden></div>
    <div class="workspace">
      <aside id="queue-panel" class="queue-panel" aria-label="Fila de orçamentos">
        <div class="overview">
          <span id="queue-count" class="summary-count">—</span>
          <span class="summary-label">solicitações pendentes</span>
        </div>
        <h2 class="panel-heading">Solicitações</h2>
        <div id="queue-list" class="quote-list"></div>
      </aside>
      <section id="detail-panel" class="detail-panel" aria-label="Detalhe do atendimento" aria-live="polite">
        <p id="detail-placeholder" class="detail-placeholder">Selecione um atendimento para ver os detalhes.</p>
      </section>
    </div>
  </main>
  <script>
    "use strict";
    const operator = ${safeConfig};
    const queueList = document.getElementById("queue-list");
    const queueCount = document.getElementById("queue-count");
    const detailPanel = document.getElementById("detail-panel");
    const feedback = document.getElementById("feedback");
    const refreshButton = document.getElementById("refresh-button");
    let items = [];
    let selectedQuoteId = null;
    let selectedQuoteStatus = null;
    let historyRequest = 0;
    let sending = false;
    let loading = false;

    function setFeedback(message, kind) {
      feedback.textContent = message;
      feedback.dataset.kind = kind || "info";
      feedback.hidden = !message;
    }

    function display(value) {
      if (typeof value === "string" && value.trim()) return value;
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return "—";
    }

    function statusLabel(status) {
      if (status === "WAITING_BUSINESS") return "Aguardando orçamento";
      if (status === "WAITING_INFORMATION") return "Aguardando informações do cliente";
      if (status === "REQUESTED") return "Solicitação recebida";
      return "—";
    }

    function senderLabel(senderType) {
      if (senderType === "CUSTOMER") return "Cliente";
      if (senderType === "ASSISTANT") return "Atendente IA";
      if (senderType === "HUMAN_AGENT") return "Atendente";
      if (senderType === "SYSTEM") return "Sistema";
      return "—";
    }

    function dateTime(value) {
      if (typeof value !== "string" || !value) return "—";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
    }

    function addInfo(block, label, value) {
      const line = document.createElement("p");
      line.className = "info-value";
      const labelNode = document.createElement("span");
      labelNode.className = "info-label";
      labelNode.textContent = label + ": ";
      const valueNode = document.createElement("span");
      valueNode.textContent = display(value);
      line.append(labelNode, valueNode);
      block.append(line);
    }

    function makeInfoBlock(title, pairs, className) {
      const block = document.createElement("section");
      block.className = className ? "info-block " + className : "info-block";
      const heading = document.createElement("h3");
      heading.textContent = title;
      block.append(heading);
      for (const [label, value] of pairs) addInfo(block, label, value);
      return block;
    }

    function makeQueueButton(item, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quote-option";
      button.setAttribute("aria-current", item.quote.id === selectedQuoteId ? "true" : "false");
      button.setAttribute("aria-controls", "detail-panel");
      button.id = "quote-option-" + index;
      const top = document.createElement("span");
      top.className = "option-heading";
      const name = document.createElement("span");
      name.className = "option-customer";
      name.textContent = display(item.customer && item.customer.name);
      const status = document.createElement("span");
      status.className = "status";
      status.textContent = statusLabel(item.quote.status);
      top.append(name, status);
      const request = document.createElement("span");
      request.className = "option-request";
      request.textContent = display(item.quote.requestDescription);
      button.append(top, request);
      button.addEventListener("click", () => {
        selectedQuoteId = item.quote.id;
        selectedQuoteStatus = item.quote.status;
        renderQueue();
        renderDetail(item, true);
      });
      return button;
    }

    function renderQueue() {
      queueCount.textContent = String(items.length);
      queueList.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Nenhum orçamento aguardando atendimento.";
        queueList.append(empty);
        return;
      }
      items.forEach((item, index) => queueList.append(makeQueueButton(item, index)));
    }

    function showPlaceholder() {
      detailPanel.replaceChildren();
      const placeholder = document.createElement("p");
      placeholder.id = "detail-placeholder";
      placeholder.className = "detail-placeholder";
      placeholder.textContent = "Selecione um atendimento para ver os detalhes.";
      detailPanel.append(placeholder);
      document.body.classList.remove("detail-open");
    }

    function makeBackButton() {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "back-button";
      button.textContent = "Voltar para orçamentos";
      button.addEventListener("click", () => {
        selectedQuoteId = null;
        selectedQuoteStatus = null;
        showPlaceholder();
        renderQueue();
        const firstOption = queueList.querySelector("button");
        if (firstOption) firstOption.focus();
        else refreshButton.focus();
      });
      return button;
    }

    function makeHistoryMessage(message) {
      const item = document.createElement("li");
      item.className = "message";
      item.dataset.sender = ["CUSTOMER", "ASSISTANT", "HUMAN_AGENT", "SYSTEM"].includes(message.senderType)
        ? message.senderType
        : "SYSTEM";
      const meta = document.createElement("div");
      meta.className = "message-meta";
      const author = document.createElement("span");
      author.textContent = senderLabel(message.senderType);
      const time = document.createElement("time");
      time.className = "message-time";
      time.textContent = dateTime(message.createdAt);
      meta.append(author, time);
      const content = document.createElement("p");
      content.className = "message-content";
      content.textContent = display(message.content);
      item.append(meta, content);
      return item;
    }

    async function loadHistory(item, historyList, historyArea, retryButton) {
      const currentRequest = ++historyRequest;
      historyArea.replaceChildren();
      const loadingMessage = document.createElement("p");
      loadingMessage.className = "history-loading";
      loadingMessage.textContent = "Carregando atendimento...";
      historyArea.append(loadingMessage);
      try {
        const path = "/v1/businesses/" + encodeURIComponent(operator.businessId) +
          "/conversations/" + encodeURIComponent(item.quote.conversationId) + "/messages";
        const response = await fetch(path);
        if (!response.ok) throw new Error("history unavailable");
        const data = await response.json();
        if (currentRequest !== historyRequest || selectedQuoteId !== item.quote.id) return;
        const messages = Array.isArray(data && data.messages) ? data.messages : [];
        historyArea.replaceChildren();
        if (messages.length === 0) {
          const empty = document.createElement("p");
          empty.className = "history-empty";
          empty.textContent = "Nenhuma mensagem registrada.";
          historyArea.append(empty);
        } else {
          for (const message of messages) historyList.append(makeHistoryMessage(message));
          historyArea.append(historyList);
        }
      } catch {
        if (currentRequest !== historyRequest || selectedQuoteId !== item.quote.id) return;
        historyArea.replaceChildren();
        const error = document.createElement("p");
        error.className = "history-error";
        error.setAttribute("role", "alert");
        error.textContent = "Não foi possível carregar o histórico.";
        const retry = retryButton();
        error.append(retry);
        historyArea.append(error);
      }
    }

    function priceToCents(value) {
      const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(value.trim());
      if (!match) return null;
      try {
        const cents = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
        if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        const amount = Number(cents);
        return Number.isSafeInteger(amount) ? amount : null;
      } catch {
        return null;
      }
    }

    async function authorizeAndPublish(item, input, button, message) {
      const amountCents = priceToCents(input.value);
      if (amountCents === null) {
        message.textContent = "Informe um valor válido.";
        message.dataset.kind = "error";
        input.focus();
        return;
      }
      if (sending) return;
      sending = true;
      button.disabled = true;
      button.textContent = "Processando...";
      message.textContent = "Processando...";
      message.dataset.kind = "info";
      let priceAuthorized = false;
      let keepActionDisabled = false;
      let refreshAfterSuccess = false;
      const base = "/v1/businesses/" + encodeURIComponent(operator.businessId) +
        "/quotes/" + encodeURIComponent(item.quote.id);
      try {
        const respond = await fetch(base + "/respond", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountCents, currency: "BRL" }),
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
          body: "{}",
        });
        if (!publish.ok) throw new Error("publish failed");
        setFeedback("Orçamento enviado com sucesso.", "success");
        refreshAfterSuccess = true;
      } catch {
        const error = priceAuthorized
          ? "Preço autorizado, mas o envio não foi concluído. Não autorize novamente. Verifique o atendimento."
          : "Não foi possível concluir a operação. Verifique sua conexão e tente novamente.";
        keepActionDisabled = priceAuthorized;
        message.textContent = error;
        message.dataset.kind = "error";
        setFeedback(error, "error");
      } finally {
        sending = false;
        button.disabled = keepActionDisabled;
        button.textContent = keepActionDisabled ? "Preço autorizado" : "Autorizar e enviar";
      }
      if (refreshAfterSuccess) await loadQueue();
    }

    function renderDetail(item, moveFocus) {
      document.body.classList.add("detail-open");
      const content = document.createElement("div");
      content.className = "detail-content";
      const toolbar = document.createElement("div");
      toolbar.className = "detail-toolbar";
      toolbar.append(makeBackButton());
      const title = document.createElement("h2");
      title.className = "detail-title";
      title.tabIndex = -1;
      title.textContent = display(item.customer && item.customer.name);
      const status = document.createElement("span");
      status.className = "detail-status";
      status.textContent = statusLabel(item.quote.status);
      toolbar.append(title, status);

      const customer = item.customer;
      const vehicle = item.vehicle;
      const grid = document.createElement("div");
      grid.className = "detail-grid";
      grid.append(
        makeInfoBlock("Cliente", [
          ["Nome", customer && customer.name],
          ["Telefone", customer && customer.primaryPhone],
          ["E-mail", customer && customer.email],
        ]),
        makeInfoBlock("Veículo", [
          ["Marca", vehicle && vehicle.brand],
          ["Modelo", vehicle && vehicle.model],
          ["Versão", vehicle && vehicle.version],
          ["Ano", vehicle && vehicle.year],
          ["Placa", vehicle && vehicle.licensePlate],
          ["Quilometragem", vehicle && vehicle.mileage],
        ]),
        makeInfoBlock("Solicitação", [
          ["Descrição", item.quote.requestDescription],
          ["Sintoma", item.quote.symptomDescription],
          ["Status", statusLabel(item.quote.status)],
          ["Data/hora", dateTime(item.quote.requestedAt)],
        ], "request-block"),
      );

      const historyHeading = document.createElement("h3");
      historyHeading.className = "history-heading";
      historyHeading.textContent = "Histórico do atendimento";
      const historyArea = document.createElement("div");
      historyArea.id = "conversation-history";
      const historyList = document.createElement("ol");
      historyList.className = "conversation-history";
      const retryButton = () => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Tentar novamente";
        button.addEventListener("click", () => void loadHistory(item, historyList, historyArea, retryButton));
        return button;
      };

      content.append(toolbar, grid, historyHeading, historyArea);
      if (item.quote.status === "WAITING_BUSINESS") {
        const action = document.createElement("form");
        action.className = "action-panel";
        const actionTitle = document.createElement("h3");
        actionTitle.textContent = "Autorizar valor";
        const inputId = "authorized-price";
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
        const actionMessage = document.createElement("p");
        actionMessage.className = "action-message";
        actionMessage.setAttribute("aria-live", "polite");
        action.append(actionTitle, label, control, submit, actionMessage);
        action.addEventListener("submit", (event) => {
          event.preventDefault();
          void authorizeAndPublish(item, input, submit, actionMessage);
        });
        content.append(action);
      } else if (item.quote.status === "WAITING_INFORMATION" || item.quote.status === "REQUESTED") {
        const statusMessage = document.createElement("p");
        statusMessage.className = "history-empty";
        statusMessage.textContent = statusLabel(item.quote.status);
        content.append(statusMessage);
      }
      detailPanel.replaceChildren(content);
      void loadHistory(item, historyList, historyArea, retryButton);
      if (moveFocus) title.focus({ preventScroll: true });
    }

    async function loadQueue() {
      if (loading || sending) return;
      loading = true;
      refreshButton.disabled = true;
      const previousFeedbackKind = feedback.dataset.kind;
      try {
        const path = "/v1/businesses/" + encodeURIComponent(operator.businessId) + "/quotes/pending";
        const response = await fetch(path);
        if (!response.ok) throw new Error("queue unavailable");
        const data = await response.json();
        items = Array.isArray(data && data.items) ? data.items : [];
        renderQueue();
        const selected = items.find((item) => item.quote.id === selectedQuoteId);
        if (selected) {
          if (selected.quote.status !== selectedQuoteStatus) {
            selectedQuoteStatus = selected.quote.status;
            renderDetail(selected, false);
          }
        } else if (selectedQuoteId !== null) {
          selectedQuoteId = null;
          selectedQuoteStatus = null;
          showPlaceholder();
        }
        if (previousFeedbackKind === "load-error") setFeedback("", "info");
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
    renderQueue();
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

# Motor de orçamento integrado — Fase 6A

O orçamento integrado é habilitado somente para oficinas com assignment `INTERMEDIATE` ou `ADVANCED`. A ausência de assignment nega a capability por padrão.

O núcleo usa `InventoryReadPort` apenas para consulta de estoque e identidade. `ProductPriceReadPort` e `LaborPriceReadPort` são fontes independentes; o LLM não participa da composição financeira. O `QuotePricingEngine` calcula subtotais e total em centavos de BRL, de forma determinística.

`QuoteDraft` e suas linhas preservam snapshot de preço, fonte e horário da consulta. Uma nova composição cria revisão nova e torna a anterior `SUPERSEDED`; drafts `APPROVED` e `PUBLISHED` são imutáveis. O draft é persistido por `businessId` em `quote_drafts` e `quote_draft_lines` pela migration 007.

Os adapters `LocalProductPriceReadAdapter` e `LocalLaborPriceReadAdapter` são exclusivamente para teste/preview. O runtime sem provider produtivo responde `PRICE_UNAVAILABLE`; nenhum fixture é apresentado como integração real.

A criação do draft não publica nem cria outbox. Quantidades financeiras exigem `quantitySource` igual a `OPERATOR_CONFIRMED` ou `WORKSHOP_SYSTEM`; a UI de operador envia a confirmação explícita. Referências do request são apenas expectativas: a identidade usada para precificação vem do estoque consultado, e divergência ou ausência de identidade estável impede o draft.

A revisão é serializada por `QuoteRequest` e protegida por `UNIQUE (business_id, quote_request_id, revision)`. A autorização reutiliza `respondToQuote` dentro de uma transação de persistência que também aprova o draft; falhas revertem `QuoteRequest`, `Opportunity` e `QuoteDraft`. A publicação continua ação separada. Quando o publish registra mensagem/evento/outbox, o draft integrado passa a `PUBLISHED` na mesma transação; esse status não significa entrega concluída. A entrega é representada exclusivamente pelo `OutboundDelivery`. O publish manual continua sem draft.

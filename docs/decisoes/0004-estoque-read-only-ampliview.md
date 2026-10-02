# Estoque read-only na Ampliview

## Auditoria

- `CatalogItem`: parcial. Existe entidade de domínio e repositório em memória, mas não há inventário operacional persistido.
- `stock`/`inventory`: não existe provider ou read model operacional anterior.
- `SKU`/`partNumber`: não existe contrato operacional definido.
- ERP/API de peças/produtos: não existe integração conectada.

## Decisão

A integração foi estruturada como `InventoryReadPort`. A aplicação consulta o port, persiste somente a fotografia da consulta em `StockCheck` e expõe essa fotografia para a oficina e para a Ampliview. A implementação atual usa `LocalInventoryReadAdapter` para fixtures e `UnavailableInventoryReadAdapter` nos runtimes, portanto a integração estrutural está pronta, mas o provider real ainda não está conectado.

`StockCheck` é vinculado ao tenant, atendimento, `QuoteRequest` e, quando disponível, veículo. Não copia o inventário inteiro para a plataforma.

Nenhum fluxo de estoque permite reserva, baixa, entrada, ajuste ou transferência. A consulta não bloqueia nem altera a criação ou publicação de orçamento e não toma decisão comercial automática.

No endpoint `POST /v1/businesses/:businessId/quotes/:quoteRequestId/inventory`, o POST significa executar uma consulta no `InventoryReadPort` e registrar o snapshot em `StockCheck`. Ele não chama operações de escrita do provider, não altera quantidade no estoque e não cria reserva, baixa, ajuste ou transferência. A resposta é somente o snapshot persistido daquela consulta.

O read model administrativo `GET /v1/admin/inventory` agrega consultas por disponibilidade e item, sempre com `businessId` no escopo. A migration incremental `005_stock_checks_read_only.sql` mantém equivalência entre SQLite e PostgreSQL.

## Lacuna para provider real

Ainda será necessário definir o contrato externo de identificação de item, credenciais, disponibilidade, unidade, quantidade e política de atualização com o ERP/API escolhido. Essa etapa não é implementada nesta fase e não usa serviços externos.

# Planos das oficinas e Super Admin Ampliview

`BASIC`, `INTERMEDIATE` e `ADVANCED` são planos contratados pelas oficinas. Eles controlam recursos da experiência da oficina e não representam versões ou permissões do Admin Ampliview.

O Admin Ampliview é um Super Admin global, com autorização própria. Quando autorizado, ele consulta a base consolidada de todas as empresas e pode filtrar os resultados por plano.

`business_plan_assignments` associa uma empresa ao plano atual. A linha ativa contém `business_id`, `plan`, `status`, `started_at`, `updated_at` e `source`. Linhas encerradas preservam histórico de mudanças sem integrar cobrança ou pagamento.

- `BusinessPlanAssignment` representa entitlement contratado pela oficina.
- `SuperAdminAuthorizer` autoriza o acesso global do Admin Ampliview.
- Uso de recurso é uma métrica distinta de entitlement e só deve ser calculado a partir de sinais operacionais persistidos.
- As APIs de plataforma usam filtros backend-side e não escondem dados do Super Admin por causa do plano.

`AutomotiveBusiness` possui apenas endereço textual no modelo atual. Cidade, estado, região e coordenadas estruturadas não estão disponíveis com confiabilidade; por isso a visão de plataforma informa a lacuna e não fabrica mapa ou distribuição geográfica.

A saúde da plataforma usa somente sinais persistidos, como falhas/retries de entrega, `StockCheck` desconhecido/provider indisponível e eventos de saúde do assistente. Não há billing, pagamento, geocoding, previsão ou alteração do fluxo de atendimento nesta decisão.

## Indicadores do Super Admin

- Atendentes ativos: `NOT_AVAILABLE`; não há heartbeat ou evento de presença atual.
- Solicitações pendentes e faixas de idade: dado real de `QuoteRequest.status` e `requested_at`, com relógio injetável.
- Desistências por demora: `NOT_AVAILABLE`; falta motivo persistido de abandono.
- Menor, maior, médio, mediano e total autorizado: dados reais de `QuoteRequest.authorized_price_amount_cents`.
- Segmentos: `NOT_AVAILABLE`; `BusinessType` é tipo operacional e Mercado Mapeado não representa clientes.
- Churn por segmento: `NOT_AVAILABLE`; `ACTIVE` → `ENDED` não prova churn sem `changeType`/`reason`.
- Satisfação: `NOT_AVAILABLE`; não há CSAT, NPS, rating ou feedback persistido.
- Crescimento de atendimentos: calculado com `Conversation.started_at` em períodos equivalentes; período anterior zero retorna `NOT_AVAILABLE`.
- Eficiência de atendimento: `NOT_AVAILABLE`; não há evento confiável para definir solicitação atendida.

Abandono futuro deve persistir um motivo entre `WAIT_TIME`, `PRICE`, `NO_STOCK`, `OTHER` e `UNKNOWN`. Satisfação futura requer um evento ou resposta de CSAT/NPS/rating. Todas as métricas retornam status, fonte e limitação para evitar números implícitos.

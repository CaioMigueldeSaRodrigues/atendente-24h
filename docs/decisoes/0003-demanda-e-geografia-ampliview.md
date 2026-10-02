# 0003 — Demanda operacional e preparação geográfica da Ampliview

## Decisão

O endpoint administrativo `/v1/admin/demand` usa cada `QuoteRequest` como unidade canônica de demanda. Os agregados são:

- serviços: `QuoteRequest.requestDescription`;
- marcas, modelos e anos: `Vehicle` associado ao `QuoteRequest`;
- timeline: `QuoteRequest.requestedAt`, agrupado por dia;
- respondidos e publicados: `CommercialEvent` distinto por `quoteRequestId`, nos eventos `QUOTE_RESPONDED` e `QUOTE_PUBLISHED`.

Uma mesma solicitação não é contada duas vezes quando possui mais de um evento comercial. A normalização textual é limitada a `trim`, colapso de espaços e lowercase para a chave de agrupamento; o primeiro rótulo legível é preservado.

## Geografia

O Mercado Mapeado atual possui região, cluster, bairro e endereço provenientes do levantamento público. Não possui CEP, latitude ou longitude confiáveis. A Fase 3, portanto, apresenta concentração por região/cluster e não um mapa geográfico.

O contrato futuro para localização é:

```ts
type MarketLocation = {
  establishmentId: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  geocodeSource?: string;
  geocodedAt?: string;
  confidence?: number;
};
```

Não há geocoding externo nesta fase. Também não é calculado cruzamento entre demanda e densidade de oficinas porque a demanda operacional não possui localização confiável do cliente.

## Performance

As consultas de demanda filtram `quote_requests.business_id/requested_at`, fazem junção por `quote_requests.vehicle_id` e verificam eventos por `commercial_events.business_id/quote_request_id/event_type/channel`. Índices sugeridos, sem migration nesta fase:

| Consulta | Tabela | Índice sugerido | Motivo |
| --- | --- | --- | --- |
| período e tenant da demanda | `quote_requests` | `(business_id, requested_at)` | reduzir leitura do período solicitado |
| eventos de uma solicitação | `commercial_events` | `(business_id, quote_request_id, event_type, channel)` | acelerar eventos de resposta/publicação e filtro de canal |
| veículo associado | `vehicles` | `(business_id, id)` | junção tenant-scoped já utilizada pela consulta |

## Métrica futura de contratação

Esta fase não calcula contratação, venda ou conversão. Para exibir futuramente “Percentual contratado por serviço”, o domínio precisará registrar um evento explícito e confiável, como `SERVICE_CONTRACTED` ou `SALE_CONFIRMED`, associado à `QuoteRequest`. Até que esse evento exista, a interface usa somente as etapas operacionais solicitada, respondida, publicada e entregue.

# Decisão 0007 — Monitoramento de consumo de IA por oficina

## Contexto

Chamadas a provedores de IA precisam ser auditáveis por oficina, conversa e período,
sem colocar regras de billing dentro do fluxo comercial.

## Decisão

O adaptador LLM recebe um AiUsageRecorder e encaminha para o serviço central
AiUsageMeasurementService o businessId, conversationId, provedor, modelo,
identificador da requisição, usage real e latência. O serviço consulta o preço
vigente em ai_model_prices, calcula custo USD, conversão BRL e markup, e persiste
um evento imutável em ai_usage_events.

Os valores calculados e a versão do preço são gravados no evento para que alterações
posteriores na tabela de preços não mudem o histórico. O endpoint
GET /v1/businesses/:businessId/ai-usage exige a autorização do operador da
oficina e retorna resumo e agregação mensal.

Falhas de persistência de métricas são observáveis e não invalidam uma resposta
válida já obtida do provedor.

## Fora desta decisão

Não há cobrança real, Mercado Pago ou exposição do consumo ao cliente final.

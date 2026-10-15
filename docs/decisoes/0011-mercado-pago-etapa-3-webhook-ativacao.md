# Decisão 0011 — Mercado Pago Etapa 3: webhook e ativação

## Escopo

O endpoint público `POST /v1/payments/mercadopago/webhook` aceita somente notificações necessárias para o billing SaaS: `payment`, `subscription_preapproval` e `subscription_authorized_payment`.

O webhook não é fonte da verdade. Depois da validação HMAC, o sistema consulta o recurso correspondente no Mercado Pago usando o provider server-side. O payload recebido não define tenant, valor, moeda ou aprovação.

## Autenticidade e replay

`MercadoPagoWebhookVerifier` extrai `ts` e `v1` de `x-signature` e monta o manifest oficial com os componentes disponíveis:

`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`

O digest é HMAC-SHA256 com `MERCADO_PAGO_WEBHOOK_SECRET` e é comparado com `timingSafeEqual`. Eventos são registrados em `payment_webhook_events` e claimados atomicamente antes de qualquer efeito. Eventos `PROCESSED` ou `IGNORED` são idempotentes; eventos concorrentes em `PROCESSING` não são processados novamente.

## Correlação e ativação

A correlação exige provider IDs locais, referências esperadas, subscription local, oficina, tipo da transação, valor inteiro em centavos e moeda BRL. `external_reference` isoladamente nunca escolhe o tenant.

O entitlement somente é ativado em uma transação PostgreSQL quando todos os fatos estão confirmados:

- implantação: `approved` + `accredited`, referência `setup:<subscription-id>`, valor e moeda corretos;
- preapproval: `authorized`, provider subscription ID correspondente, catálogo e ciclo corretos;
- primeira cobrança recorrente: pagamento aprovado/accredited, associado à mesma preapproval, referência `subscription:<subscription-id>`, valor e moeda corretos.

A avaliação é executada após cada fato, sem assumir ordem dos webhooks. A atribuição de plano é tenant-scoped e possui fonte determinística por assinatura.

## Recorrência e estados ainda não comerciais

Cada `provider_payment_id` recorrente pode gerar uma transação `SUBSCRIPTION` própria, sem duplicação. Falhas futuras são registradas, mas não revogam entitlement nem iniciam dunning, grace period ou suspensão automática. Estados `paused` e `canceled` são persistidos na assinatura e impedem nova ativação; a política de revogação de plano permanece pendente.

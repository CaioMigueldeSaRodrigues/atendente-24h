# Decisão 0010 — Mercado Pago na etapa 2 do billing

## Decisão

O domínio cria uma intenção local e duas transações independentes antes de acessar o provedor:

- assinatura recorrente em `POST /preapproval`;
- implantação em uma preferência do Checkout Pro, `POST /checkout/preferences`.

O `payment-catalog` resolve plano, ciclo, valores em centavos e moeda. O adapter recebe somente os valores já resolvidos pelo domínio. A recorrência mensal usa frequência `1` em meses; a anual usa frequência `12` em meses.

## Idempotência e segurança

As operações usam chaves distintas derivadas do identificador local: `<subscription-id>:subscription` e `<subscription-id>:setup`. As chaves e as intenções são persistidas antes das chamadas externas. O access token permanece somente no backend e erros do provedor são reduzidos a uma mensagem HTTP sanitizada.

O endpoint autenticado aceita somente `plan` e `billingCycle` no corpo. O e-mail do pagador é resolvido pelo perfil persistido `business_billing_profiles`, vinculado por FK à oficina, nunca pelo corpo público. A criação da intenção mantém a assinatura pendente; ativação por webhook será implementada em etapa posterior.

## Fonte contratual

Os paths e campos de integração foram conferidos na documentação oficial do Mercado Pago em 2026-10-15: [API de Assinaturas](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/overview) e [Checkout Pro Preferences](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/overview).

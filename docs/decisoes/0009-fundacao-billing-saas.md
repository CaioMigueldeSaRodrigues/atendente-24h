# Decisão 0009 — Fundação de billing SaaS por oficina

## Escopo

Esta etapa cria o catálogo server-side de planos, as entidades de intenção de
assinatura, transações e eventos de webhook, além dos repositórios PostgreSQL e
do `MockPaymentProvider`.

O frontend informa somente `plan` e `billingCycle`. Valores monetários são
resolvidos exclusivamente por `payment-catalog.ts` em centavos inteiros.

## Catálogo vigente

- BASIC: R$ 397,00 mensal; R$ 3.970,00 anual; implantação de R$ 490,00.
- INTERMEDIATE: R$ 697,00 mensal; R$ 6.970,00 anual; implantação de R$ 890,00.
- ADVANCED: R$ 1.197,00 mensal; R$ 11.970,00 anual; implantação de R$ 1.490,00.

O ciclo anual é uma cobrança única recorrente a cada 12 meses, equivalente a
dez mensalidades. Não representa doze cobranças mensais com meses gratuitos.

## Persistência e idempotência

A intenção local de assinatura e suas duas transações (`SETUP_FEE` e
`SUBSCRIPTION`) são persistidas antes de qualquer chamada de provider. As
restrições compostas por `business_id` preservam o isolamento entre oficinas.

O `SubscriptionService` reutiliza uma intenção existente quando recebe a mesma
chave de idempotência dentro da mesma oficina. Nenhum entitlement é alterado
durante a criação da intenção; ativação depende de confirmação futura de
pagamento.

## Providers

`PaymentProvider` é um contrato do core. O `MockPaymentProvider` permite validar
o domínio sem rede. O adapter Mercado Pago, chamadas live e processamento real
de webhook permanecem fora desta etapa e não são ativados por configuração
acidental.

O billing de consumo de IA e o provider Groq não fazem parte desta decisão.

# Decisão 0012 — Mercado Pago Etapa 4A: separação e homologação sandbox

## Contexto

O billing SaaS precisa permitir homologação do Mercado Pago sem misturar recursos de teste com produção, sem inferir o ambiente pelo formato do Access Token e sem transformar a homologação em pagamento automático.

## Decisões

### Ambiente explícito

`PAYMENT_MODE` continua aceitando somente `mock` ou `mercadopago`. O modo `mock` não exige credenciais do Mercado Pago. O modo `mercadopago` exige `MERCADO_PAGO_ENVIRONMENT=test|production`, além da configuração necessária do provider.

O ambiente nunca é deduzido do token, inclusive do prefixo `APP_USR`.

### Proteção do webhook

O payload do webhook registra somente campos sanitizados e o hash do payload. Para eventos suportados, o processamento financeiro só prossegue quando:

- `MERCADO_PAGO_ENVIRONMENT=test` e `live_mode=false`; ou
- `MERCADO_PAGO_ENVIRONMENT=production` e `live_mode=true`.

Um mismatch é registrado como `IGNORED` com mensagem sanitizada, sem consulta ao Mercado Pago, alteração de transação ou alteração de entitlement. A ativação continua dependendo exclusivamente de A+B+C: setup confirmado, preapproval autorizado e primeira cobrança recorrente confirmada.

### Oficina dedicada e smoke runner

O comando interno `npm run sandbox:mp-business` prepara a oficina `sandbox-mp-business` e persiste seu billing profile em `business_billing_profiles`. Ele exige `MERCADO_PAGO_ENVIRONMENT=test`, `MERCADO_PAGO_SANDBOX_CONFIRM=YES` e usa `MERCADO_PAGO_TEST_PAYER_EMAIL` somente nesse fluxo interno. Não há endpoint público para preparar a oficina; o endpoint público normal continua aceitando somente plano e ciclo.

O comando `npm run smoke:mercadopago:sandbox` valida a configuração, a oficina e o billing profile e inicia a intenção pelo `SubscriptionService` normal. Ele cria somente o checkout da implantação e o preapproval da assinatura; não realiza pagamento automaticamente. O smoke exige confirmação explícita, ambiente `test`, um `MERCADO_PAGO_SANDBOX_RUN_ID` e usa esse valor como origem de uma chave idempotente estável. O mesmo run id reutiliza a intenção local e os recursos já criados; um novo run id inicia uma nova homologação.

### Dry-run

`MERCADO_PAGO_SANDBOX_DRY_RUN=true` executa as validações de banco/configuração e exibe plano, ciclo e valores esperados sem criar intenção local ou recurso externo e sem chamar o provider.

O runner usa somente o PostgreSQL local de teste: `127.0.0.1:${POSTGRES_TEST_PORT}`, com `POSTGRES_TEST_PORT=55432` por padrão, database `atendente24h_test`, usuário `test_user` e senha de `POSTGRES_TEST_PASSWORD` quando disponível. Nenhum banco de produção é usado pelo smoke ou pelos testes PostgreSQL.

### Conta comprador e URL pública

A homologação real deve usar uma conta comprador dedicada do Mercado Pago, associada ao email persistido no billing profile da oficina de teste. Uma futura execução real exigirá uma URL pública HTTPS apontando para `POST /v1/payments/mercadopago/webhook`. `MERCADO_PAGO_BACK_URL` também deve ser uma URL HTTPS válida e apropriada ao teste.

Para assinaturas, os eventos necessários são `payment`, `subscription_preapproval` e `subscription_authorized_payment`, conforme a [documentação oficial de Webhooks para assinaturas](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/your-integrations/notifications/webhooks). A integração valida `x-signature`/`x-request-id`/`data.id`, confirma o recurso na API server-side e responde `200` após o processamento idempotente. Não foi adicionado `notification_url` ao corpo de `/preapproval`: a [referência oficial de criação da assinatura](https://www.mercadopago.com.br/developers/pt/reference/online-payments/subscriptions/create-preapproval/post) não lista esse campo; a configuração deve seguir o mecanismo oficial disponível para a aplicação e para assinaturas, sem inventar parâmetros.

Não instalar ngrok, Cloudflare Tunnel ou outra dependência automaticamente e não configurar o webhook no painel nesta etapa.

## Consequências

O limite entre test e production é verificável por configuração e por `live_mode`, e uma notificação de ambiente errado não produz efeito financeiro. A homologação manual fica repetível e auditável, mas ainda requer uma URL HTTPS pública, a configuração no painel do Mercado Pago e a conta comprador dedicada.

Nenhuma credencial, token, segredo de webhook ou arquivo `.env` é versionado ou impresso pelo smoke.

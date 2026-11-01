# atendente-24h

Atendente virtual por WhatsApp para oficinas e negócios automotivos. O cliente escreve, uma IA entende o pedido, registra o orçamento ou o agendamento e passa a conversa a uma pessoa quando precisa. A oficina trabalha pelo painel `/operator`: aprova preços, responde encaminhamentos e cuida dos dados da oficina. Uma instância atende uma oficina.

Node 24, TypeScript, `node:http`, Postgres 16. O núcleo (`src/core`) não conhece WhatsApp nem provedor de IA; eles entram por `src/channels` e `src/integrations`.

## Rodar localmente

Precisa de Node 24 e de um Postgres 16. Variáveis em `.env.local` (ignorado pelo git); a lista completa está em [docs/operacao.md](docs/operacao.md).

```bash
npm ci
npm run migrate:postgres   # aplica as migrations (o app também aplica no boot)
npm start                  # lê .env.local; painel em http://127.0.0.1:3000/operator
```

Sem Postgres, `DATABASE_BACKEND=sqlite` sobe um banco em arquivo só para desenvolvimento. Para não gastar chamadas de IA, `GATE3_FAKE_INTERPRETER=true` usa um interpretador de teste (proibido com `NODE_ENV=production`).

## Testar

```bash
npm run typecheck
npm test                 # unidade, sem banco
npm run test:postgres    # integração, precisa de Postgres de teste
npm run test:e2e         # Playwright contra Postgres, cerca de 3 minutos
```

Os testes com banco leem `POSTGRES_TEST_PASSWORD` e `POSTGRES_TEST_PORT` (banco `atendente24h_test`, usuário `test_user`, em 127.0.0.1) e são pulados sem a senha.

## Colocar no ar

`docker compose --env-file .env.production up -d` sobe app, banco e Caddy com HTTPS. Passo a passo, backup, atualização, pedido de exclusão de dados e incidentes: [docs/operacao.md](docs/operacao.md).

## Mais

- Decisões de arquitetura: [docs/decisoes](docs/decisoes), incluindo o [MVP de campo](docs/decisoes/0013-mvp-de-campo.md).
- Gateways de IA e minimização de dados: [Gate 2](docs/decisoes/0003-llm-gateway-minimizacao-dados.md).

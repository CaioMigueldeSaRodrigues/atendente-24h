# Plano de go-live

> Execução fase a fase, cada uma validada antes da próxima. Passos com checkbox para acompanhamento.

## Escopo atual: MVP para teste de campo

Decisão de 01/11/2026: antes de investir no produto completo, validar com uma oficina-piloto. Uma instância por oficina, com cobrança por Pix manual.

**Entra agora:**

- Fase 1 inteira.
- Da Fase 2: perfil da oficina no atendimento, aviso fora do horário, handoff real, contato do cliente e encerramento de conversa inativa.
- Da Fase 5: Dockerfile, compose com Caddy, migrations com trava, `/ready`, log de erros, backup e runbook curto.
- Da Fase 6: aviso de atendimento automatizado e página `/privacidade` em minuta.

**Fica para depois do campo:** Fases 3, 4 e 7, agenda completa, CI, papel de banco sem DDL, exclusão e retenção automáticas. O restante deste documento segue como referência para essa etapa.

**Limitações aceitas no piloto:**

- Basic Auth com senha aleatória de 16 caracteres ou mais, atrás de HTTPS.
- Mercado Pago desligado, com plano atribuído à mão.
- Pedido de exclusão de dados atendido manualmente, conforme o runbook.

**Objetivo:** aplicar os 45 itens do laudo de 01/11/2026 sobre `feature/mercadopago-payments`, na branch `feature/go-live-readiness`.

**Arquitetura:** o núcleo continua em `src/core`, sem fornecedor. Postgres é o único backend de produção; SQLite fica para desenvolvimento e testes unitários. A autenticação continua atrás de `BusinessOperatorAuthorizer`, então Basic Auth só permanece em testes.

**Stack:** Node 24+, TypeScript, `node:http`, `pg`, `zod`, `openai`. Nenhuma dependência nova: crypto, scrypt e fetch vêm do Node.

## Restrições globais

- Sem commit e sem push sem OK explícito.
- Sem dependência nova. Atualizar versão de dependência existente é permitido.
- Migrations novas começam em `021_` e entram na lista de `postgres-migrations.ts`.
- Nunca enviar conteúdo de mensagem, telefone ou token para logs.
- Dinheiro sempre em centavos inteiros.
- Textos ao usuário em pt-BR. Código e identificadores seguem o padrão do arquivo.
- Todo limite numérico fica em constante nomeada, ajustável por env quando variar por cliente.
- Cada fase deixa typecheck, `npm test`, `npm run test:postgres` e `npm run test:e2e` verdes.

## Foco de revisão

Situações que os testes de cada fase precisam cobrir:

1. LLM lento ou fora do ar com várias oficinas ativas: painel responde e cliente recebe texto fixo.
2. Cliente manda mensagem com a conversa em atendimento humano: bot fica calado e operador vê a mensagem.
3. Assinatura vencida ou estornada: nenhuma chamada ao LLM.
4. Credencial ou cookie da oficina A contra qualquer rota da oficina B: 404.
5. Reinício no meio de envio ou de evento de pagamento: nada se perde e nada duplica.

## Fase 1: segurança e robustez do fluxo

Itens 1 a 5, 9, 10, 16 e 38 a 44.

**Arquivos principais:** `basic-plan-http-server.ts`, `process-message.ts`, `response-policy.ts`, `openai-message-interpreter.ts`, `groq-message-interpreter.ts`, `create-message-interpreter.ts`, `llm-environment.ts`, `evolution-go-*`, `ai-interpretation-schema.ts`, novos `src/core/llm-guard.ts`, `src/core/redact-personal-data.ts`, `src/core/outbound-worker.ts`, `migrations/021_row_level_security.sql`.

- [ ] Exigir `isOperatorAuthorized` em `POST .../conversations` e `POST .../messages`.
- [ ] `MAX_MESSAGE_CHARS = 4000`: HTTP responde 400 acima disso; webhook trunca.
- [ ] Dividir `processMessage` em `receiveCustomerMessage` (grava e devolve histórico), interpretação e `applyInterpretation` (aplica o resultado). `processMessage` continua como composição. O webhook faz transação curta, chama o LLM fora de transação e abre outra transação curta para aplicar.
- [ ] Interpretador: timeout de 20 s, `max_output_tokens` 800, janela de 20 mensagens, sem `businessId` nem `conversationId` no contexto, redação de CPF, CNPJ, e-mail, telefone e cartão antes de enviar.
- [ ] `LlmGuard`: limite por remetente (20 mensagens em 5 min), teto diário por oficina (`LLM_DAILY_CALLS_PER_BUSINESS`, padrão 2000). Excedeu: texto fixo, sem LLM.
- [ ] Falha do LLM: mensagem do cliente preservada, texto fixo enviado, handoff `AI_FAILURE` aberto.
- [ ] Áudio, imagem e outros tipos: texto fixo pedindo mensagem escrita, sem LLM.
- [ ] Filtro de saída em `resolveSafeReply`: resposta com preço, percentual, desconto, prazo ou URL vira texto fixo. Limite de 1000 caracteres.
- [ ] `OutboundWorker`: reenvia entregas vencidas e respostas de webhook processadas e não enviadas, com backoff de 1, 5, 30 e 120 min e no máximo 6 tentativas. Ligado no runtime Postgres.
- [ ] Trava de orçamento: mensagem nova não altera pedido com draft pendente ou preço autorizado; corrida resolvida com `UPDATE` condicional. A mensagem de preço cita o item. Deduplicação de publicação por `quoteRequestId`.
- [ ] `021_row_level_security.sql`: RLS em todas as tabelas e `REVOKE` para `anon` e `authenticated` quando existirem. Teste de integração garante que nenhuma tabela fica sem RLS.
- [ ] Headers CSP com nonce e HSTS. Corpo JSON exige `Content-Type: application/json`. `Origin` externa em método de escrita recebe 403.
- [ ] Remover `src/server.ts` e adicionar script `start`. `GATE3_FAKE_INTERPRETER` e `openrouter/free` recusados com `NODE_ENV=production`.
- [ ] Atualizar `zod`; `year` e `mileage` inteiros com faixa. `EvolutionGoTextSender` com timeout de 10 s e HTTPS obrigatório fora de loopback. Webhook responde sem ecoar a mensagem.

**Aceite:** ataques A1 a A6 do pentest recusados; LLM lento com 30 mensagens simultâneas não bloqueia `/health` nem o painel.

## Fase 2: virar atendente

Itens 6 a 8, 35 e 36.

**Arquivos principais:** novos `src/core/business-profile.ts`, `src/core/human-handoff-service.ts`, `src/core/conversation-maintenance.ts`, `migrations/022_business_profiles.sql`, `migrations/023_appointment_schedule.sql`, `basic-plan-operator-ui.ts`.

- [ ] Perfil da oficina: endereço, telefone, horários por dia da semana, serviços, formas de pagamento e observações. API `GET` e `PUT /v1/businesses/:id/profile`, tela no painel, repositórios Postgres e em memória.
- [ ] Interpretador recebe `businessFacts` e data e hora locais, marcados como dados. Fora do horário, a resposta acrescenta o aviso com o próximo horário de abertura.
- [ ] Handoff: em `WAITING_HUMAN` a mensagem é gravada sem LLM e sem resposta. Rotas para listar, assumir, responder pelo painel e devolver ao bot. Um handoff aberto por conversa, com resumo das últimas mensagens. Fila própria no painel. Aviso à oficina no telefone do perfil.
- [ ] Contato: `primaryPhone` vem do JID e o nome do `PushName` ao criar o cliente. O painel mostra o telefone completo.
- [ ] Encerramento: conversa inativa por 24 h vira `CLOSED`, e a próxima mensagem abre outra.
- [ ] Agenda: `scheduled_for`, preferência do cliente extraída pelo LLM, confirmar com data e hora, remarcar e cancelar pelo painel, cancelar por mensagem.

**Aceite:** e2e simula do pedido de humano até a devolução ao bot, com perfil respondendo "abrem sábado?".

## Fase 3: cobrança confiável

Itens 19 a 30.

**Arquivos principais:** `mercado-pago-webhook-service.ts`, `mercado-pago-payment-provider.ts`, `subscription-service.ts`, `payment-catalog.ts`, `postgres-*-repository.ts`, novos `src/core/billing-access.ts`, `src/core/billing-maintenance.ts`, migrations `024` em diante.

- [ ] Normalizar IDs numéricos, aceitar `cancelled`, gravar `started_at` em ISO e correlacionar recorrência pelo preapproval.
- [ ] `current_period_end`, estendido a cada pagamento aprovado. Job de expiração e `PAST_DUE` com carência de 3 dias.
- [ ] `billing-access`: trial de 14 dias ou assinatura em dia. Sem acesso, nenhuma chamada ao LLM e texto fixo ao cliente.
- [ ] Reembolso e chargeback revogam o plano. `PAUSED` volta para `ACTIVE`.
- [ ] `SELECT ... FOR UPDATE` em `saas_subscriptions` na ativação. Evento com lease e `503` em `in_progress`. `fetch` com timeout.
- [ ] Índice único de assinatura viva por oficina, chave de idempotência derivada de oficina, plano e ciclo, cancelamento via `PUT /preapproval`, upgrade cancela a anterior.
- [ ] Preapproval criado só depois do setup aprovado. Preference com `expires`. Uma transação por pagamento.
- [ ] `live_mode` lido do recurso remoto. Tolerância de `ts` no webhook. `PAYMENT_MODE` obrigatório em produção.
- [ ] Perfil de cobrança com CPF ou CNPJ validado e telas de assinar, ver e cancelar no painel.
- [ ] Planos sem provedor disponível saem do catálogo vendável.
- [ ] Teto mensal de IA por plano e alerta de preço ausente. Reconciliação diária com o Mercado Pago. Comprovante em tela e registro para NFS-e manual.

**Aceite:** testes Postgres com IDs numéricos, `cancelled`, eventos paralelos, crash em `PROCESSING`, reembolso, chargeback, renovação recusada e segunda assinatura.

## Fase 4: multi-tenant, login e onboarding

Itens 31 a 34.

**Arquivos principais:** novos `src/core/identity.ts`, `src/core/onboarding.ts`, `src/infrastructure/http/session-business-operator-authorizer.ts`, `src/infrastructure/http/saas-auth-routes.ts`, `src/integrations/email/*`, `src/integrations/secret-box.ts`, migrations em sequência.

- [ ] `operators` com hash scrypt e papel `OWNER` ou `OPERATOR`, `platform_admins`, `sessions` com hash do token, `password_resets`, `invitations`.
- [ ] Cookie `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, 12 h de inatividade. Limite de login por e-mail e IP: 5 falhas em 15 min.
- [ ] `/cadastro` real: cria oficina, dono e trial. `/login`, logout, recuperar senha e convite de operador. E-mail por HTTP com `RESEND_API_KEY`.
- [ ] `business_channels`: instância e token por oficina, cifrados com AES-256-GCM e `APP_ENCRYPTION_KEY`. Webhook e envio resolvem a oficina pelo banco.
- [ ] Um processo atende todas as oficinas. `operator` passa a vir da sessão.
- [ ] Tela de conexão do WhatsApp com instância e token, e teste de conexão.
- [ ] Runtime liga `adminQueryService`, `platformQueryService` e autorizadores reais. `/admin` só para `platform_admins`. Comando CLI cria o primeiro admin.
- [ ] Dashboard da oficina com conversas, orçamentos, conversão e oportunidades recuperadas. Operador marca ganho ou perda. `docs/metricas.md` escrito.

**Aceite:** e2e com duas oficinas no mesmo processo, sem cruzamento de dados por cookie ou webhook.

## Fase 5: operação

Itens 11 a 14.

- [ ] `Dockerfile`, `docker-compose.yml` com Caddy, `.github/workflows/ci.yml` com Postgres 16.
- [ ] Migrations por comando separado, com `pg_advisory_lock` e caminho relativo ao módulo, e não ao `cwd`.
- [ ] `/health` para vida e `/ready` testando o banco. Logger JSON sem PII. Erro 500 registrado com id de requisição. `unhandledRejection` e shutdown com timeout.
- [ ] Papel de banco sem DDL, script de backup, restauração testada e `docs/operacao.md` com runbook e todas as variáveis.

**Aceite:** imagem sobe com compose local, `/ready` responde e backup é restaurado num banco vazio.

## Fase 6: LGPD

Itens 15 a 17.

- [ ] `eraseCustomer` transacional por oficina e rota para o dono. Exportação dos dados do titular.
- [ ] Job de retenção, 24 meses por padrão, ajustável por oficina.
- [ ] Aviso de atendimento automatizado e link de privacidade no primeiro contato.
- [ ] Páginas `/termos` e `/privacidade`, marcadas como minuta para revisão jurídica.
- [ ] Remover as 2 pessoas físicas do mapeamento de Manaus.

**Aceite:** teste confirma que nenhuma tabela mantém dado do titular após a exclusão.

## Fase 7: site, suporte e limpeza

Itens 37 e 45.

- [ ] Página pública em `/` com oferta, planos vendáveis, cadastro e canal de suporte.
- [ ] Remover Supabase morto, `supabase/migrations/` e código sem uso.
- [ ] Separar do servidor HTTP as rotas de webhook, pagamentos, admin e autenticação.
- [ ] Atualizar `README.md` e `docs/api.md`, renumerar a ADR 0003 e registrar ADRs das decisões novas.

**Aceite:** nenhum import morto; README leva de clone a sistema rodando.

## Fase 8: validação final

- [ ] Typecheck, unitários, Postgres e e2e verdes.
- [ ] Pentest repetido nas rotas antigas e novas.
- [ ] Revisão de todo o diff, correção e excesso de engenharia.

## Fora do alcance do código

Dependem de conta, decisão ou profissional externo:

- Conectar e validar Supabase ou Postgres de produção.
- Homologar com Mercado Pago real, com webhook público.
- Testar com número real de WhatsApp e decidir entre Evolution Go e API oficial.
- Revisão jurídica de termos, privacidade e LGPD.
- Emissão automática de NFS-e.

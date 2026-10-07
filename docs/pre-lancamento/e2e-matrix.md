# Gate 1 — frontend, HTTP, core e PostgreSQL real

## Execução

Pré-requisitos: Node compatível com o projeto, dependências instaladas, Chromium do Playwright (`npx playwright install chromium`) e PostgreSQL **16** descartável acessível em loopback. Configurar `POSTGRES_TEST_HOST`, `POSTGRES_TEST_PORT`, `POSTGRES_TEST_DATABASE`, `POSTGRES_TEST_USER` e `POSTGRES_TEST_PASSWORD` no ambiente; não versionar credenciais. Executar `npm run test:e2e` na raiz.

O comando compila e valida o ambiente. Configuração ausente, servidor remoto, PostgreSQL de outra versão ou navegador ausente impedem aprovação; não são convertidos em sucesso ou skip. Nenhum Docker é iniciado ou destruído pelo script. Nunca apontar para Supabase.

Cada cenário cria um schema `gate1_<uuid>`, aplica exatamente 001–007, verifica a segunda execução sem migrations pendentes e remove apenas esse schema no `finally`. O HTTP real escuta em porta aleatória em 127.0.0.1. São usados Basic Auth, autorização por oficina, repositories, transações e outbox reais. As observações de chamadas a repositories delegam todas as operações às implementações PostgreSQL; não substituem persistência por mocks.

Chromium executa desktop (1440×1000) e mobile (390×844, toque). Cenários HTTP de entrada e abuso complementam os percursos completos de browser; não são contados como percursos de UI. Todos os cenários rodam em ambos os projetos. Report JSON em `test-results/gate1-results.json`; falhas também produzem screenshot e trace. Artefatos são locais, ignorados pelo Git, e podem conter dados e credenciais sintéticos da execução.

## Limites explícitos

- OpenAI e Evolution Go não são chamados. Interpreter e sender determinísticos são injetados exclusivamente em `tests/e2e/harness.ts`, com entradas/saídas e tentativas observáveis. O navegador bloqueia destinos externos.
- O runtime produtivo continua sem integração real de estoque/preço/mão de obra. Apenas os cenários integrados deste harness usam providers sintéticos: Óleo 5W30, SKU OIL-5W30, 4 L × R$ 48,00 = R$ 192,00; serviço R$ 90,00; total R$ 282,00.
- Timeout do interpreter é uma rejeição controlada após atraso; não valida timeout de SDK externo. Falha PostgreSQL é uma constraint temporária no schema da execução. Resposta perdida executa a requisição autenticada real e descarta a resposta antes de chegar ao browser.
- Restart fecha HTTP/pool e recria runtime/repositories/estado de idempotência em memória, preservando o schema. Não simula queda de energia nem reinicia o servidor PostgreSQL.
- Garantia de não duplicação é verificada nas falhas, retries e concorrências descritos; não representa entrega exatamente uma vez de um fornecedor externo após resultado ambíguo.

## Matriz

Status refere-se à última execução completa; cada linha representa um cenário parametrizado nos dois viewports. O relatório JSON identifica os resultados individuais.

| ID | Entrada | Pré-condição | Ação do usuário / estímulo | Backend esperado | Persistência esperada | Output esperado | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A01 | Sem senha, senha errada, correta, oficina B | Oficinas A/B; credencial A | HTTP sem/com credencial; abrir e recarregar `/operator` | 401 inválidas; B 404; UI 200 | Nenhuma escrita | Oficina A visível após reload | PASS |
| B01 | Saudação UTF-8, pedido incompleto, nome/veículo/pedido completo | Conversa WEB nova | Criar conversa e enviar mensagens HTTP | GENERAL_INFORMATION e QUOTE_REQUEST; missingData | 6 mensagens; João Açúcar; Corolla XEi 2020; quote WAITING_BUSINESS | Resposta normal exata e progressão dos dados | PASS |
| B02 | Texto vazio; JSON inválido; 950 KB; >1 MiB | Conversa WEB | POST HTTP | 400; 400; 200; 413; excesso não chega ao interpreter | Só entrada/resposta válida persistidas | Sem falha silenciosa | PASS |
| C01 | Token inválido/ausente; instance errada; IsFromMe; imagem; UTF-8 e duplicata | Webhook sintético configurado | Enviar envelopes HTTP | 401 credenciais inválidas; ignorados 202; replay idempotente | Uma entrada e uma resposta para evento válido | Conteúdo persistido idêntico ao sender | PASS |
| C02 | Retry e dois replays concorrentes | Sender inicialmente falha | Reenviar mesmo webhook; enviar evento concorrente | Reutiliza interpretação; concorrência serializada | Receipt processado reutilizado | Uma entrega bem-sucedida por evento | PASS |
| D01-throw | Interpreter lança erro | Banco isolado vazio | Webhook, recuperar adapter, repetir | 500; depois 202 | Rollback de conversa/cliente/veículo/mensagens/quote/link | Nenhum envio antes da recuperação | PASS |
| D01-timeout | Interpreter indisponível após atraso | Banco isolado vazio | Mesmo percurso de recuperação | 500; depois 202 | Mesmo rollback | Sem corrupção; recuperação possível | PASS |
| D02 | Pedido de atendente | Webhook válido | Enviar mensagem | requiresHuman cria handoff | Handoff e resposta | Sender igual à resposta persistida | PASS |
| E01 | Atendimento completo | Quote na fila | Abrir, selecionar, atualizar, reload; voltar no mobile | Histórico e detalhes reais | Dados preservados | Cliente/veículo/pedido corretos, UTF-8, sem overflow e sem ação combinada | PASS |
| F01 | R$ 282,00 manual | BASIC | Browser preencher, Autorizar, reload, Enviar | Etapas separadas; sem inventory | authorizedPrice BRL 28200; Message/event/outbox únicos | Sender exato R$ 282,00 uma vez | PASS |
| F02 | Mesmo valor manual | INTERMEDIATE com opt-in; sem draft | Escolher manual, autorizar, reload, enviar | Caminho manual recuperável | Nenhum draft; publicação única | Mesmo output financeiro | PASS |
| G01 | Duplo clique e duas publicações concorrentes | Manual autorizado no browser | Duplo clique; dois POST concorrentes | Idempotência | Uma Message, QUOTE_PUBLISHED e OutboundDelivery | Uma entrega financeira | PASS |
| G02 | Falha controlada no sender | Manual autorizado | Enviar, observar erro, reload, recuperar sender, retry | 503 e posterior sucesso | FAILED_RETRYABLE → DELIVERED | Mensagem humana; botão habilitado; sem duplicata | PASS |
| G03 | Respostas de authorize/publish perdidas | Quote manual no browser | Autorizar e enviar através de proxy de perda | Requisição real concluída; UI reconcilia sem repetir | Valor e entrega preservados | Próxima ação restaurada; entregue sai da fila após reload | PASS |
| G04 | Respostas integradas de authorize/publish perdidas | Draft exibido no browser | Autorizar; descartar resposta; enviar; descartar resposta | Uma autorização real; nenhuma publicação automática | APPROVED recuperado e depois uma publicação | Erro humano; próxima ação correta; reload sem duplicata | PASS |
| H01 | Credencial A nas rotas de B | Oficinas A/B reais | HTTP conversations/messages/quotes/pending/respond/publish/inventory/draft/authorize | 404 antes de qualquer repository | Nenhuma consulta/escrita no tenant B | Zero chamadas observadas | PASS |
| I01 | Orçamento autorizado e depois entregue | Fluxo manual real | Fechar/recriar runtime; browser publicar; reiniciar novamente | Estado em memória reconstruído | Business/customer/vehicle/conversation/messages/opportunity/quote/events/link e outbox idênticos | Recuperação e publicação idempotente após restart | PASS |
| K01 | Fixture óleo + serviço | INTERMEDIATE, opt-ins, providers sintéticos | Montar, ver linhas, autorizar, reload, enviar | Estoque valida identidade; preço recebe SKU do estoque | PRODUCT/LABOR; OPERATOR_CONFIRMED; total 28200; PUBLISHED | 4 L, R$ 48/L, R$ 192 + R$ 90 = R$ 282 em UI/DB/sender | PASS |
| K02 | Estoque/preço indisponível; quantidade negativa; SKU divergente | ADVANCED com opt-ins | POST inválidos; montar pelo browser com SKU divergente | Erros semânticos; não consulta preço sem estoque | Nenhum draft inválido | Erro humano, botão habilitado | PASS |
| K03 | BASIC com opt-in; INTERMEDIATE opt-out | Quote existente | Tentar draft/inventory e abrir browser | Recusa integração | Nenhuma consulta a provider de estoque/preço | UI manual disponível; zero chamadas | PASS |
| K04 | Rev1 exibida, rev2 efetivamente criada | Draft em revisão | Browser autoriza rev1; reload e autoriza rev2 | 409 QUOTE_DRAFT_STALE; depois 200 | Rev2 continua pendente até autorização correta | Nenhuma aprovação invisível | PASS |
| K05 | 2 produtos + 2 serviços | Draft real com quatro linhas | Abrir browser | Leitura completa | Soma das quatro linhas 56400 | Quatro linhas visíveis e R$ 564,00 | PASS |
| K06 | Sender falha após publicação integrada | Draft autorizado pelo browser | Enviar, restart, reabrir, retry | PUBLISHED não regride; publicação reutilizada | Uma mensagem/evento/outbox; DELIVERED no retry | Sem Autorizar; Enviar recuperável; R$ 282,00 uma vez | PASS |
| K07 | Valor autorizado divergente; PUBLISHED sem outbox | Estado inconsistente injetado apenas no schema do teste | Tentar publicar por HTTP | 409 nos dois casos | Nenhuma Message financeira/event/outbox nova | Nenhum envio financeiro | PASS |
| L01 | PostgreSQL rejeita insert da outbox | Manual autorizado; constraint no schema isolado | Browser enviar; remover constraint; retry | 500 com rollback, depois sucesso | Zero Message financeira/event/outbox parciais | Botão recuperável e uma entrega | PASS |
| L02 | Manual R$ 0,01 versus autorização integrada R$ 282,00 | Draft pendente real | Dois POST concorrentes | Manual 409; integrado 200 sob lock | authorizedPrice = draft.total = 28200 | Nenhuma divergência financeira | PASS |

## Correções encontradas pelo Gate

- O regex de centavos estava dentro de template literal sem escape e rejeitava `282,00` no JavaScript servido. Usa agora classes numéricas explícitas.
- A reconciliação manual era bloqueada pelo próprio indicador de envio; as ações passam a reconciliar explicitamente e mantêm erro humano no feedback global.
- A fila escondia autorização manual sem repository de drafts e conservava itens já entregues quando havia esse repository. Agora considera o estado persistido da entrega; retorna draft/entrega para reconstrução da próxima ação.
- A UI integrada não oferecia retry de PUBLISHED/FAILED_RETRYABLE e o manual escolhido em oficina com opt-in voltava ao formulário integrado após reload. Ambos os percursos são recuperáveis sem redesenho.
- O backend rejeitava retry de um draft PUBLISHED. Agora permite somente reutilizar a publicação persistida; criar publicação exige APPROVED, e a igualdade financeira continua obrigatória em ambos os caminhos.
- Linhas de produto descartavam a unidade retornada pelo estoque. O snapshot e a composição agora preservam a unidade validada pelo provider.

Nenhuma alteração nos adapters produtivos de OpenAI/Evolution nem nas migrations históricas.

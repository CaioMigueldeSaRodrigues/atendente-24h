# Operação do atendente-24h (campo)

Uma instância por oficina, numa máquina com Docker (servidor próprio ou PC), com Docker Compose: `app`, `db` (Postgres 16) e `caddy` (HTTPS automático). O Evolution Go é externo.

Todos os comandos `docker compose` usam o arquivo de variáveis:

```bash
alias dc='docker compose --env-file .env.production'
```

## Variáveis de ambiente

Ficam em `.env.production`, na raiz do projeto no servidor. O arquivo é ignorado pelo git e nunca vai para o compose, para a imagem ou para o chat. Um `KEY=valor` por linha, sem aspas.

| Variável | Obrigatória | Padrão | Para quê |
| --- | --- | --- | --- |
| `DOMAIN` | sim | | Nome público (`atendente.exemplo.com.br`). O Caddy pede o certificado sozinho; o DNS precisa já apontar para o servidor. Para teste local: `http://localhost`. |
| `PUBLIC_ORIGIN` | sim | | `https://` + `DOMAIN`. Limita o painel a esse site e vira o link de privacidade enviado ao cliente (`PUBLIC_ORIGIN/privacidade`). |
| `PRIVACY_CONTACT` | sim | | E-mail ou telefone que a página `/privacidade` mostra ao titular dos dados. |
| `BASIC_PLAN_BUSINESS_ID` | sim | | Identificador da oficina (texto estável, ex.: `oficina-silva`). Não muda depois. |
| `BASIC_PLAN_BUSINESS_NAME` | sim | | Nome que aparece no painel e na identificação do assistente. |
| `BASIC_PLAN_BUSINESS_TYPE` | sim | | Um de: `WORKSHOP`, `AUTO_CENTER`, `AUTO_GLASS`, `WINDOW_TINT`, `LIGHTING`, `BATTERY`, `TIRES_WHEELS`, `AUTO_ELECTRICAL`, `AIR_CONDITIONING`, `ACCESSORIES`, `DETAILING`, `BODYWORK_PAINT`, `OTHER`. |
| `BASIC_PLAN_TIMEZONE` | não | `America/Sao_Paulo` | Fuso do horário de atendimento (Manaus: `America/Manaus`). |
| `BASIC_PLAN_OPERATOR_USERNAME` | sim | | Usuário do painel `/operator` (sem `:`). |
| `BASIC_PLAN_OPERATOR_PASSWORD` | sim | | Senha do painel, 16 caracteres ou mais, aleatória. |
| `PGUSER`, `PGPASSWORD`, `PGDATABASE` | sim | | Banco. O compose cria o banco com esses valores e o app conecta com eles. `PGHOST`, `PGPORT` e `POSTGRES_ALLOW_INSECURE_LOCAL` o compose já define (rede interna `db`, sem TLS). |
| `LLM_PROVIDER` | sim | | `openai`, `openrouter` ou `groq`. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | com `openai` | | Chave e modelo. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | com `openrouter` | | Chave e modelo. `openrouter/free` é recusado em produção. `OPENROUTER_HTTP_REFERER` e `OPENROUTER_APP_NAME` são opcionais. |
| `GROQ_API_KEY`, `GROQ_MODEL` | com `groq` | | Chave e modelo. |
| `LLM_DAILY_CALLS_PER_BUSINESS` | não | `2000` | Teto de chamadas ao modelo por oficina em 24 h. Acima dele o cliente recebe o texto fixo de limite e nada é cobrado do provedor. |
| `AI_BILLING_MARKUP_MULTIPLIER`, `AI_USD_BRL_RATE` | não | `1`, sem cotação | Apuração de custo de IA. No piloto, deixar vazios. |
| `EVOLUTION_GO_BASE_URL` | com Evolution | | URL da API do Evolution Go (`https://...`). |
| `EVOLUTION_GO_INSTANCE_NAME`, `EVOLUTION_GO_INSTANCE_TOKEN` | com Evolution | | Instância e token. As três variáveis do Evolution vêm juntas; sem elas o WhatsApp fica desligado. |
| `PAYMENT_MODE` | não | `mock` | No piloto fica `mock` (Pix manual). `mercadopago` exige `MERCADO_PAGO_ENVIRONMENT`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` e `MERCADO_PAGO_BACK_URL`. |
| `NODE_ENV`, `HOST`, `PORT` | não | `production`, `0.0.0.0`, `3000` | A imagem já define. `GATE3_FAKE_INTERPRETER` é proibido em produção. |
| `BACKUP_DIR` | no backup | | Pasta dos dumps. Vai na linha do cron, não no `.env.production`. |

Gerar uma senha: `openssl rand -hex 16`. Para o banco, gere uma vez e use o mesmo valor em `PGPASSWORD`.

`BASIC_PLAN_BUSINESS_NAME`, `BASIC_PLAN_BUSINESS_TYPE` e `BASIC_PLAN_TIMEZONE` ficam gravados no banco no primeiro boot. Mudar qualquer um deles só no `.env.production` faz o app parar na subida com `Configured business does not match the existing business`. Para mudar: alterar o `.env.production` e rodar o `UPDATE` antes do `dc up -d`, com os mesmos valores:

```bash
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
UPDATE automotive_businesses SET name = 'Oficina Silva', business_type = 'WORKSHOP', timezone = 'America/Manaus' WHERE id = 'oficina-silva';
SQL
```

## Subir do zero em um servidor

1. Servidor Ubuntu com Docker e o plugin Compose. Portas 80 e 443 abertas; o banco não publica porta nenhuma.
2. DNS: registro `A` de `DOMAIN` apontando para o servidor.
3. Código: `git clone <repositório> /opt/atendente-24h && cd /opt/atendente-24h` (branch combinada).
4. Criar `.env.production` com a tabela acima e `chmod 600 .env.production`.
5. `dc build && dc up -d`. As migrations rodam no boot do app, com trava (`pg_advisory_lock`): duas subidas juntas não aplicam a mesma duas vezes.
6. Conferir: `dc ps` (app `healthy`), `curl https://DOMAIN/health` e `curl https://DOMAIN/ready` com `{"status":"ok"}`, e `https://DOMAIN/operator` pedindo usuário e senha.
7. Agendar o backup (seção abaixo) e fazer a primeira restauração de teste.

## Atribuir plano manualmente

O Mercado Pago fica desligado no piloto; o plano é atribuído com SQL. Planos: `BASIC`, `INTERMEDIATE`, `ADVANCED`. Só um plano `ACTIVE` por oficina.

```bash
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
UPDATE business_plan_assignments SET status = 'ENDED', updated_at = now() WHERE business_id = 'oficina-silva' AND status = 'ACTIVE';
INSERT INTO business_plan_assignments (id, business_id, plan, status, started_at, updated_at, source)
VALUES ('plan-' || gen_random_uuid(), 'oficina-silva', 'BASIC', 'ACTIVE', now(), now(), 'manual');
SQL
```

## Conectar o Evolution Go

1. No Evolution Go, criar a instância da oficina e ler o QR code com o WhatsApp do número de atendimento.
2. Colocar `EVOLUTION_GO_BASE_URL`, `EVOLUTION_GO_INSTANCE_NAME` e `EVOLUTION_GO_INSTANCE_TOKEN` no `.env.production` e `dc up -d` (o app recria).
3. Configurar o webhook da instância para `https://DOMAIN/v1/channels/whatsapp/evolution-go/webhook`, evento de mensagens e de recibos. O app reconhece a instância pelo `instanceName` e `instanceToken` que o Evolution envia no corpo.
4. No painel `/operator`, em "Dados da oficina", preencher horário, serviços e o WhatsApp para avisos (`notifyPhone`: é para onde vai o aviso "cliente aguardando atendimento humano"). O Evolution resolve esse número sozinho (nono dígito incluído). Ao cadastrar ou trocar o número, testar: de outro celular, pedir um atendente e conferir que o aviso chegou. Se não chegar, o log traz `Handoff notice failed`.
5. Mandar uma mensagem de outro número: a primeira resposta começa com a identificação como assistente virtual e o link de privacidade.

## Atualizar a versão

```bash
cd /opt/atendente-24h
BACKUP_DIR=/var/backups/atendente bash scripts/backup.sh && git pull && dc build && dc up -d
dc ps && curl -s https://DOMAIN/ready
```

O backup vem antes de qualquer mudança: se ele falhar, nada mais roda. As migrations novas rodam no boot. Se o app não ficar `healthy`: `dc logs app --tail 50`. Para voltar: `git checkout <commit anterior>`, `dc build && dc up -d`. Migration já aplicada não é desfeita; se for o caso, restaurar o backup (abaixo).

## Backup e restauração

`scripts/backup.sh` faz `pg_dump` compactado em `BACKUP_DIR` (`atendente-AAAAMMDDTHHMMSSZ.sql.gz`), grava o arquivo só quando termina e apaga os com mais de 14 dias. Dar `chmod +x scripts/backup.sh` no servidor ou chamar com `bash`. Cron do host, todo dia às 3 h:

```cron
0 3 * * * BACKUP_DIR=/var/backups/atendente /bin/bash /opt/atendente-24h/scripts/backup.sh >> /var/log/atendente-backup.log 2>&1
```

Teste mensal, num banco à parte, sem parar o app:

```bash
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE restore_check"'
gunzip -c /var/backups/atendente/atendente-<data>.sql.gz | dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -v ON_ERROR_STOP=1 -q'
echo "select count(*) from pg_tables where schemaname = 'public'" | dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -tA'
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE restore_check"'
```

A contagem de tabelas tem que bater com a do banco em uso.

Recuperar de verdade apaga o banco em uso, e o que entrou depois do backup se perde. Parar o app, recriar o banco, restaurar e subir:

```bash
dc stop app
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\""'
gunzip -c /var/backups/atendente/atendente-<data>.sql.gz | dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'
dc start app
dc ps && curl -s https://DOMAIN/ready
```

O backup fica no mesmo servidor: copiar `BACKUP_DIR` para fora dele (outro servidor ou armazenamento) é parte do piloto, não dá para pular.

## Atender pedido de exclusão (LGPD)

1. Achar o cliente pelos 8 últimos dígitos do telefone (sem máscara: o nono dígito pode ou não estar gravado):

```bash
echo "select id, name, primary_phone from customers where business_id = 'oficina-silva' and primary_phone like '%99991234'" | dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Cliente com número oculto (JID `@lid`) não tem telefone gravado. Buscar pelo nome e confirmar com a pessoa pela conversa:

```bash
echo "select id, name, primary_phone from customers where business_id = 'oficina-silva' and name ilike '%maria%'" | dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

2. Apagar, em uma transação:

```bash
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v business_id=oficina-silva -v customer_id=customer-...' < scripts/erase-customer.sql
```

O script apaga cliente, veículos, conversas, mensagens, orçamentos, agendamentos, encaminhamentos e entregas dele. Eventos comerciais e de uso de IA ficam sem vínculo com a pessoa (só contam valor e demanda). Os recibos de webhook ficam sem telefone nem texto. Os backups guardam o dado até o rodízio de 14 dias: responder ao titular com essa data.

3. Anotar a data do atendimento e responder ao titular pelo canal que ele usou.

## Smoke real antes do piloto

Exige chave de LLM e número de WhatsApp reais. Rodar nesta ordem, no servidor do piloto:

1. `dc exec app node dist/integrations/llm/run-live-smoke.js`: o modelo escolhido responde dentro do contrato. (`npm run test:llm:live` só funciona fora do container, porque compila com `tsc`.)
2. Do celular de teste, mandar uma mensagem de texto para o número de atendimento: a resposta chega e a primeira traz o aviso de privacidade.
3. Repetir pelo WhatsApp Web do mesmo celular: a conversa continua a mesma, sem cliente novo no painel.
4. Mandar um áudio e uma foto: cada um recebe o texto de "só consigo ler mensagens de texto".
5. Pedir um atendente: a conversa entra em "Atendimento humano" e o bot para de responder.
6. Conferir o aviso em `notifyPhone`; assumir no painel, escrever de novo pelo celular e conferir o segundo aviso.

## O que olhar em incidente

Os logs são uma linha JSON por evento (`level`, `event`, `time` e campos seguros), sem texto de mensagem, telefone ou token: `dc logs app --since 1h`.

| Sintoma | Onde olhar |
| --- | --- |
| Cliente não recebe resposta | `curl https://DOMAIN/ready`. Se 503: `dc ps` e `dc logs db`. Se 200: eventos `LLM failed`, `LLM limit reached` (por remetente: 20 mensagens em 5 min e 200 em 24 h) e `Evolution send accepted` nos logs; o Evolution Go (instância conectada?). |
| Envio falhando | Cada falha gera `Evolution send failed`, sem texto nem telefone. O envio é repetido em 1, 5, 30, 120 e 120 min; na sexta falha a conversa abre um encaminhamento (`INTEGRATION_FAILURE`) e aparece no painel, em "Atendimento humano". Olhar a instância no Evolution Go. |
| Erro 500 | O log `HTTP 500` traz `requestId` (o mesmo vai no cabeçalho `X-Request-Id` da resposta), `method`, `route` com os ids trocados por `:id`, `errorName` e `errorCode`. Procurar: `dc logs app \| grep <requestId>`. |
| `Postgres pool error` | O `errorCode` é o código do Postgres ou da rede (`ECONNREFUSED`, `57P01`). Banco reiniciando ou fora do ar. |
| App reiniciando | `dc ps` e `dc logs app --tail 100`: `Startup failed` (variável faltando; a mensagem sai também em texto), `Unhandled rejection`, `Uncaught exception` (o processo sai com código 1 e o Docker o sobe de novo). |
| Cliente esperando uma pessoa | Painel, "Atendimento humano". Sem ninguém assumir em 12 h, ou assumida e sem mensagem humana há 24 h, o assistente pede ao cliente que repita o que precisa e a conversa volta para ele; esse texto só sai com a oficina aberta (sem horários cadastrados, sai a qualquer hora). Cliente que escreve em conversa assumida gera aviso no `notifyPhone`, no máximo um a cada 30 min por conversa. Depois que a conversa voltou, o painel recusa a resposta: falar com o cliente pelo WhatsApp da oficina. |
| Cliente respondeu ao orçamento | A primeira mensagem do cliente com orçamento entregue e sem agendamento ativo abre encaminhamento, uma vez por orçamento. Depois que a conversa volta ao bot, ele responde normalmente. A conversa com orçamento respondido não fecha por inatividade nos 7 dias seguintes. |
| Disco | `df -h`, `docker system df`, tamanho de `BACKUP_DIR`. |

Parada ordenada: `dc stop app` (até 10 s para terminar o que está em curso; o worker de envio para primeiro). Banco e volume ficam. Nunca usar `dc down -v` em produção: `-v` apaga o volume do banco.

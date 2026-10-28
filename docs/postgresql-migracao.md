# PostgreSQL/Supabase: configuração e ativação

Copie `.env.example` para `.env.local` e preencha os valores locais. `.env.local` é ignorado pelo Git. A conexão remota não é testada nem migrada automaticamente durante esta tarefa.

## Variáveis

- `DATABASE_BACKEND`: obrigatório, `sqlite` ou `postgres`.
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`: configuração libpq para o Session pooler. Os valores de host, porta, database e user de referência estão no `.env.example`; configure a senha apenas em sua máquina.
- `POSTGRES_TEST_PORT`: porta TCP local publicada pelo PostgreSQL descartável dos testes e do sandbox; padrão `55432`, podendo ser alterada quando essa porta estiver indisponível.
- `POSTGRES_TEST_PASSWORD`: senha do usuário `test_user` no PostgreSQL descartável local; mantenha-a somente no ambiente da máquina.
- `BASIC_PLAN_BUSINESS_ID`, `BASIC_PLAN_BUSINESS_NAME`, `BASIC_PLAN_BUSINESS_TYPE`, `BASIC_PLAN_TIMEZONE`, `BASIC_PLAN_OPERATOR_USERNAME`, `BASIC_PLAN_OPERATOR_PASSWORD`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `HOST`, `PORT`: configuração usual do runtime. As credenciais do operador são obrigatórias, a senha deve ter ao menos 16 caracteres e ambas devem ser fornecidas apenas pelo ambiente.
- `POSTGRES_ALLOW_INSECURE_LOCAL=true`: opção exclusiva para desenvolvimento e homologação local em loopback, inclusive o startup do sandbox. O cliente rejeita essa opção para qualquer host não loopback. Não a configure para Supabase ou outros bancos remotos.

O modo PostgreSQL exige TLS com validação do certificado e hostname. Não existe opção de desativar a validação para o Supabase.

## Comandos no destino escolhido

No PowerShell, na raiz do projeto:

```powershell
npm run check:postgres
npm run migrate:postgres
npm run start:basic
```

`check:postgres` executa uma consulta simples e confirma TLS. `migrate:postgres` compila e aplica apenas migrações ainda ausentes. O runtime também aplica migrações pendentes no startup. Nenhum comando toca no banco externo do Evolution Go.

## Transferir os dados SQLite do Atendente

Faça primeiro um backup do arquivo SQLite e mantenha-o intacto. Depois das migrações:

```powershell
npm run transfer:postgres -- .\data\atendente.db
```

A ferramenta abre o arquivo SQLite em modo somente leitura e usa um snapshot de leitura. Ela insere registros em transações por tabela, nunca apaga dados no destino e ignora conflitos de chave. Confira contagens e conflitos antes de apontar o runtime para PostgreSQL. Passe somente o arquivo SQLite do Atendente; a ferramenta rejeita arquivos sem a tabela `automotive_businesses`.

## Teste em PostgreSQL local descartável

O teste de integração requer um servidor PostgreSQL local. Exemplo PowerShell:

```powershell
$testPassword = 'local-disposable-test'
docker run -d --name atendente-mp-sandbox-pg16 `
  -e POSTGRES_DB=atendente24h_test `
  -e POSTGRES_USER=test_user `
  -e POSTGRES_PASSWORD=$testPassword `
  -p 127.0.0.1:15432:5432 postgres:16-alpine
$env:POSTGRES_TEST_PORT = '15432'
$env:POSTGRES_TEST_PASSWORD = $testPassword
$env:POSTGRES_ALLOW_INSECURE_LOCAL = 'true'
npm run test:postgres
npm run sandbox:mp-business
npm run smoke:mercadopago:sandbox
```

O contêiner é isolado em loopback, usa o banco `atendente24h_test`, o usuário `test_user` e a porta `15432`, sem apagar contêineres existentes. O comando de teste executa migrations, transferência SQLite, persistência dos repositórios e resolução concorrente do vínculo. A preparação da oficina exige `MERCADO_PAGO_ENVIRONMENT=test`, `MERCADO_PAGO_SANDBOX_CONFIRM=YES` e `MERCADO_PAGO_TEST_PAYER_EMAIL`; para o smoke local, use também `PAYMENT_MODE=mercadopago`, `MERCADO_PAGO_SANDBOX_RUN_ID` e `MERCADO_PAGO_SANDBOX_DRY_RUN=true`. Não reutilize a senha descartável fora do contêiner local.

## Limites antes de ativar

- A migração e os repositórios foram exercitados somente contra PostgreSQL local descartável; não houve conexão ao Supabase.
- Faça backup e reconcilie contagens e chaves duplicadas antes de transferir dados reais. Linhas em conflito são mantidas no PostgreSQL e não sobrescritas.
- Teste no projeto Supabase as permissões do usuário de pooler e a política de acesso esperada. O cliente usa conexão direta PostgreSQL e as tabelas/migrações não criam políticas RLS.
- Appointments e handoffs são persistidos em PostgreSQL, mas continuam em memória no runtime SQLite atual.
- A cobertura do teste multiprocesso SQLite tem histórico instável no Windows e a tolerância `EPERM` só trata limpeza temporária; consulte a ADR 0002.

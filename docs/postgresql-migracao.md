# PostgreSQL/Supabase: configuração e ativação

Copie `.env.example` para `.env.local` e preencha os valores locais. `.env.local` é ignorado pelo Git. A conexão remota não é testada nem migrada automaticamente durante esta tarefa.

## Variáveis

- `DATABASE_BACKEND`: obrigatório, `sqlite` ou `postgres`.
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`: configuração libpq para o Session pooler. Os valores de host, porta, database e user de referência estão no `.env.example`; configure a senha apenas em sua máquina.
- `BASIC_PLAN_BUSINESS_ID`, `BASIC_PLAN_BUSINESS_NAME`, `BASIC_PLAN_BUSINESS_TYPE`, `BASIC_PLAN_TIMEZONE`, `BASIC_PLAN_OPERATOR_USERNAME`, `BASIC_PLAN_OPERATOR_PASSWORD`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `HOST`, `PORT`: configuração usual do runtime. As credenciais do operador são obrigatórias, a senha deve ter ao menos 16 caracteres e ambas devem ser fornecidas apenas pelo ambiente.
- `POSTGRES_ALLOW_INSECURE_LOCAL=true`: opção exclusiva para testes de loopback local. O cliente rejeita essa opção para qualquer host não loopback. Não a configure para Supabase.

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
docker run --rm -d --name atendente-postgres-migration-test -e POSTGRES_PASSWORD=local-disposable-test -p 127.0.0.1:55432:5432 postgres:16-alpine
$env:POSTGRES_TEST_PASSWORD = 'local-disposable-test'
$env:POSTGRES_ALLOW_INSECURE_LOCAL = 'true'
npm run test:postgres
docker stop atendente-postgres-migration-test
```

Essas credenciais são apenas para o contêiner temporário em loopback. O comando de teste executa migrations, transferência SQLite, persistência dos repositórios e resolução concorrente do vínculo. Não reutilize essa senha fora do contêiner descartável.

## Limites antes de ativar

- A migração e os repositórios foram exercitados somente contra PostgreSQL local descartável; não houve conexão ao Supabase.
- Faça backup e reconcilie contagens e chaves duplicadas antes de transferir dados reais. Linhas em conflito são mantidas no PostgreSQL e não sobrescritas.
- Teste no projeto Supabase as permissões do usuário de pooler e a política de acesso esperada. O cliente usa conexão direta PostgreSQL e as tabelas/migrações não criam políticas RLS.
- Appointments e handoffs são persistidos em PostgreSQL, mas continuam em memória no runtime SQLite atual.
- A cobertura do teste multiprocesso SQLite tem histórico instável no Windows e a tolerância `EPERM` só trata limpeza temporária; consulte a ADR 0002.

# ADR 0002 — Migração gradual para PostgreSQL/Supabase

## Status

Aceita.

## Decisão

SQLite permanece suportado. O runtime seleciona a persistência explicitamente por `DATABASE_BACKEND=sqlite|postgres`; não há fallback automático. PostgreSQL é acessado pelo driver `pg`, usando o Session pooler do Supabase como conexão PostgreSQL e TLS com validação de cadeia e hostname habilitada.

As migrações ficam em `migrations/`, são versionadas e registradas em `schema_migrations`. Os repositórios PostgreSQL implementam os contratos do core; a transação do vínculo Evolution Go mantém o mesmo `PoolClient` disponível via contexto assíncrono para os demais repositórios chamados dentro da operação. A resolução obtém `pg_advisory_xact_lock` a partir de uma chave determinística de business, instância e remetente, mantendo a exclusão por remetente até `COMMIT` ou `ROLLBACK`.

A ferramenta de transferência lê somente um arquivo SQLite do Atendente e insere dados ausentes no destino. Em conflitos, preserva a linha existente no destino. Ela não conecta nem executa operações no banco/serviço independente do Evolution Go.

## Consequências

- A escolha do armazenamento é explícita e reversível na configuração do runtime.
- PostgreSQL exige variáveis próprias e não aceita TLS sem verificação no modo normal.
- A transferência é aditiva, pode ser retomada após falhas, e não substitui reconciliação de conflitos.
- Agendamentos e handoffs passam a ter repositórios PostgreSQL; no SQLite esses dados continuam em memória, conforme a implementação atual.

## Estado observado no teste SQLite multiprocesso

O teste independente de processos teve execuções instáveis no Windows. Uma execução falhou com `EPERM` ao remover a pasta temporária que continha arquivos WAL, embora as verificações funcionais tivessem chegado à limpeza. Uma execução seguinte também reportou saída de worker com código 1; a execução isolada passou e a execução completa posterior passou. O teste tolera `EPERM` especificamente durante a remoção da pasta temporária. Essa tolerância evita falhar somente pela limpeza do artefato e **não demonstra que a instabilidade do teste foi corrigida**. A estabilidade deve ser reavaliada em CI e em versões/plataformas Windows suportadas.

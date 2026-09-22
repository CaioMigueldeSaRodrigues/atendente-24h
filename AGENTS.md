# AGENTS.md

## Papel dos agentes

Os agentes de programação atuam como executores técnicos deste projeto.

Decisões de produto, arquitetura, escopo e regras de negócio são definidas externamente e documentadas em /docs.

Um agente não deve ampliar o escopo nem alterar decisões arquiteturais por iniciativa própria.

## Antes de implementar qualquer tarefa

Leia os documentos relevantes em /docs.

Como regra geral, consulte:

- docs/produto.md
- docs/arquitetura.md
- docs/regras-negocio.md

Quando aplicável, consulte também:

- docs/fluxo-atendimento.md
- docs/modelo-dados.md
- docs/api.md
- docs/metricas.md

## Regras obrigatórias

1. Não alterar arquitetura sem instrução explícita.
2. Não adicionar dependências sem autorização.
3. Não ampliar o escopo da tarefa.
4. Não criar funcionalidades não solicitadas.
5. Nunca inserir credenciais, tokens ou chaves no código.
6. Nunca versionar arquivos .env.
7. Manter alterações pequenas e revisáveis.
8. Criar ou atualizar testes quando houver implementação de código.
9. Não fazer commit sem autorização explícita.
10. Não fazer push sem autorização explícita.
11. Se houver ambiguidade relevante, parar e perguntar.
12. Priorizar código simples, legível e testável.
13. Manter o núcleo de negócio independente dos canais de atendimento.
14. Integrações externas não devem contaminar a lógica central do produto.

## Estrutura arquitetural

src/core/
Contém regras e lógica central do produto.
Não deve depender diretamente de WhatsApp, telefonia, OpenAI ou outros fornecedores.

src/channels/
Contém adaptadores dos canais de atendimento, como WhatsApp, voz e web.

src/integrations/
Contém integrações com serviços externos, APIs, CRMs, agendas e provedores.

src/config/
Contém configurações não sensíveis e carregamento de configuração.

tests/unit/
Testes isolados da lógica de negócio.

tests/integration/
Testes que envolvem mais de um componente ou integração.

## Documentação

Decisões relevantes de arquitetura devem ser registradas em docs/decisoes.

A documentação é parte do produto e deve acompanhar mudanças relevantes na implementação.

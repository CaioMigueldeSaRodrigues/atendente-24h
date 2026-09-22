# ADR 0001 — Stack e estratégia inicial do MVP

## Status

Aceita.

## Contexto

O Atendente Automotivo 24/7 precisa validar primeiro seu núcleo comercial antes da implementação de canais reais, voz, WhatsApp ou infraestrutura complexa.

O produto deverá permanecer independente de fornecedores específicos de IA, canais e persistência.

## Decisão

A implementação inicial utilizará:

- Node.js 24;
- TypeScript;
- npm;
- Fastify para transporte HTTP;
- Zod para validação nas fronteiras da aplicação;
- node:test e assert/strict para testes;
- SDK oficial da OpenAI somente quando a integração de IA for implementada.

A primeira persistência será em memória.

Nenhum banco de dados será instalado na primeira implementação do core.

A primeira versão do domínio deverá funcionar e ser testada sem:

- OpenAI;
- servidor HTTP;
- WhatsApp;
- telefonia;
- banco de dados externo.

O desenvolvimento seguirá esta ordem:

1. tipos e enums do domínio;
2. entidades e contratos;
3. repositórios em memória;
4. regras determinísticas;
5. testes unitários;
6. motor textual com interpretação falsa;
7. integração OpenAI;
8. API HTTP;
9. persistência real;
10. canais comerciais.

## Consequências

### Positivas

- testes rápidos;
- baixo custo de desenvolvimento;
- menor acoplamento;
- facilidade para substituir fornecedores;
- regras comerciais podem ser validadas independentemente da IA;
- erros de integração não comprometem o domínio.

### Negativas

- a primeira versão não persistirá dados após reinicialização;
- a experiência inicial não representará ainda o produto comercial completo;
- algumas integrações precisarão de adapters posteriores.

Essas limitações são deliberadas.

## Alternativas consideradas

### Começar diretamente pela OpenAI

Rejeitada porque misturaria interpretação de linguagem com regras de negócio antes de validar o domínio.

### Começar pelo WhatsApp

Rejeitada porque adicionaria complexidade de canal antes da validação do motor.

### Começar com banco relacional

Adiada porque persistência permanente ainda não é necessária para validar as primeiras regras.

### Implementar microsserviços

Rejeitada por complexidade desnecessária para o MVP.

## Regra

Nenhuma tecnologia adicional deverá ser adicionada ao MVP sem uma necessidade concreta do produto.

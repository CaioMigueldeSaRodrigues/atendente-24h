# Arquitetura do Atendente Automotivo 24/7

## 1. Objetivo arquitetural

A arquitetura deve permitir construir um agente comercial automotivo que funcione inicialmente por texto e posteriormente possa operar por WhatsApp, telefone/voz e web sem reescrever a lógica central do produto.

O núcleo do sistema não deve depender diretamente de fornecedores específicos.

OpenAI, WhatsApp, telefonia, banco de dados e outros serviços externos devem ser tratados como integrações substituíveis.

A prioridade do MVP é validar o comportamento comercial do atendente antes de aumentar a complexidade tecnológica.

---

## 2. Princípios

1. Negócio antes de tecnologia.
2. Núcleo independente de canal.
3. Núcleo independente de fornecedor de IA.
4. IA não é fonte de verdade.
5. Respostas do modelo devem ser validadas antes de gerar ações.
6. Nenhum preço, prazo ou diagnóstico pode ser inventado.
7. Toda conversa deve poder ser encaminhada para humano.
8. O MVP deve ser simples de executar localmente.
9. Dependências devem ser adicionadas somente quando houver necessidade real.
10. A arquitetura deve permitir evolução gradual sem antecipar complexidade.

---

## 3. Stack inicial

Runtime:

Node.js 24.

Linguagem:

TypeScript.

Gerenciador de pacotes:

npm.

Servidor HTTP:

Fastify.

Validação de dados:

Zod.

Integração com IA:

SDK oficial da OpenAI, encapsulado em src/integrations.

Testes:

node:test e assert/strict inicialmente.

Configuração sensível:

Variáveis de ambiente.

Nenhuma chave ou token poderá estar presente no código-fonte.

---

## 4. Organização principal

src/core/

Contém regras de negócio e casos de uso centrais.

O core não pode importar:

- SDK da OpenAI;
- SDK de WhatsApp;
- SDK de telefonia;
- bibliotecas específicas de CRM;
- implementações específicas de banco de dados.

---

src/channels/

Responsável por receber mensagens de canais externos e transformá-las em uma estrutura interna comum.

Exemplos futuros:

- web;
- WhatsApp;
- telefone/voz.

Um canal não contém regras de negócio.

---

src/integrations/

Contém implementações de serviços externos.

Exemplos futuros:

- OpenAI;
- agenda;
- CRM;
- telefonia;
- banco de dados;
- WhatsApp.

As integrações implementam contratos utilizados pelo core.

---

src/config/

Responsável pelo carregamento e validação de configuração da aplicação.

Nunca contém segredos diretamente.

---

## 5. Arquitetura lógica

Fluxo principal:

Canal
  ->
Normalização da mensagem
  ->
Motor de atendimento
  ->
Interpretação da intenção
  ->
Validação das regras de negócio
  ->
Atualização da oportunidade
  ->
Definição da próxima ação
  ->
Construção da resposta
  ->
Canal

Representação:

[ WhatsApp ]
[ Voz     ] ----> [ Canal ] ----> [ CORE ] ----> [ Integrações ]
[ Web     ]                      |            |
                                 |            +--> IA
                                 |            +--> Agenda
                                 |            +--> CRM
                                 |            +--> Persistência
                                 |
                                 +--> Regras comerciais

---

## 6. Primeiro canal do MVP

O primeiro MVP será textual.

Não serão implementados inicialmente:

- WhatsApp real;
- telefonia;
- voz em tempo real.

O objetivo inicial é validar o cérebro do atendente.

A aplicação deverá permitir enviar uma mensagem textual e receber uma resposta textual.

Esse fluxo poderá inicialmente ser exposto através de uma API HTTP simples utilizada para testes.

---

## 7. Papel da IA

A IA terá funções de linguagem e interpretação.

Ela poderá auxiliar em:

- identificação de intenção;
- extração de informações da conversa;
- classificação do contato;
- identificação de dados ausentes;
- elaboração de resposta natural;
- resumo da conversa.

A IA não terá autoridade final sobre regras comerciais.

---

## 8. Contrato conceitual da IA

O core não deverá trabalhar diretamente com texto livre retornado pelo modelo para decisões críticas.

A integração de IA deverá retornar uma estrutura validável contendo, conceitualmente:

- intenção identificada;
- dados extraídos;
- dados ainda necessários;
- próxima ação sugerida;
- necessidade de atendimento humano;
- resposta proposta;
- nível de confiança quando aplicável.

A estrutura definitiva será documentada em docs/modelo-dados.md.

---

## 9. Validação após a IA

Toda saída estruturada da IA deverá passar por validação.

O sistema poderá rejeitar ou substituir uma decisão proposta pelo modelo.

Exemplos:

Se a IA sugerir um preço sem fonte autorizada:
o sistema não deve fornecer o preço.

Se a IA tentar diagnosticar um defeito:
o sistema deve limitar a resposta e recomendar avaliação técnica.

Se não houver informação suficiente:
o sistema deverá solicitar os dados necessários.

Se houver risco de resposta inadequada:
o atendimento deverá ser encaminhado para humano.

---

## 10. Fonte de verdade

Informações comerciais deverão vir de dados autorizados.

Exemplos:

- horário de funcionamento;
- endereço;
- serviços oferecidos;
- preços autorizados;
- disponibilidade de agenda;
- políticas da oficina.

A IA poderá formular a resposta, mas não criar esses dados.

---

## 11. Motor de atendimento

O motor central será responsável por coordenar:

1. estado da conversa;
2. dados já conhecidos;
3. intenção atual;
4. informações ainda necessárias;
5. regras comerciais;
6. próxima ação;
7. resultado comercial da conversa.

O motor deverá permanecer independente do canal utilizado.

---

## 12. Estado da conversa

O sistema deverá conseguir manter contexto entre mensagens.

Exemplo:

Cliente:
"Tenho um Corolla."

Depois:

"É 2020."

Depois:

"Quero trocar as pastilhas."

O sistema deve compreender que as três mensagens pertencem ao mesmo atendimento.

O modelo de persistência será definido separadamente.

---

## 13. Persistência

A primeira implementação poderá utilizar persistência simples adequada ao desenvolvimento local.

O core deverá trabalhar através de contratos de repositório para permitir troca posterior da tecnologia de armazenamento.

A arquitetura deverá permitir evolução para banco relacional em produção.

A escolha definitiva de persistência será feita depois da definição do modelo de dados.

---

## 14. Entidades conceituais iniciais

O domínio deverá contemplar, no mínimo, conceitos equivalentes a:

- cliente;
- veículo;
- conversa;
- mensagem;
- oportunidade;
- solicitação de orçamento;
- solicitação de agendamento;
- resultado do atendimento.

Os campos definitivos serão definidos em docs/modelo-dados.md.

---

## 15. Oportunidade comercial

A oportunidade será uma entidade central.

Uma conversa não deve ser medida apenas por quantidade de mensagens.

O sistema deverá tentar responder:

- surgiu uma oportunidade?
- qual serviço está relacionado?
- qual veículo está relacionado?
- qual a intenção do cliente?
- qual a próxima ação?
- houve conversão?
- houve necessidade de retorno humano?

---

## 16. Encaminhamento humano

O sistema deve permitir escalonamento para humano.

O encaminhamento poderá ocorrer quando:

- o cliente solicitar;
- houver baixa confiança;
- houver conflito de informações;
- houver necessidade de diagnóstico;
- preço não estiver disponível;
- negociação exigir autorização;
- o sistema não souber responder;
- existir regra específica para o caso.

O contexto já coletado deve acompanhar o encaminhamento.

---

## 17. API interna

O núcleo deverá receber uma mensagem em formato normalizado.

Exemplo conceitual:

{
  "conversationId": "...",
  "channel": "web",
  "customerId": "...",
  "message": "Quero trocar as pastilhas do meu Corolla 2020"
}

A resposta conceitual poderá conter:

{
  "message": "...",
  "status": "...",
  "nextAction": "...",
  "requiresHuman": false
}

O contrato definitivo será documentado em docs/api.md.

---

## 18. Segurança

Regras mínimas:

- nunca versionar .env;
- nunca registrar API keys em logs;
- nunca retornar segredos em erros;
- armazenar somente dados necessários;
- evitar registrar dados pessoais desnecessários;
- separar configuração de código;
- validar qualquer entrada externa;
- considerar dados vindos da IA como não confiáveis até validação.

---

## 19. Observabilidade

Mesmo no MVP deverão existir registros suficientes para entender:

- início de atendimento;
- término de atendimento;
- erros;
- encaminhamentos;
- intenção identificada;
- resultado comercial.

Logs não devem expor credenciais.

O detalhamento será definido durante a implementação.

---

## 20. Testes

A lógica de negócio deve ser testável sem chamar APIs externas.

Testes unitários deverão usar implementações falsas ou mocks das integrações.

Exemplo:

O teste de "preço não autorizado" não deverá precisar chamar a OpenAI.

O teste de "encaminhar para humano" não deverá precisar de WhatsApp real.

---

## 21. Fases técnicas do MVP

Fase 1:
núcleo e regras de negócio.

Fase 2:
modelo de dados.

Fase 3:
motor textual utilizando integrações falsas.

Fase 4:
integração OpenAI.

Fase 5:
API HTTP para testes.

Fase 6:
persistência.

Fase 7:
piloto textual.

Fase 8:
primeiro canal comercial real.

WhatsApp e voz serão avaliados após validação do núcleo.

---

## 22. Não objetivos atuais

Não construir agora:

- ERP;
- CRM completo;
- aplicativo mobile;
- painel administrativo complexo;
- telefonia;
- voz em tempo real;
- integração com múltiplos CRMs;
- microsserviços;
- Kubernetes;
- filas distribuídas;
- arquitetura multi-cloud.

Esses recursos somente serão considerados quando houver necessidade comprovada.

---

## 23. Critério arquitetural principal

Uma regra deverá ser utilizada durante todo o desenvolvimento:

Se removermos OpenAI, WhatsApp ou qualquer fornecedor específico, o núcleo comercial do Atendente Automotivo 24/7 deve continuar existindo.

A tecnologia serve ao produto.

O produto não deve existir em função de uma tecnologia.

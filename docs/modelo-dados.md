# Modelo de Dados do Atendente Automotivo 24/7

## 1. Objetivo

Este documento define o modelo conceitual de dados do Atendente Automotivo 24/7.

O objetivo é representar o domínio comercial antes da implementação em TypeScript ou da escolha definitiva do banco de dados.

O modelo deve permitir:

- manter contexto de conversa;
- identificar cliente e veículo;
- registrar oportunidades;
- registrar pedidos de orçamento;
- organizar agendamentos;
- registrar encaminhamentos humanos;
- distinguir ações solicitadas de ações realmente confirmadas;
- preservar a origem das informações autorizadas;
- medir resultados comerciais.

---

## 2. Princípios

1. O modelo de dados representa o negócio, não o fornecedor tecnológico.
2. Nenhuma entidade central depende da OpenAI.
3. Nenhuma entidade central depende de WhatsApp, telefonia ou outro canal.
4. Estados solicitados e estados confirmados devem permanecer separados.
5. Dados pessoais devem ser coletados somente quando necessários.
6. Informações comerciais autorizadas devem ser distinguíveis de informação inferida.
7. Toda entidade pertencente à operação de uma oficina deve ser associada à oficina responsável.
8. IDs devem ser opacos e não carregar significado de negócio.
9. Datas devem ser registradas com data e hora completas.
10. O modelo deve permitir substituição futura da persistência.

---

## 3. Oficina

Entidade conceitual:

Workshop

Representa a empresa atendida pela plataforma.

Campos conceituais:

- id
- name
- legalName, opcional
- phone, opcional
- email, opcional
- address, opcional
- timezone
- active
- createdAt
- updatedAt

O campo id será utilizado como workshopId nas demais entidades.

Mesmo no MVP com apenas uma oficina, os dados deverão permanecer associados a uma Workshop.

Essa decisão evita mistura de informações entre clientes quando o produto for expandido.

---

## 4. Cliente

Entidade:

Customer

Representa uma pessoa que interage com a oficina.

Campos conceituais:

- id
- workshopId
- name, opcional
- primaryPhone, opcional
- email, opcional
- preferredContactChannel, opcional
- createdAt
- updatedAt

O cliente pode existir inicialmente com poucos dados.

Não é obrigatório conhecer nome, telefone e e-mail simultaneamente.

O sistema deverá permitir enriquecimento progressivo.

---

## 5. Veículo

Entidade:

Vehicle

Representa o veículo relacionado ao atendimento.

Campos conceituais:

- id
- workshopId
- customerId, opcional
- brand, opcional
- model, opcional
- year, opcional
- version, opcional
- licensePlate, opcional
- mileage, opcional
- createdAt
- updatedAt

Nem todos os campos são obrigatórios.

O sistema deverá manter somente os dados necessários ao atendimento.

---

## 6. Conversa

Entidade:

Conversation

Representa uma sessão de atendimento.

Campos conceituais:

- id
- workshopId
- customerId, opcional
- vehicleId, opcional
- channel
- status
- commercialOutcome, opcional
- currentIntent, opcional
- startedAt
- lastMessageAt
- closedAt, opcional
- createdAt
- updatedAt

Uma conversa poderá originar uma oportunidade comercial.

Nem toda conversa será uma oportunidade.

---

## 7. Canal

Enum conceitual:

Channel

Valores iniciais:

- WEB
- WHATSAPP
- VOICE
- INTERNAL
- UNKNOWN

O core deverá tratar o canal apenas como contexto.

Regras de negócio não devem depender diretamente de uma implementação específica de canal.

---

## 8. Status da conversa

Enum:

ConversationStatus

Valores:

- ACTIVE
- WAITING_CUSTOMER
- WAITING_HUMAN
- CLOSED

ACTIVE:
a conversa está em andamento.

WAITING_CUSTOMER:
o sistema aguarda informação ou resposta do cliente.

WAITING_HUMAN:
o atendimento depende de ação humana.

CLOSED:
a interação foi encerrada.

O status operacional não deve ser confundido com o resultado comercial.

---

## 9. Resultado comercial da conversa

Enum:

CommercialOutcome

Valores:

- CONTACT_ONLY
- LEAD
- OPPORTUNITY
- QUOTE_REQUESTED
- APPOINTMENT_REQUESTED
- APPOINTMENT_CONFIRMED
- HUMAN_HANDOFF
- RESOLVED
- IRRELEVANT

O resultado poderá evoluir durante a conversa.

Exemplo:

CONTACT_ONLY

pode evoluir para:

OPPORTUNITY

e posteriormente para:

APPOINTMENT_CONFIRMED.

O valor armazenado representa o estado comercial mais recente considerado relevante para aquela conversa.

---

## 10. Mensagem

Entidade:

Message

Representa uma mensagem individual dentro de uma conversa.

Campos conceituais:

- id
- workshopId
- conversationId
- senderType
- channel
- content
- externalMessageId, opcional
- createdAt

Conteúdo bruto recebido por integrações poderá ser tratado separadamente quando necessário.

---

## 11. Tipo de remetente

Enum:

SenderType

Valores:

- CUSTOMER
- ASSISTANT
- HUMAN_AGENT
- SYSTEM

CUSTOMER:
mensagem do cliente.

ASSISTANT:
mensagem produzida pelo atendente automatizado.

HUMAN_AGENT:
mensagem de funcionário ou atendente humano.

SYSTEM:
evento ou mensagem interna do sistema.

---

## 12. Intenção

Enum conceitual:

Intent

Valores iniciais:

- GENERAL_INFORMATION
- SERVICE_INQUIRY
- QUOTE_REQUEST
- APPOINTMENT_REQUEST
- APPOINTMENT_CHANGE
- APPOINTMENT_CANCEL
- VEHICLE_STATUS
- WARRANTY
- COMPLAINT
- HUMAN_REQUEST
- SYMPTOM_REPORT
- OTHER
- UNKNOWN

A lista poderá evoluir mediante necessidade comprovada.

A IA pode sugerir uma intenção.

A aplicação deve validar se a intenção retornada é conhecida.

---

## 13. Oportunidade

Entidade:

Opportunity

Representa uma intenção comercial suficientemente clara para exigir acompanhamento ou próxima ação.

Campos conceituais:

- id
- workshopId
- conversationId
- customerId, opcional
- vehicleId, opcional
- serviceDescription, opcional
- status
- nextAction, opcional
- estimatedValue, opcional
- realizedValue, opcional
- valueSource, opcional
- createdAt
- updatedAt
- closedAt, opcional

estimatedValue não poderá ser criado arbitrariamente pela IA.

realizedValue somente poderá ser preenchido quando houver fonte confiável.

---

## 14. Status da oportunidade

Enum:

OpportunityStatus

Valores:

- OPEN
- WAITING_CUSTOMER
- WAITING_WORKSHOP
- CONVERTED
- LOST
- CLOSED

OPEN:
existe ação comercial em andamento.

WAITING_CUSTOMER:
continuidade depende do cliente.

WAITING_WORKSHOP:
continuidade depende da oficina.

CONVERTED:
houve conversão operacional definida pelo produto.

LOST:
a oportunidade foi perdida ou recusada.

CLOSED:
foi encerrada sem acompanhamento adicional.

CONVERTED não significa necessariamente venda financeira concluída.

---

## 15. Próxima ação

Campo conceitual:

NextAction

Pode inicialmente ser representado por:

- type
- description
- dueAt, opcional
- assignedTo, opcional

Tipos conceituais:

- PROVIDE_QUOTE
- CALL_CUSTOMER
- CONFIRM_AVAILABILITY
- SCHEDULE_EVALUATION
- REQUEST_INFORMATION
- HUMAN_REVIEW
- TECHNICAL_REVIEW
- NONE

A implementação definitiva será definida durante o desenvolvimento.

---

## 16. Solicitação de orçamento

Entidade:

QuoteRequest

Representa um pedido do cliente por preço, proposta ou orçamento.

Campos conceituais:

- id
- workshopId
- opportunityId
- conversationId
- customerId, opcional
- vehicleId, opcional
- serviceDescription
- symptomDescription, opcional
- status
- requestedAt
- respondedAt, opcional
- authorizedPrice, opcional
- createdAt
- updatedAt

---

## 17. Status do orçamento

Enum:

QuoteRequestStatus

Valores:

- REQUESTED
- WAITING_INFORMATION
- WAITING_WORKSHOP
- RESPONDED
- CANCELLED
- CLOSED

REQUESTED:
pedido registrado.

WAITING_INFORMATION:
faltam dados necessários.

WAITING_WORKSHOP:
depende da equipe.

RESPONDED:
a oficina forneceu resposta ou orçamento autorizado.

A IA não muda REQUESTED para RESPONDED sem confirmação operacional.

---

## 18. Solicitação de agendamento

Entidade:

Appointment

Representa tanto uma solicitação quanto um agendamento efetivamente confirmado.

Campos conceituais:

- id
- workshopId
- opportunityId, opcional
- conversationId
- customerId, opcional
- vehicleId, opcional
- requestedDate, opcional
- requestedTime, opcional
- confirmedStartAt, opcional
- status
- serviceDescription, opcional
- externalAppointmentId, opcional
- createdAt
- updatedAt

---

## 19. Status do agendamento

Enum:

AppointmentStatus

Valores:

- REQUESTED
- CHECKING_AVAILABILITY
- CONFIRMED
- RESCHEDULE_REQUESTED
- CANCEL_REQUESTED
- CANCELLED
- COMPLETED

REQUESTED:
o cliente manifestou interesse e uma solicitação foi registrada.

CONFIRMED:
a fonte de agenda autorizada confirmou a reserva.

O sistema nunca deverá usar CONFIRMED apenas porque existe requestedDate ou requestedTime.

---

## 20. Encaminhamento humano

Entidade:

HumanHandoff

Representa transferência ou necessidade explícita de ação humana.

Campos conceituais:

- id
- workshopId
- conversationId
- opportunityId, opcional
- reason
- summary
- status
- assignedTo, opcional
- requestedAt
- acceptedAt, opcional
- resolvedAt, opcional
- createdAt
- updatedAt

O summary deverá preservar contexto suficiente para evitar que o cliente repita toda a conversa.

---

## 21. Motivo do encaminhamento

Enum:

HandoffReason

Valores iniciais:

- CUSTOMER_REQUEST
- DIAGNOSIS_REQUIRED
- SAFETY_CONCERN
- PRICE_UNAVAILABLE
- NEGOTIATION_REQUIRED
- WARRANTY_OR_COMPLAINT
- LOW_CONFIDENCE
- CONFLICTING_INFORMATION
- INTEGRATION_FAILURE
- AI_FAILURE
- UNKNOWN_INFORMATION
- OTHER

---

## 22. Status do encaminhamento

Enum:

HandoffStatus

Valores:

- REQUESTED
- QUEUED
- ACCEPTED
- RESOLVED
- CANCELLED

O status deverá representar eventos reais.

Não marcar ACCEPTED se nenhum humano tiver assumido o atendimento.

---

## 23. Relato técnico do cliente

Entidade conceitual:

SymptomReport

Pode ser incorporada inicialmente à oportunidade ou ao pedido de orçamento.

Campos conceituais:

- description
- reportedAt
- safetyConcern
- rawCustomerText, opcional

O sistema registra relato.

Não registra diagnóstico como fato.

Exemplo correto:

description:
"barulho ao frear"

Exemplo incorreto:

diagnosis:
"pastilha gasta"

quando nenhum profissional confirmou.

---

## 24. Informação autorizada da oficina

Entidade conceitual:

AuthorizedBusinessFact

Representa uma informação que o atendente pode tratar como fonte de verdade.

Campos conceituais:

- id
- workshopId
- type
- key
- value
- active
- source
- validFrom, opcional
- validUntil, opcional
- createdAt
- updatedAt

Exemplos:

type:
BUSINESS_HOURS

type:
ADDRESS

type:
SERVICE

type:
PRICE

type:
POLICY

type:
WARRANTY

type:
DISCOUNT_POLICY

A IA poderá utilizar essas informações para formular respostas.

Não poderá inventar valores ausentes.

---

## 25. Tipos de informação autorizada

Enum:

BusinessFactType

Valores iniciais:

- BUSINESS_HOURS
- ADDRESS
- CONTACT
- SERVICE
- PRICE
- PRICE_RANGE
- POLICY
- WARRANTY
- DISCOUNT_POLICY
- PAYMENT_METHOD
- OTHER

A lista poderá evoluir.

---

## 26. Origem da informação

Campo conceitual:

source

Exemplos:

- WORKSHOP_ADMIN
- IMPORT
- CRM
- ERP
- SCHEDULING_SYSTEM
- MANUAL_CONFIGURATION

Quando possível, deverá ser possível identificar a origem de uma informação usada em decisão comercial.

---

## 27. Dados extraídos pela IA

A saída da IA não deverá alterar entidades diretamente sem validação.

Estrutura conceitual:

AIInterpretation

Campos:

- intent
- extractedCustomerData
- extractedVehicleData
- symptomDescription, opcional
- requestedService, opcional
- missingData
- suggestedNextAction
- requiresHuman
- handoffReason, opcional
- proposedResponse
- confidence, opcional

Essa estrutura é transitória.

Ela deve ser validada antes de produzir alterações persistentes.

---

## 28. Confiança

confidence, quando utilizado, deverá ser um valor normalizado.

Conceitualmente:

0 a 1.

A aplicação não deverá depender exclusivamente de um limiar numérico.

Regras determinísticas continuam tendo prioridade.

Exemplo:

mesmo com confiança alta, o modelo não pode diagnosticar um defeito.

---

## 29. Separação entre sugestão e fato

O sistema deve distinguir:

- informação dita pelo cliente;
- informação autorizada da oficina;
- interpretação da IA;
- ação realmente executada.

Essa separação é obrigatória.

Exemplo:

cliente disse:
"acho que é a bateria"

isso não significa:

diagnóstico confirmado = bateria.

---

## 30. Eventos executados

Ações relevantes deverão poder ser distinguidas de ações apenas sugeridas.

Exemplos:

Sugerido:
agendar quarta-feira.

Executado:
agenda confirmou quarta-feira às 14:00.

Sugerido:
encaminhar para humano.

Executado:
handoff criado.

Essa distinção evita falsas confirmações.

---

## 31. Identificadores externos

Integrações poderão fornecer identificadores externos.

Exemplos:

- WhatsApp message ID;
- appointment ID;
- CRM contact ID;
- ticket ID.

Esses valores não deverão substituir IDs internos do domínio.

Devem ser armazenados como referências externas.

---

## 32. Datas e horários

Datas e horários persistidos deverão conter informação suficiente de timezone.

A oficina deverá possuir timezone configurado.

Exemplo esperado no Brasil:

America/Sao_Paulo

A aplicação não deve assumir timezone implicitamente.

---

## 33. Exclusão lógica e histórico

O MVP não precisa implementar sistema completo de auditoria.

Entretanto, registros comerciais importantes não devem ser sobrescritos de forma que acontecimentos relevantes sejam perdidos.

Mudanças de status importantes poderão futuramente gerar eventos ou histórico próprio.

A necessidade será avaliada durante a implementação.

---

## 34. Privacidade e minimização

O modelo deverá armazenar somente dados necessários ao atendimento e operação comercial.

Não armazenar:

- documentos pessoais sem necessidade;
- dados financeiros sensíveis desnecessários;
- informações sem finalidade operacional;
- credenciais.

Dados pessoais deverão permanecer associados à oficina responsável.

---

## 35. Isolamento por oficina

Qualquer consulta operacional deverá ser limitada pelo workshopId.

Uma oficina não poderá consultar:

- clientes;
- veículos;
- conversas;
- oportunidades;
- mensagens;
- agendamentos;
- orçamentos;

pertencentes a outra oficina.

Essa regra deverá existir mesmo antes de uma implementação completa de multitenancy.

---

## 36. Relacionamentos principais

Workshop
  1 -> N Customer

Workshop
  1 -> N Conversation

Workshop
  1 -> N Opportunity

Customer
  1 -> N Vehicle

Customer
  1 -> N Conversation

Conversation
  1 -> N Message

Conversation
  0 -> N Opportunity

Opportunity
  0 -> N QuoteRequest

Opportunity
  0 -> N Appointment

Conversation
  0 -> N HumanHandoff

Opportunity
  0 -> N HumanHandoff

Workshop
  1 -> N AuthorizedBusinessFact

---

## 37. Fluxo de exemplo

Cliente envia:

"Tenho um Corolla 2020 e quero saber quanto custa trocar as pastilhas."

O sistema poderá representar:

Customer:
identificado ou criado parcialmente.

Vehicle:
model = Corolla
year = 2020

Conversation:
status = ACTIVE
currentIntent = QUOTE_REQUEST

Opportunity:
status = OPEN
serviceDescription = troca de pastilhas

QuoteRequest:
status = REQUESTED

Se não houver preço autorizado:

Opportunity:
status = WAITING_WORKSHOP

QuoteRequest:
status = WAITING_WORKSHOP

O sistema não cria preço.

---

## 38. Segundo exemplo

Cliente:

"Meu carro está fazendo um barulho muito forte quando freio."

AIInterpretation poderá indicar:

intent = SYMPTOM_REPORT
symptomDescription = "barulho muito forte ao frear"

O domínio registra o relato.

Não registra diagnóstico.

Dependendo das regras:

HumanHandoff poderá ser criado com:

reason = SAFETY_CONCERN

---

## 39. Terceiro exemplo

Cliente:

"Pode marcar amanhã às 10?"

O sistema registra:

Appointment:
requestedDate = amanhã
requestedTime = 10:00
status = REQUESTED

Somente após consulta e confirmação real:

status = CONFIRMED

confirmedStartAt = horário confirmado.

---

## 40. Valores monetários

Valores monetários não deverão ser armazenados como ponto flutuante simples.

A implementação deverá utilizar representação segura para moeda.

Exemplos possíveis:

- centavos como inteiro;
- tipo decimal apropriado do banco.

A decisão concreta será registrada na implementação.

Moeda padrão inicial:

BRL.

---

## 41. Campos obrigatórios versus progressivos

O modelo deverá permitir criação progressiva.

Exemplo:

uma Conversation poderá existir sem Customer identificado.

Uma Opportunity poderá inicialmente existir sem Vehicle completo.

O sistema não deverá exigir todos os dados apenas para permitir o início do atendimento.

Validações específicas deverão ocorrer no momento da ação que realmente necessita do dado.

---

## 42. Fonte de verdade e cache

AuthorizedBusinessFact poderá inicialmente representar informações configuradas localmente.

No futuro, algumas informações poderão vir em tempo real de integrações.

Exemplo:

agenda.

Nesse caso, a integração operacional terá precedência sobre informação estática potencialmente desatualizada.

---

## 43. Não objetivos do modelo inicial

Não modelar agora:

- estoque completo;
- peças e fornecedores;
- contas a pagar;
- contas a receber;
- emissão fiscal;
- ordem de serviço completa;
- mecânicos e produtividade;
- folha de pagamento;
- contabilidade;
- CRM completo;
- ERP completo.

Esses conceitos somente serão adicionados se forem necessários ao produto.

---

## 44. Critério principal

O modelo deve permitir responder, de maneira confiável:

Quem entrou em contato?

Qual veículo está envolvido?

O que o cliente quer?

O que já sabemos?

O que ainda precisamos saber?

Existe oportunidade comercial?

Qual é o próximo passo?

Alguma ação foi realmente confirmada?

É necessário atendimento humano?

Qual resultado comercial foi produzido?

Sem depender de informações inventadas pela IA.

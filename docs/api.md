# API do Atendente Automotivo 24/7

## 1. Objetivo

Este documento define o contrato inicial da API do MVP textual.

A API existe para expor o motor de atendimento de forma independente do canal.

O primeiro consumidor será um ambiente de testes.

Posteriormente, WhatsApp, web e voz poderão utilizar o mesmo núcleo.

---

## 2. Princípios

1. A API não contém regras de negócio específicas do canal.
2. Toda entrada externa deve ser validada.
3. O workshopId delimita a operação da oficina.
4. A API não deve expor credenciais ou detalhes internos de fornecedores.
5. Respostas devem distinguir ações solicitadas de ações confirmadas.
6. Erros de integração não devem gerar respostas comerciais falsas.
7. O formato HTTP não deve contaminar o core.
8. O contrato deve permanecer simples no MVP.

---

## 3. Versão

A primeira versão utilizará o prefixo:

/v1

Exemplo:

/v1/conversations

Mudanças incompatíveis futuras deverão utilizar nova versão.

---

## 4. Content-Type

Requisições e respostas utilizarão:

application/json

Codificação:

UTF-8

---

## 5. Health check

Endpoint:

GET /health

Objetivo:

confirmar que a aplicação está funcionando.

Resposta esperada:

{
  "status": "ok"
}

Esse endpoint não verifica necessariamente integrações externas.

---

## 6. Criar conversa

Endpoint:

POST /v1/conversations

Objetivo:

iniciar uma nova Conversation.

Request conceitual:

{
  "workshopId": "workshop_123",
  "channel": "WEB",
  "customerId": null
}

Response conceitual:

{
  "conversationId": "conv_123",
  "status": "ACTIVE",
  "channel": "WEB",
  "commercialOutcome": null
}

No MVP local, workshopId poderá ser fornecido explicitamente.

Em produção, a identificação da oficina deverá futuramente ser derivada de contexto autenticado e não confiada cegamente ao cliente da API.

---

## 7. Enviar mensagem

Endpoint principal:

POST /v1/conversations/:conversationId/messages

Objetivo:

enviar uma mensagem do cliente ao motor de atendimento.

Request:

{
  "workshopId": "workshop_123",
  "message": "Quero saber quanto custa trocar as pastilhas do meu Corolla 2020"
}

O canal já deverá ser conhecido pela Conversation.

---

## 8. Resposta da mensagem

Response conceitual:

{
  "conversationId": "conv_123",
  "messageId": "msg_456",
  "reply": "Esse valor precisa ser confirmado pela equipe. Posso registrar a solicitação de orçamento para retorno?",
  "conversationStatus": "ACTIVE",
  "commercialOutcome": "OPPORTUNITY",
  "intent": "QUOTE_REQUEST",
  "nextAction": {
    "type": "REQUEST_INFORMATION",
    "description": "Confirmar criação do pedido de orçamento"
  },
  "requiresHuman": false
}

A resposta deve refletir o estado real da operação.

---

## 9. Resposta com encaminhamento humano

Exemplo:

{
  "conversationId": "conv_123",
  "reply": "Vou encaminhar sua solicitação para a equipe responsável.",
  "conversationStatus": "WAITING_HUMAN",
  "commercialOutcome": "HUMAN_HANDOFF",
  "intent": "HUMAN_REQUEST",
  "requiresHuman": true,
  "handoff": {
    "id": "handoff_123",
    "reason": "CUSTOMER_REQUEST",
    "status": "REQUESTED"
  }
}

A existência de requiresHuman = true não significa que um humano já aceitou o atendimento.

---

## 10. Resposta de orçamento solicitado

Exemplo:

{
  "conversationId": "conv_123",
  "reply": "Pedido de orçamento registrado. A equipe precisa confirmar o valor.",
  "commercialOutcome": "QUOTE_REQUESTED",
  "requiresHuman": false,
  "quoteRequest": {
    "id": "quote_123",
    "status": "WAITING_WORKSHOP"
  },
  "opportunity": {
    "id": "opp_123",
    "status": "WAITING_WORKSHOP",
    "nextAction": {
      "type": "PROVIDE_QUOTE"
    }
  }
}

Não retornar preço que não exista em fonte autorizada.

---

## 11. Resposta de agendamento solicitado

Exemplo:

{
  "conversationId": "conv_123",
  "reply": "Registrei sua preferência para amanhã às 10h. A equipe ainda precisa confirmar o horário.",
  "commercialOutcome": "APPOINTMENT_REQUESTED",
  "appointment": {
    "id": "appt_123",
    "status": "REQUESTED",
    "requestedDate": "2026-09-23",
    "requestedTime": "10:00"
  }
}

REQUESTED não significa CONFIRMED.

---

## 12. Agendamento confirmado

Somente uma fonte de agenda autorizada poderá produzir:

{
  "status": "CONFIRMED",
  "confirmedStartAt": "2026-09-23T10:00:00-03:00"
}

A IA não poderá produzir essa confirmação sozinha.

---

## 13. Consultar conversa

Endpoint:

GET /v1/conversations/:conversationId

Objetivo:

obter o estado atual da conversa.

Response conceitual:

{
  "id": "conv_123",
  "workshopId": "workshop_123",
  "channel": "WEB",
  "status": "ACTIVE",
  "commercialOutcome": "OPPORTUNITY",
  "currentIntent": "QUOTE_REQUEST",
  "customerId": "customer_123",
  "vehicleId": "vehicle_123",
  "startedAt": "...",
  "lastMessageAt": "..."
}

---

## 14. Histórico de mensagens

Endpoint:

GET /v1/conversations/:conversationId/messages

Response:

{
  "conversationId": "conv_123",
  "messages": [
    {
      "id": "msg_1",
      "senderType": "CUSTOMER",
      "content": "Tenho um Corolla 2020.",
      "createdAt": "..."
    },
    {
      "id": "msg_2",
      "senderType": "ASSISTANT",
      "content": "Entendi. O que você gostaria de verificar nele?",
      "createdAt": "..."
    }
  ]
}

---

## 15. Contrato interno do motor

O canal deverá converter qualquer entrada externa para uma estrutura normalizada antes de chamar o core.

Estrutura conceitual:

ProcessMessageInput

{
  "workshopId": "...",
  "conversationId": "...",
  "channel": "WEB",
  "senderType": "CUSTOMER",
  "content": "...",
  "externalMessageId": null
}

O core não recebe objetos específicos de WhatsApp, telefonia ou OpenAI.

---

## 16. Saída interna do motor

Estrutura conceitual:

ProcessMessageResult

{
  "conversationId": "...",
  "reply": "...",
  "intent": "...",
  "conversationStatus": "...",
  "commercialOutcome": "...",
  "requiresHuman": false,
  "nextAction": null,
  "createdEntities": [],
  "updatedEntities": []
}

A estrutura definitiva será formalizada em TypeScript durante a implementação.

---

## 17. Contrato com a IA

A integração de IA deverá retornar uma estrutura validável.

Conceitualmente:

{
  "intent": "QUOTE_REQUEST",
  "extractedCustomerData": {},
  "extractedVehicleData": {
    "model": "Corolla",
    "year": 2020
  },
  "symptomDescription": null,
  "requestedService": "troca de pastilhas",
  "missingData": [],
  "suggestedNextAction": "PROVIDE_QUOTE",
  "requiresHuman": false,
  "handoffReason": null,
  "proposedResponse": "...",
  "confidence": 0.94
}

Essa saída é sugestão.

Não representa alteração persistida nem ação confirmada.

---

## 18. Validação da saída da IA

A aplicação deverá validar:

- formato;
- enums conhecidos;
- tipos;
- limites;
- ações permitidas;
- regras determinísticas.

Exemplo:

Se a IA retornar:

{
  "diagnosis": "pastilhas gastas"
}

o domínio não deverá transformar isso em diagnóstico confirmado.

---

## 19. Fonte autorizada

A API interna deverá permitir ao motor consultar informações autorizadas da oficina através de contrato próprio.

Conceitualmente:

BusinessKnowledgeRepository

Operações futuras:

findBusinessFact
findService
findAuthorizedPrice
findPolicy

O domínio não deverá consultar diretamente banco ou API externa.

---

## 20. Agenda

A integração futura de agenda deverá implementar contrato conceitual semelhante a:

SchedulingGateway

Operações possíveis:

checkAvailability
createAppointment
rescheduleAppointment
cancelAppointment

O core não conhece o fornecedor da agenda.

---

## 21. Persistência

O core deverá trabalhar através de contratos.

Exemplos:

ConversationRepository
MessageRepository
CustomerRepository
VehicleRepository
OpportunityRepository
QuoteRequestRepository
AppointmentRepository
HumanHandoffRepository
BusinessFactRepository

A tecnologia concreta de banco não fará parte desses contratos.

---

## 22. Erros de validação

Entrada inválida deverá utilizar:

HTTP 400

Exemplo:

{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "A mensagem é obrigatória."
  }
}

A mensagem deve ser segura e não expor detalhes internos.

---

## 23. Recurso não encontrado

Utilizar:

HTTP 404

Exemplo:

{
  "error": {
    "code": "CONVERSATION_NOT_FOUND",
    "message": "Conversa não encontrada."
  }
}

---

## 24. Conflito

HTTP 409 poderá ser utilizado quando uma ação não puder ser executada devido ao estado atual.

Exemplo:

tentar confirmar novamente um agendamento já cancelado.

---

## 25. Falha interna

Erros inesperados deverão utilizar:

HTTP 500

Resposta externa:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Não foi possível processar a solicitação."
  }
}

Não retornar:

- stack trace;
- API key;
- prompt interno;
- credenciais;
- resposta bruta confidencial de fornecedor.

---

## 26. Falha temporária de integração

Quando uma dependência externa estiver indisponível, poderá ser utilizado:

HTTP 503

Entretanto, o motor deverá preferir preservar o atendimento quando existir fallback seguro.

Exemplo:

agenda indisponível.

O cliente ainda poderá registrar preferência de horário.

---

## 27. Idempotência

Operações que criam efeitos externos deverão futuramente suportar proteção contra duplicidade.

Exemplos:

- criar agendamento;
- criar handoff;
- enviar mensagem externa.

O MVP textual poderá inicialmente tratar isso de forma simplificada.

A necessidade deverá ser considerada antes de integrar canais reais.

---

## 28. Isolamento por oficina

Toda operação deverá validar que os recursos pertencem ao workshopId correto.

Exemplo proibido:

Workshop A acessar conversationId pertencente ao Workshop B.

Essa verificação deverá existir na camada apropriada da aplicação.

---

## 29. Autenticação

O MVP local poderá operar sem autenticação externa completa.

Isso não é aceitável para produção.

Antes de disponibilizar a API publicamente, deverá existir autenticação e associação segura da requisição à Workshop correspondente.

Não implementar autenticação antes da necessidade do MVP local.

---

## 30. Limites de conteúdo

Mensagens deverão possuir limite máximo configurado.

O valor definitivo será definido durante implementação.

O objetivo é evitar:

- abuso;
- payloads excessivos;
- custos imprevisíveis;
- entrada acidentalmente gigantesca.

---

## 31. Logs

Cada requisição deverá futuramente possuir identificador de correlação.

Logs deverão permitir rastrear:

- requisição;
- conversationId;
- workshopId;
- resultado;
- erro.

Logs não devem conter credenciais.

Dados pessoais deverão ser minimizados.

---

## 32. Datas

A API deverá utilizar formato ISO 8601.

Exemplo:

2026-09-23T10:00:00-03:00

Quando uma entrada representar apenas preferência local:

requestedDate e requestedTime poderão permanecer separados até confirmação.

---

## 33. Valores monetários

A API não deverá utilizar ponto flutuante para representar moeda.

Representação inicial recomendada:

{
  "amountCents": 15990,
  "currency": "BRL"
}

Representa:

R$ 159,90.

---

## 34. Paginação

Endpoints de listas poderão futuramente utilizar paginação.

Não implementar infraestrutura de paginação enquanto o MVP não necessitar.

---

## 35. Compatibilidade futura com canais

WhatsApp, voz e web deverão utilizar o mesmo ProcessMessageInput após normalização.

Exemplo:

WhatsApp recebe estrutura específica do provedor.

O adapter converte para:

ProcessMessageInput.

O core processa.

A resposta do core é convertida novamente para o formato do canal.

---

## 36. Regra principal da API

A API transporta intenções e resultados.

Ela não decide regras comerciais.

Fluxo:

HTTP ou canal
  ->
validação de entrada
  ->
normalização
  ->
core
  ->
integrações
  ->
resultado do domínio
  ->
serialização
  ->
resposta

O transporte deve permanecer separado da decisão de negócio.

---

## 37. Endpoints do MVP

O primeiro MVP deverá necessitar apenas de:

GET /health

POST /v1/conversations

POST /v1/conversations/:conversationId/messages

GET /v1/conversations/:conversationId

GET /v1/conversations/:conversationId/messages

Não adicionar endpoints sem necessidade comprovada.

---

## 38. Fora do escopo inicial

Não criar agora:

- API pública completa de CRM;
- CRUD administrativo de todas as entidades;
- API de estoque;
- API financeira;
- WebSocket;
- streaming de voz;
- webhook de WhatsApp;
- autenticação corporativa;
- API de relatórios;
- API de faturamento.

Esses recursos serão adicionados somente quando o produto exigir.

---

## 39. Critérios de aceite

A implementação futura da API deverá demonstrar que:

1. uma Conversation pode ser criada;
2. mensagens podem ser enviadas à Conversation;
3. contexto é preservado entre mensagens;
4. resposta contém estado operacional e comercial;
5. preço não autorizado não é inventado;
6. pedido de humano gera handoff;
7. agendamento solicitado não vira confirmado sem confirmação real;
8. workshopId não permite acesso cruzado;
9. entradas inválidas são rejeitadas;
10. o core pode ser testado sem servidor HTTP.

---

## 40. Critério final

Deve ser possível substituir Fastify por outro transporte sem reescrever o núcleo comercial.

Da mesma forma, deve ser possível adicionar WhatsApp ou voz reutilizando o mesmo motor.

A API serve como uma porta de entrada para o produto.

Ela não é o produto.

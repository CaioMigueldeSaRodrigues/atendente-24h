# Fluxo de Atendimento do Atendente Automotivo 24/7

## 1. Objetivo

Este documento descreve como uma conversa deve evoluir desde a primeira mensagem até seu encerramento ou encaminhamento.

O fluxo deve servir como referência para:

- implementação do motor de atendimento;
- testes;
- integração com IA;
- criação posterior da API;
- treinamento comercial e demonstrações do produto.

O objetivo não é escrever diálogos rígidos.

O sistema deverá conversar naturalmente, respeitando as regras de negócio.

---

## 2. Princípio do fluxo

Toda mensagem recebida deve passar conceitualmente por:

1. identificar a conversa;
2. recuperar contexto;
3. interpretar a mensagem;
4. atualizar dados conhecidos;
5. identificar intenção;
6. verificar regras de negócio;
7. decidir próxima ação;
8. executar ou registrar ação permitida;
9. construir resposta;
10. atualizar resultado comercial.

Representação:

Mensagem
  ->
Contexto
  ->
Interpretação
  ->
Validação
  ->
Decisão
  ->
Ação
  ->
Resposta
  ->
Atualização comercial

---

## 3. Regra de prioridade

A ordem de prioridade será:

1. segurança;
2. solicitação explícita de humano;
3. cumprimento das regras de negócio;
4. resolução da necessidade;
5. conversão comercial;
6. enriquecimento de dados.

O sistema nunca deverá sacrificar segurança ou confiabilidade para aumentar conversão.

---

## 4. Início da conversa

Ao receber a primeira mensagem, o sistema deverá:

- criar ou recuperar Conversation;
- identificar o canal;
- identificar Customer quando possível;
- registrar Message;
- interpretar a intenção;
- responder sem exigir cadastro completo.

Exemplo:

Cliente:
"Oi, vocês fazem alinhamento?"

Resposta adequada:

"Olá! Sim, se esse serviço estiver cadastrado como oferecido pela oficina. Se quiser, posso verificar como agendar."

Não pedir nome, placa e telefone antes de responder uma pergunta simples.

---

## 5. Identificação progressiva

Dados devem ser coletados conforme a necessidade.

Exemplo:

Cliente:
"Quero fazer orçamento de freio."

Atendente:
"Claro. Qual é o modelo e o ano do veículo?"

Cliente:
"Corolla 2020."

A conversa já possui:

intent = QUOTE_REQUEST
vehicle.model = Corolla
vehicle.year = 2020

Não perguntar novamente esses dados.

---

## 6. Fluxo de informação geral

Exemplos:

- horário;
- endereço;
- formas de pagamento;
- serviços oferecidos;
- funcionamento aos sábados.

Fluxo:

pergunta
  ->
consultar fonte autorizada
  ->
informação encontrada?
     sim -> responder
     não -> oferecer confirmação humana

Se a necessidade for totalmente resolvida:

CommercialOutcome = RESOLVED

Se houver interesse comercial adicional, o fluxo poderá continuar.

---

## 7. Fluxo de consulta de serviço

Cliente:

"Vocês fazem troca de óleo?"

Se a informação estiver autorizada:

responder objetivamente.

Depois poderá haver convite leve para próxima ação:

"Sim. Se quiser, posso verificar como agendar."

Se o serviço não estiver cadastrado:

não assumir.

Resposta conceitual:

"Não tenho essa informação confirmada aqui. Posso registrar para a equipe verificar."

---

## 8. Fluxo de pedido de orçamento

Cliente:

"Quanto custa trocar as pastilhas do meu Corolla 2020?"

Fluxo:

1. identificar intenção QUOTE_REQUEST;
2. identificar veículo;
3. identificar serviço;
4. consultar preço autorizado;
5. decidir resposta.

Se existir preço autorizado aplicável:

informar preço conforme a fonte.

Se preço depender de avaliação ou dados adicionais:

solicitar somente o próximo dado necessário.

Se não existir preço autorizado:

criar ou atualizar Opportunity;
criar QuoteRequest;
marcar necessidade de retorno da oficina.

Resposta conceitual:

"Esse valor precisa ser confirmado pela equipe. Já posso registrar a solicitação para orçamento."

Nunca criar estimativa própria.

---

## 9. Fluxo de sintoma

Cliente:

"Meu carro está fazendo barulho quando freio."

Fluxo:

1. Intent = SYMPTOM_REPORT;
2. registrar relato;
3. não diagnosticar;
4. identificar se existe sinal de possível risco;
5. conduzir para avaliação.

Resposta conceitual:

"Entendi. Vou considerar esse relato para a avaliação da oficina. Se quiser, posso verificar como agendar."

Nunca responder:

"São as pastilhas."

---

## 10. Fluxo de possível risco de segurança

Exemplos:

- freio falhando;
- fumaça;
- superaquecimento intenso;
- cheiro forte de combustível;
- direção comprometida;
- pneu ou roda aparentemente comprometidos.

Fluxo:

1. registrar SymptomReport;
2. safetyConcern = true;
3. evitar incentivar a condução;
4. não diagnosticar;
5. recomendar avaliação profissional;
6. criar HumanHandoff quando aplicável.

A linguagem deverá ser conservadora e objetiva.

---

## 11. Fluxo de agendamento

Cliente:

"Quero agendar uma revisão."

Fluxo:

1. Intent = APPOINTMENT_REQUEST;
2. identificar serviço quando necessário;
3. identificar veículo quando necessário;
4. consultar disponibilidade se integração existir;
5. apresentar opções válidas;
6. receber escolha;
7. solicitar confirmação da agenda;
8. atualizar Appointment.

Antes da confirmação:

status = REQUESTED

ou

CHECKING_AVAILABILITY

Somente após confirmação real:

status = CONFIRMED

Nunca confundir preferência com reserva efetiva.

---

## 12. Fluxo sem integração de agenda

Se a agenda ainda não estiver integrada:

Cliente:
"Pode marcar amanhã às 10?"

Sistema registra:

requestedDate
requestedTime
status = REQUESTED

Resposta:

"Registrei sua preferência para amanhã às 10h. A equipe ainda precisa confirmar o horário."

CommercialOutcome:

APPOINTMENT_REQUESTED

Nunca:

"Está confirmado."

---

## 13. Fluxo de remarcação

Cliente:

"Preciso mudar meu horário."

Fluxo:

1. Intent = APPOINTMENT_CHANGE;
2. localizar agendamento quando possível;
3. coletar nova preferência;
4. executar alteração somente se integração permitir;
5. caso contrário, registrar solicitação;
6. nunca afirmar alteração concluída sem confirmação.

---

## 14. Fluxo de cancelamento

Cliente:

"Quero cancelar meu horário."

Fluxo semelhante à remarcação.

Sem integração operacional:

status = CANCEL_REQUESTED

Com confirmação real:

status = CANCELLED

---

## 15. Fluxo de status do veículo

Cliente:

"Meu carro já ficou pronto?"

Intent:

VEHICLE_STATUS

O sistema deverá consultar fonte operacional atualizada quando disponível.

Sem integração:

não inferir.

Resposta conceitual:

"Não tenho o status atualizado aqui. Vou encaminhar para a equipe verificar."

CommercialOutcome poderá ser HUMAN_HANDOFF.

---

## 16. Fluxo de garantia

Cliente:

"Esse serviço está na garantia?"

Intent:

WARRANTY

Se existir política autorizada suficiente:

responder nos limites da política.

Se depender de análise do caso:

criar HumanHandoff.

Não prometer cobertura.

Não negar cobertura sem fonte autorizada.

---

## 17. Fluxo de reclamação

Cliente:

"Fiz o serviço ontem e o problema voltou."

Intent:

COMPLAINT

Fluxo:

1. reconhecer a solicitação;
2. registrar contexto;
3. evitar assumir culpa;
4. evitar confrontar cliente;
5. encaminhar para responsável.

Resposta conceitual:

"Entendi. Vou registrar o ocorrido e encaminhar para a equipe responsável verificar seu caso."

---

## 18. Pedido explícito de humano

Cliente:

"Quero falar com uma pessoa."

Intent:

HUMAN_REQUEST

O sistema deverá respeitar imediatamente.

Pode perguntar:

"Claro. Posso informar rapidamente o motivo para encaminhar você para a pessoa certa?"

Se o cliente não quiser explicar:

continuar o encaminhamento.

Criar HumanHandoff.

---

## 19. Baixa confiança

Quando a interpretação não for suficientemente clara:

primeira tentativa:

fazer uma pergunta curta e objetiva.

Exemplo:

"Você gostaria de pedir um orçamento ou agendar uma avaliação?"

Se continuar ambíguo:

criar HumanHandoff.

O sistema não deverá entrar em ciclo infinito de perguntas.

---

## 20. Informação conflitante

Exemplo:

Cliente:
"É um Corolla 2019."

Depois:
"Na verdade é 2020."

O dado mais recente substitui o anterior.

Quando a contradição não puder ser resolvida:

perguntar objetivamente.

Exemplo:

"Só para confirmar: o ano correto é 2020?"

---

## 21. Informação comercial não disponível

Cliente:

"Quanto custa?"

Se não houver preço autorizado:

não usar conhecimento geral do modelo.

Fluxo:

registrar oportunidade
  ->
registrar QuoteRequest
  ->
WAITING_WORKSHOP

Resposta:

"Esse valor precisa ser confirmado pela equipe. Posso registrar o pedido para retorno."

---

## 22. Falha de integração

Exemplo:

agenda indisponível.

O sistema deverá:

1. preservar contexto;
2. evitar confirmação falsa;
3. registrar tentativa quando apropriado;
4. oferecer alternativa segura.

Resposta:

"Não consegui confirmar a agenda agora. Posso registrar sua preferência para a equipe retornar."

---

## 23. Falha da IA

Se a IA:

- não responder;
- retornar estrutura inválida;
- retornar intenção desconhecida;
- sugerir ação proibida;

o core deverá impedir ação insegura.

Alternativas:

- resposta controlada;
- pergunta de esclarecimento;
- HumanHandoff.

Nenhuma ação crítica deve depender exclusivamente de uma saída inválida da IA.

---

## 24. Conversa fora de contexto

Saudações e pequenos desvios podem receber resposta curta.

Exemplo:

Cliente:
"Bom dia."

Atendente:
"Bom dia! Como posso ajudar com seu veículo?"

Se a conversa permanecer sem relação com a oficina, o sistema deverá redirecionar ou encerrar educadamente.

---

## 25. Conteúdo ofensivo

O sistema deverá permanecer profissional.

Não responder com provocação.

Se houver abuso persistente:

poderá encerrar ou encaminhar conforme política futura.

---

## 26. Formação da oportunidade

Uma Opportunity deverá surgir quando existir intenção comercial suficientemente clara.

Exemplos:

- orçamento;
- agendamento;
- avaliação;
- serviço específico;
- retorno comercial.

Uma pergunta exclusivamente informativa não precisa gerar Opportunity.

---

## 27. Evolução comercial

Exemplo possível:

CONTACT_ONLY
  ->
LEAD
  ->
OPPORTUNITY
  ->
QUOTE_REQUESTED
  ->
APPOINTMENT_REQUESTED
  ->
APPOINTMENT_CONFIRMED

Nem toda conversa passará por todos os estados.

O sistema deve representar o estado real, não forçar um funil artificial.

---

## 28. Próxima ação

Toda Opportunity aberta deverá possuir, quando aplicável, uma próxima ação.

Exemplos:

- PROVIDE_QUOTE;
- CALL_CUSTOMER;
- CONFIRM_AVAILABILITY;
- SCHEDULE_EVALUATION;
- REQUEST_INFORMATION;
- HUMAN_REVIEW;
- TECHNICAL_REVIEW.

O atendimento poderá terminar enquanto a oportunidade continua aberta.

---

## 29. Encaminhamento humano

Antes de criar o handoff, o sistema deverá aproveitar os dados já conhecidos.

O resumo deve conter, quando disponíveis:

- nome;
- contato;
- veículo;
- serviço;
- sintomas relatados;
- intenção;
- dados coletados;
- motivo do handoff;
- próxima ação esperada.

Objetivo:

o cliente não deve precisar repetir toda a história.

---

## 30. Encerramento resolvido

Uma conversa pode ser fechada como RESOLVED quando:

- a necessidade foi atendida;
- não existe ação pendente;
- não há oportunidade aberta necessitando continuidade.

Exemplo:

"Vocês abrem sábado?"

Resposta fornecida.

Cliente:
"Obrigado."

ConversationStatus = CLOSED
CommercialOutcome = RESOLVED

---

## 31. Encerramento com oportunidade aberta

Exemplo:

pedido de orçamento registrado.

A conversa pode ser encerrada.

Mas:

OpportunityStatus = WAITING_WORKSHOP

QuoteRequestStatus = WAITING_WORKSHOP

A oportunidade continua aberta.

---

## 32. Cenário completo — orçamento

Cliente:
"Oi, quanto custa trocar pastilha de freio?"

Atendente:
"Claro. Qual é o modelo e o ano do veículo?"

Cliente:
"Corolla 2020."

Sistema identifica:

Intent = QUOTE_REQUEST

Vehicle:
model = Corolla
year = 2020

Opportunity criada.

Se não houver preço autorizado:

QuoteRequestStatus = WAITING_WORKSHOP

Resposta:

"Para esse veículo, o valor precisa ser confirmado pela equipe. Posso deixar o pedido de orçamento registrado para retorno?"

Cliente:
"Pode."

Resultado:

CommercialOutcome = QUOTE_REQUESTED

NextAction = PROVIDE_QUOTE

---

## 33. Cenário completo — agendamento

Cliente:
"Vocês fazem alinhamento?"

Atendente consulta fonte autorizada.

Resposta:
"Sim. Se quiser, posso verificar como agendar."

Cliente:
"Pode ser amanhã de manhã."

Appointment:

requestedDate = amanhã
requestedTime = manhã
status = REQUESTED

Se não houver agenda integrada:

"Registrei sua preferência para amanhã de manhã. A equipe ainda precisa confirmar o horário."

Resultado:

CommercialOutcome = APPOINTMENT_REQUESTED

---

## 34. Cenário completo — possível risco

Cliente:
"O pedal do freio está indo até o fundo."

Sistema:

Intent = SYMPTOM_REPORT

SymptomReport:
description = pedal do freio indo até o fundo
safetyConcern = true

O sistema não diagnostica.

Resposta deve evitar recomendar que o cliente continue dirigindo normalmente e deve direcionar para avaliação profissional.

HumanHandoff:

reason = SAFETY_CONCERN

---

## 35. Cenário completo — status

Cliente:
"Deixei meu Onix hoje cedo. Já ficou pronto?"

Sem integração operacional:

Intent = VEHICLE_STATUS

Resposta:

"Não tenho o status atualizado do veículo aqui. Vou encaminhar sua solicitação para a equipe verificar."

HumanHandoff criado.

---

## 36. Cenário completo — reclamação

Cliente:
"Troquei a bateria ontem e o carro não liga."

O sistema não afirma:

"a bateria está com defeito"

nem:

"o serviço foi mal feito".

Registra:

Intent = COMPLAINT

e contexto do relato.

Depois encaminha para humano.

---

## 37. Critérios de qualidade da conversa

Uma boa conversa deverá:

- responder antes de perguntar dados desnecessários;
- usar contexto já fornecido;
- fazer uma pergunta por etapa quando possível;
- não repetir informação;
- não inventar;
- não diagnosticar;
- não criar falsa confirmação;
- conduzir para próxima ação;
- saber parar e chamar humano.

---

## 38. Critérios de teste

O fluxo deverá permitir futuramente testes automatizados para garantir:

1. preço não autorizado nunca é inventado;
2. sintoma não vira diagnóstico;
3. pedido de humano gera handoff;
4. horário solicitado não vira confirmado sem confirmação;
5. informação já conhecida não é solicitada novamente;
6. correção do cliente atualiza contexto;
7. pergunta informativa pode terminar como RESOLVED;
8. pedido de orçamento gera Opportunity e QuoteRequest;
9. falha de integração não gera confirmação falsa;
10. possível risco gera tratamento conservador.

---

## 39. Regra final

O fluxo deve sempre buscar a menor quantidade de passos necessária para levar o cliente a uma resposta confiável ou próxima ação concreta.

O atendente não existe para prolongar conversas.

Existe para:

entender,
resolver,
converter,
registrar,
ou encaminhar.

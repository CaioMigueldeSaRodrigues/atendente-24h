# Gate 2: gateway LLM e minimização de dados

A composição do runtime usa `readLlmEnvironment` e `createMessageInterpreter`, em `src/integrations/llm`. O core continua dependendo apenas de `MessageInterpreter`. Não há dependências novas, fallback entre gateways nem tratamento específico por modelo.

## Configuração explícita

`LLM_PROVIDER` é obrigatório e aceita `openai` ou `openrouter`. A aplicação exige apenas a chave e o modelo do provider selecionado. Valores ausentes ou provider inválido impedem o startup com mensagens que não reproduzem os valores recebidos.

| Provider | Chave | Modelo obrigatório | Base URL |
| --- | --- | --- | --- |
| `openai` | `OPENAI_API_KEY` | `OPENAI_MODEL` | `https://api.openai.com/v1` |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` | `https://openrouter.ai/api/v1` |

`OPENROUTER_MODEL=openrouter/free` é suportado sem assumir a identidade do modelo subjacente. `OPENROUTER_HTTP_REFERER` e `OPENROUTER_APP_NAME` são opcionais e enviados apenas ao OpenRouter. O SDK tem logging desabilitado, timeout de 120 segundos e nenhuma repetição automática. O roteamento/failover configurado no OpenRouter pertence ao gateway externo.

Use `.env.example` como referência e mantenha as credenciais somente no ambiente ou em `.env.local`, ignorado pelo Git. O comando `npm run start:basic` carrega esse arquivo local. Não registre configuração completa, headers ou erros externos brutos.

## Política de orçamento

A antiga lista global de marca, modelo, ano e versão obrigatórios foi cancelada. Também não existe exigência padrão de placa, telefone, e-mail, quilometragem, CPF, chassi ou endereço.

O interpreter extrai um serviço, produto ou sintoma declarado. O core verifica se `requestedItem` ou `symptomDescription` contém esse objeto comercial. Sem objeto, define `missingData=["requestedItem"]`, ação `REQUEST_INFORMATION`, orçamento `WAITING_INFORMATION` e oportunidade `WAITING_CUSTOMER`. A pergunta determinística solicita apenas o serviço, produto ou sintoma.

Com objeto comercial, o core ignora `missingData`, `suggestedNextAction` e a resposta livre do modelo para decidir a coleta do orçamento. Define ação `PROVIDE_QUOTE`, orçamento e oportunidade `WAITING_BUSINESS`, sem afirmar preço ou disponibilidade. As regras existentes de encaminhamento humano continuam prioritárias.

“Olá. Quero orçamento para troca de óleo do meu Onix 2020.” é registrável imediatamente. “Quero orçamento.” permite perguntar o que será orçado. Informações cadastrais fornecidas espontaneamente continuam sendo extraídas e persistidas; sua presença não cria requisitos para outras conversas.

Não existe nesta etapa uma API de políticas específicas por oficina. Uma futura exigência indispensável para uma integração deve ser implementada explicitamente no domínio, com testes; texto gerado pelo LLM não constitui essa política. A extração semântica do objeto continua sendo responsabilidade do interpreter; o guard não reinterpreta linguagem natural nem confirma diagnósticos.

## Structured output e validação

Ambos os gateways usam `OpenAIMessageInterpreter`, Responses API, `store: false`, structured output e `parseAIInterpretation`/Zod existentes. Saída ausente ou incompatível falha; não há fallback textual nem alteração do schema público.

Os testes determinísticos cobrem configuração, transporte simulado dos dois gateways, S01–S05 e um interpreter desobediente que exige dados opcionais. O teste E2E de “Quero orçamento” agora fornece uma interpretação sem item inventado; a sequência de registro e complementação permanece coberta.

`npm run test:llm:live` é um smoke opt-in, separado de `npm test`. Usa o interpreter real com a entrada canônica sintética. Exige as variáveis do provider selecionado, não acessa banco, não persiste dados e não envia mensagens para canais. Para OpenRouter, configure `LLM_PROVIDER=openrouter` e `OPENROUTER_MODEL=openrouter/free` no ambiente do processo.

O smoke verifica parse, intenção, item, ausência de `missingData`/ação de coleta, extrações não declaradas e indicadores de preço/coleta na resposta. A inspeção textual é conservadora e limitada à entrada sintética; não prova toda a semântica de respostas futuras. A proteção em produção é a política determinística de orçamento.

O relatório live contém apenas provider, modelo configurado, status, intenção e indicador de coleta excessiva. Erros do serviço ou parse são `LIVE EXTERNAL FAILURE`; violações semânticas são `LIVE SEMANTIC FAILURE`; configuração incompleta é `LIVE CONFIGURATION FAILURE`. Nenhum deles é falha unitária do core, e o comando retorna código não zero em caso de falha.

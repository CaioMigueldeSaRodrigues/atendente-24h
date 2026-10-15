# Decisão 0008 — Provedor Groq via Chat Completions

## Contexto

O runtime atual usa a SDK OpenAI e Responses API para OpenAI/OpenRouter. O Groq
oferece compatibilidade OpenAI, mas a Responses API permanece beta e possui
diferenças documentadas de compatibilidade.

## Decisão

Adicionar Groq como provider explícito (`LLM_PROVIDER=groq`) usando a mesma SDK
OpenAI, com um adaptador próprio baseado em Chat Completions. O adaptador
reutiliza as instruções e o schema estruturado atuais, sem restaurar o
interpretador histórico.

O adaptador encaminha usage real do Groq ao `AiUsageRecorder`, incluindo
identificador da requisição e métricas de latência quando fornecidas. Não há
fallback automático para outro provider.

## Consequências

OpenAI, OpenRouter e a integração Gemini permanecem inalterados em seu fluxo
atual. A seleção Groq exige `GROQ_API_KEY` e `GROQ_MODEL`; preços continuam
persistidos em `ai_model_prices` e não são hardcoded no adaptador.

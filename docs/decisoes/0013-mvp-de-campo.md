# Decisão 0013 — MVP de campo: instância por oficina, migrations no boot e regras de atendimento

## Contexto

A primeira oficina-piloto entra no ar antes do produto completo (decisão de 01/11/2026 em `docs/pre-lancamento/plano-go-live.md`). O objetivo é aprender com uma oficina real, a menor operação que funcione e sem prometer o que o produto ainda não faz.

## Decisões

### Uma instância por oficina

Cada oficina tem o seu servidor ou stack Compose: o seu banco, o seu `.env.production`, o seu número de WhatsApp e o seu domínio. O código continua escopado por `business_id` e a oficina da instância vem da configuração (`BASIC_PLAN_BUSINESS_ID`); não há login multi-oficina, cadastro nem painel de plataforma no campo. Isolamento, backup e exclusão de dados ficam simples (apagar a stack apaga tudo) e uma falha numa oficina não alcança outra.

Consequência: o custo operacional cresce com o número de oficinas. Quando houver mais de poucas, é hora de multi-tenant com login (Fase 4 do plano), não antes.

### Migrations no boot, com trava

O app aplica as migrations ao subir, em ordem, cada uma em sua transação, sob `pg_advisory_lock` numa conexão dedicada. Duas subidas ao mesmo tempo (deploy sobreposto, reinício em laço) esperam uma pela outra e a segunda não encontra nada a aplicar. A pasta `migrations` é achada subindo a partir do módulo, então funciona em `dist`, em `dist-test` e na imagem, sem depender do diretório de trabalho.

Alternativa descartada: comando de migration separado do boot. É o certo com mais de uma instância e papel de banco sem DDL, mas no campo é mais um passo manual que pode ser esquecido. Fica para depois do piloto.

### Encaminhamento sem ninguém por 12 horas volta para o assistente

Um encaminhamento a humano que ninguém assumiu (sem `assign`, portanto sem resposta) em 12 horas é resolvido pelo ciclo do worker de envio: a conversa volta a `ACTIVE` e o cliente recebe uma vez um texto fixo pedindo que repita o que precisa. Esperar para sempre por uma pessoa que não vem é pior do que voltar a falar com o assistente. O encaminhamento que uma pessoa assumiu nunca é devolvido, por mais antigo que seja. O texto é enviado depois de resolver; se o envio falhar, não é repetido, e a próxima mensagem do cliente já cai no assistente.

A resposta do operador também mudou de ordem: o texto é enviado primeiro e gravado depois. Falha de envio responde 503 e não grava nada (nem a atribuição), para o operador tentar de novo sem duplicar nem deixar no histórico algo que o cliente não viu. O aviso à oficina em `notifyPhone` agora também sai quando o worker recupera uma mensagem perdida e abre o encaminhamento por falha de IA.

### Conversa com orçamento pendente não fecha

O fechamento por inatividade (24 horas) não atinge conversa com pessoa atendendo, orçamento aberto ou respondido sem entrega confirmada, nem agendamento solicitado. Fechar essas conversas moveria o vínculo de entrega do WhatsApp para uma conversa nova e o preço autorizado chegaria ao cliente numa conversa em que ele não existe. O custo é manter abertas conversas que talvez nunca terminem; o painel as mostra e a oficina decide.

### Privacidade e logs

A primeira resposta a cada cliente (uma vez por cliente, não por conversa) diz que é um assistente virtual da oficina, que os dados são tratados para o atendimento e onde está o aviso (`PUBLIC_ORIGIN/privacidade`). A página `/privacidade` é uma minuta marcada como sujeita a revisão jurídica. Exclusão de dados é manual, por `scripts/erase-customer.sql`, em uma transação. O log é JSON em uma linha e nunca recebe conteúdo de mensagem, telefone, token, corpo de requisição ou `error.message` de driver ou fornecedor; o erro 500 registra só o id da requisição, método, rota sem ids, nome e código do erro.

## Consequências

- Retenção automática, exportação dos dados do titular e `/termos` ficam para depois do campo; até lá a retenção é "até o pedido de exclusão" e os backups giram em 14 dias.
- O link de privacidade depende de `PUBLIC_ORIGIN`, por isso a instância Postgres não sobe sem ele nem sem `PRIVACY_CONTACT`.
- O aviso ao cliente só é marcado como dado no registro do cliente em Postgres; no SQLite de desenvolvimento ele se repete a cada nova conversa.

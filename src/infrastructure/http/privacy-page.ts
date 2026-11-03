export const PRIVACY_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Static text, no script. The draft notice stays visible until a lawyer reviews it.
export function renderPrivacyPage(input: { businessName?: string; contact?: string }): string {
  const business = input.businessName ? escapeHtml(input.businessName) : "a oficina";
  const contact = input.contact ? escapeHtml(input.contact) : "a própria oficina";
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Aviso de privacidade</title>
    <style>
      :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #14213d; background: #f4f7fb; }
      body { margin: 0; padding: 24px; }
      main { max-width: 720px; margin: 0 auto; padding: 24px 28px; background: #fff; border: 1px solid #dce7f5; border-radius: 16px; line-height: 1.6; }
      .draft { padding: 12px 14px; border-radius: 10px; background: #fff4d6; border: 1px solid #e8c766; font-weight: 700; }
      h1 { font-size: 1.6rem; }
      h2 { margin-top: 28px; font-size: 1.1rem; }
    </style>
  </head>
  <body>
    <main>
      <p class="draft">Minuta sujeita a revisão jurídica.</p>
      <h1>Aviso de privacidade</h1>
      <p>Este aviso explica como ${business} trata os seus dados quando você conversa com o assistente virtual de atendimento pelo WhatsApp.</p>

      <h2>Dados que coletamos</h2>
      <p>O texto das mensagens que você envia, o seu número de telefone e o nome de perfil do WhatsApp. Quando você informa, também o seu nome, o veículo (marca, modelo, ano, placa) e o serviço ou peça que procura. Áudios e imagens não são lidos pelo assistente.</p>

      <h2>Para que usamos</h2>
      <p>Para responder ao seu atendimento: entender o pedido, preparar orçamentos, agendar o serviço e, quando necessário, passar a conversa a uma pessoa da oficina. Também usamos dados sem identificação direta para medir a qualidade do atendimento.</p>

      <h2>Com quem compartilhamos</h2>
      <p>O texto das suas mensagens é enviado a um provedor de inteligência artificial para que o assistente entenda o pedido e redija a resposta. Antes do envio, telefones, e-mails, CPF, CNPJ e números de cartão são substituídos por marcadores. A conversa trafega pelo WhatsApp, que é operado pela Meta e tem política própria. Não vendemos os seus dados.</p>

      <h2>Por quanto tempo guardamos</h2>
      <p>Pelo tempo necessário ao atendimento e às obrigações legais da oficina, ou até você pedir a exclusão. Cópias de segurança são mantidas por até 14 dias e depois descartadas.</p>

      <h2>Seus direitos</h2>
      <p>Você pode pedir confirmação de que tratamos os seus dados, acesso, correção, anonimização, exclusão, informação sobre o compartilhamento e a revogação do consentimento, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018).</p>

      <h2>Contato</h2>
      <p>Para exercer seus direitos ou tirar dúvidas, fale com ${contact}.</p>
    </main>
  </body>
</html>`;
}

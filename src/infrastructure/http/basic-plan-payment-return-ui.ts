export function renderBasicPlanPaymentReturnUi(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Atendente 24h | Retorno do pagamento</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f7fb; color: #14213d; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: linear-gradient(145deg, #eef5ff, #f9fbff); }
      main { width: min(100%, 560px); padding: clamp(28px, 7vw, 56px); border: 1px solid #dce7f5; border-radius: 24px; background: #fff; box-shadow: 0 18px 50px rgb(36 73 125 / 12%); text-align: center; }
      .brand { display: inline-flex; align-items: center; gap: 10px; color: #1769aa; font-size: 1.15rem; font-weight: 800; letter-spacing: .01em; }
      .mark { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; color: #fff; background: #1769aa; }
      h1 { margin: 28px 0 14px; font-size: clamp(1.55rem, 5vw, 2.15rem); line-height: 1.15; }
      p { margin: 0 auto 12px; max-width: 42ch; color: #53627a; font-size: 1rem; line-height: 1.6; }
      .note { margin-top: 24px; padding: 14px 16px; border-radius: 14px; color: #31506f; background: #edf6ff; font-size: .95rem; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark" aria-hidden="true">A</span><span>Atendente 24h</span></div>
      <h1>Você retornou ao sistema</h1>
      <p>Recebemos seu retorno do Mercado Pago.</p>
      <p>A confirmação do pagamento será processada com segurança. Aguarde a atualização do seu atendimento.</p>
      <p class="note">Esta página não confirma aprovação, assinatura ou implantação. Não é necessário reenviar a solicitação.</p>
    </main>
  </body>
</html>`;
}

'use strict';

const { escapeHtml } = require('../utils');

function formatBr(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-');
  if (p.length !== 3) return iso;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function licencaPage({ valida, dias, ate, erro, logado, csrfToken }) {
  const vencido = !valida;
  const statusHtml = vencido
    ? `<div class="status status-vencido">
         <div class="status-titulo">Período de uso encerrado</div>
         <div class="status-sub">O acesso ao sistema está bloqueado. Informe o código de liberação fornecido para voltar a usar.</div>
       </div>`
    : `<div class="status status-ok">
         <div class="status-titulo">Acesso liberado até ${formatBr(ate)}</div>
         <div class="status-sub">${dias <= 0 ? 'Vence hoje.' : 'Faltam ' + dias + (dias === 1 ? ' dia' : ' dias') + '.'} Você pode inserir um novo código para renovar.</div>
       </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Licença · Golden SaaS</title>
  <link rel="icon" type="image/png" href="/icon-192.png">
  <style>
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#111; color:#eee; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
    .card { background:#1c1c1c; border:1px solid #333; border-radius:14px; padding:28px 26px; max-width:440px; width:100%; }
    .brand { font-weight:800; font-size:22px; letter-spacing:.5px; margin-bottom:4px; }
    .brand span { color:#d4a017; }
    .sub { color:#9a9a9a; font-size:13px; margin-bottom:20px; }
    .status { border-radius:10px; padding:14px 16px; margin-bottom:20px; }
    .status-vencido { background:#3a1f1a; border:1px solid #6b3328; }
    .status-ok { background:#1f3324; border:1px solid #2f6b3a; }
    .status-titulo { font-weight:700; font-size:16px; margin-bottom:4px; }
    .status-sub { font-size:13px; color:#cdcdcd; }
    label { display:block; font-size:13px; margin-bottom:6px; color:#cfcfcf; }
    input[type=text] { width:100%; padding:12px 14px; border-radius:8px; border:1px solid #444; background:#111; color:#fff; font-size:16px; letter-spacing:1px; text-transform:uppercase; }
    button { width:100%; margin-top:14px; padding:12px; border:none; border-radius:8px; background:#d4a017; color:#111; font-weight:700; font-size:15px; cursor:pointer; }
    .erro { background:#4a1f1a; border:1px solid #7a2f22; color:#ffd9d2; padding:10px 12px; border-radius:8px; font-size:13px; margin-bottom:16px; }
    .rodape { margin-top:18px; font-size:12px; color:#777; text-align:center; }
    a { color:#d4a017; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">Golden<span>SaaS</span></div>
    <div class="sub">Controle de licença</div>
    ${erro ? `<div class="erro">${escapeHtml(erro)}</div>` : ''}
    ${statusHtml}
    <form method="POST" action="/licenca">
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken || '')}">
      <label for="codigo">Código de liberação</label>
      <input type="text" id="codigo" name="codigo" placeholder="GS-AAAAMMDD-XXXXXXXX" autocomplete="off" autofocus>
      <button type="submit">Liberar acesso</button>
    </form>
    <div class="rodape">
      ${logado ? '<a href="/">← Voltar ao sistema</a>' : 'Entre em contato com o fornecedor para obter o código.'}
    </div>
  </div>
</body>
</html>`;
}

module.exports = { licencaPage };

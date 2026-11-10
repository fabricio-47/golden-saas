'use strict';

const { escapeHtml } = require('../utils');

// Página pública (sem login) onde o funcionário valida o convite e cria a
// própria senha. Layout próprio e enxuto, parecido com o login.
function convitePage({ nome, email, token, erro }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Criar acesso · Golden SaaS</title>
  <style>
    body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#111;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#222;}
    .card{background:#fff;border-radius:14px;max-width:420px;width:100%;padding:32px;box-shadow:0 10px 40px rgba(0,0,0,0.4);}
    h1{margin:0 0 4px;font-size:22px;}
    h1 span{color:#c9a227;}
    .sub{color:#666;font-size:14px;margin-bottom:20px;}
    label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px;}
    input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #ccc;border-radius:8px;font-size:15px;}
    button{width:100%;margin-top:22px;padding:12px;background:#c9a227;color:#111;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;}
    .erro{background:#fde8e6;color:#a1352a;padding:10px 12px;border-radius:8px;font-size:14px;margin-bottom:12px;}
    .muted{color:#888;font-size:12px;margin-top:14px;}
  </style>
</head>
<body>
  <div class="card">
    <h1>Golden<span>SaaS</span></h1>
    <div class="sub">Criar seu acesso ao sistema</div>
    ${erro ? `<div class="erro">${escapeHtml(erro)}</div>` : ''}
    <p>Olá, <strong>${escapeHtml(nome || '')}</strong>! Confirme seu e-mail e crie uma senha para acessar o Golden SaaS.</p>
    <form method="POST" action="/convite/${escapeHtml(token)}">
      <label for="email">Seu e-mail</label>
      <input type="email" id="email" name="email" value="${escapeHtml(email || '')}" required>
      <label for="senha">Crie uma senha</label>
      <input type="password" id="senha" name="senha" required minlength="6" autocomplete="new-password" placeholder="Mínimo 6 caracteres">
      <label for="senha2">Repita a senha</label>
      <input type="password" id="senha2" name="senha2" required minlength="6" autocomplete="new-password">
      <button type="submit">Criar meu acesso</button>
    </form>
    <p class="muted">Este link é pessoal e vale por tempo limitado. Se não foi você que pediu, ignore.</p>
  </div>
</body>
</html>`;
}

module.exports = { convitePage };

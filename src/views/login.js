'use strict';

const { loginLayout } = require('./layout');

function loginPage({ error, email, sucesso } = {}) {
  return loginLayout({
    title: 'Entrar',
    error,
    children: `
      ${sucesso ? `<div style="background:#e7f6ec;color:#1f6b3a;padding:11px 13px;border-radius:8px;font-size:14px;margin-bottom:14px;">${sucesso.replace(/</g, '&lt;')}</div>` : ''}
      <form method="POST" action="/login">
        <div class="field">
          <label for="email">E-mail</label>
          <input type="email" id="email" name="email" value="${email ? email.replace(/"/g, '&quot;') : ''}" required autofocus>
        </div>
        <div class="field">
          <label for="password">Senha</label>
          <input type="password" id="password" name="password" required>
        </div>
        <button class="btn" type="submit" style="width:100%;">Entrar</button>
      </form>
      <p class="hint">Acesso de demonstração:<br>admin@goldensaas.com / golden123</p>
    `,
  });
}

module.exports = { loginPage };

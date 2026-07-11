'use strict';

const { loginLayout } = require('./layout');

function loginPage({ error, email } = {}) {
  return loginLayout({
    title: 'Entrar',
    error,
    children: `
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

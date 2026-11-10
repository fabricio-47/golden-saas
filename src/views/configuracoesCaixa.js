'use strict';

const { layout } = require('./layout');

function configCaixaPage({ user, flash, senhaConfigurada, csrfToken }) {
  const statusBadge = senhaConfigurada
    ? '<span class="badge badge-ok">Senha configurada</span>'
    : '<span class="badge badge-desativada">Sem senha definida</span>';

  return layout({
    title: 'Caixa',
    activeNav: 'config-caixa',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Caixa</h1>
          <p class="subtitle">Senha usada pelo caixa para dar baixa (confirmar o pagamento) de uma venda</p>
        </div>
        <div style="margin-top:4px;">${statusBadge}</div>
      </div>

      <div class="card">
        <p class="muted" style="margin-top:0;">
          O vendedor lança a venda, mas ela fica <strong>"Aguardando pagamento"</strong>. Só o caixa confirma o
          recebimento clicando em <strong>"Dar baixa"</strong> na venda e digitando esta senha. Guarde a senha com quem
          é responsável pelo caixa. ${senhaConfigurada ? '' : '<strong>Enquanto não houver senha, a baixa é feita sem exigir senha.</strong>'}
        </p>
      </div>

      <div class="card">
        <form method="POST" action="/configuracoes/caixa">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="senha">${senhaConfigurada ? 'Nova senha do caixa' : 'Definir senha do caixa'}</label>
              <input type="password" id="senha" name="senha" autocomplete="new-password" required minlength="4" placeholder="Mínimo 4 caracteres">
            </div>
            <div class="field">
              <label for="senha2">Repetir a senha</label>
              <input type="password" id="senha2" name="senha2" autocomplete="new-password" required minlength="4">
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${senhaConfigurada ? 'Trocar senha do caixa' : 'Salvar senha do caixa'}</button>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { configCaixaPage };

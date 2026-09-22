'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate } = require('../utils');

function auditoriaPage({ user, flash, logs }) {
  const rows = logs
    .map(
      (l) => `
    <tr>
      <td>${formatDate(l.created_at)}</td>
      <td>${escapeHtml(l.user_name || '-')}</td>
      <td>${escapeHtml(l.email_tentativo || '-')}</td>
      <td>${l.sucesso ? '<span class="badge badge-ok">Sucesso</span>' : '<span class="badge badge-atencao">Falhou</span>'}</td>
      <td>${escapeHtml(l.ip || '-')}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Auditoria de login',
    activeNav: 'auditoria',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Auditoria de login</h1>
          <p class="subtitle">Últimas tentativas de acesso ao sistema (sucesso e falha)</p>
        </div>
      </div>
      <div class="card">
        ${
          logs.length
            ? `<table><thead><tr><th>Data/hora</th><th>Usuário</th><th>E-mail usado</th><th>Resultado</th><th>IP</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhum acesso registrado ainda.</div>'
        }
      </div>
    `,
  });
}

module.exports = { auditoriaPage };

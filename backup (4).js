'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate, formatBytes } = require('../utils');

function backupPage({ user, flash, csrfToken, state, emailIsConfigured, recipients }) {
  const s = state || {};

  const statusHtml = s.lastAutoBackupAt
    ? `<p><strong>Último backup automático:</strong> ${formatDate(s.lastAutoBackupAt)} — ${formatBytes(s.lastAutoBackupSizeBytes)}</p>
       <p><strong>Envio por e-mail:</strong> ${
         s.lastAutoBackupEmailed
           ? '<span class="badge badge-ok">Enviado com sucesso</span>'
           : s.lastAutoBackupEmailError
           ? `<span class="badge badge-atencao">Falhou: ${escapeHtml(s.lastAutoBackupEmailError)}</span>`
           : '<span class="muted">Não enviado (e-mail não configurado)</span>'
       }</p>`
    : '<p class="muted">Ainda não rodou nenhum backup automático nesta instalação. O primeiro roda sozinho em até 1 hora depois do servidor iniciar, ou você pode forçar agora com o botão abaixo.</p>';

  const manualStatusHtml = s.lastManualBackupAt
    ? `<p class="muted">Último backup completo baixado em: ${formatDate(s.lastManualBackupAt)}</p>`
    : '';

  const emailWarningHtml = !emailIsConfigured
    ? `<div class="flash flash-error">O envio de e-mail não está configurado (variáveis <code>BREVO_API_KEY</code> e <code>EMAIL_FROM</code>), então o backup automático diário fica salvo só no disco do servidor, sem cópia enviada por e-mail. Veja o passo a passo no README pra configurar.</div>`
    : !recipients || !recipients.length
    ? `<div class="flash flash-error">Não há nenhum usuário de Direção ativo com e-mail cadastrado, então não há pra quem enviar o backup automático por e-mail. Cadastre um e-mail no seu usuário em Configurações → Usuários.</div>`
    : '';

  return layout({
    title: 'Backup',
    activeNav: 'backup',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Backup</h1>
          <p class="subtitle">Cópias de segurança dos dados do sistema</p>
        </div>
      </div>

      ${emailWarningHtml}

      <div class="card">
        <h2>Backup automático diário</h2>
        <p class="muted">Todo dia, o sistema tira uma cópia de segurança do banco de dados (clientes, veículos, O.S., estoque, financeiro, vendas etc.) e guarda no servidor${emailIsConfigured && recipients && recipients.length ? `, além de mandar por e-mail para: ${recipients.map(escapeHtml).join(', ')}` : ''}. Fotos e vídeos não entram nesse backup automático (ficam grandes demais pra e-mail) — pra isso, use o backup completo abaixo.</p>
        ${statusHtml}
        <form method="POST" action="/backup/executar" style="margin-top:16px;">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <button class="btn" type="submit">Fazer backup agora</button>
        </form>
      </div>

      <div class="card">
        <h2>Backup completo (com fotos e vídeos)</h2>
        <p class="muted">Baixa um arquivo .zip com tudo: banco de dados + todas as fotos e vídeos enviados no sistema. Pode demorar um pouco pra gerar, dependendo de quantos arquivos existirem. Recomendado baixar periodicamente e guardar num lugar seguro (seu computador, Google Drive etc.).</p>
        ${manualStatusHtml}
        <a class="btn btn-secondary" href="/backup/baixar" style="margin-top:8px;display:inline-block;">⬇ Baixar backup completo (.zip)</a>
      </div>
    `,
  });
}

module.exports = { backupPage };

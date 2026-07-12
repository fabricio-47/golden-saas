'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate, formatMoney } = require('../utils');

const STATUS_LABELS = {
  pendente_aprovacao: 'Aguardando aprovação',
  em_transito: 'Em trânsito',
  recebida: 'Recebida',
  recusada: 'Recusada',
};

const STATUS_BADGE_CLASS = {
  pendente_aprovacao: 'atencao',
  em_transito: 'execucao',
  recebida: 'ok',
  recusada: 'desativada',
};

function transferenciaActions(t, user, csrfToken) {
  const podeAprovar = t.status === 'pendente_aprovacao' && user.__canManage;
  const podeConfirmarRecebimento =
    t.status === 'em_transito' && (user.__canManage || String(user.loja_id) === String(t.loja_destino_id));

  const botoes = [];
  if (podeAprovar) {
    botoes.push(`
      <form method="POST" action="/transferencias/${t.id}/aprovar" onsubmit="return confirm('Aprovar esta transferência? A quantidade sai do estoque da loja de origem agora.');" style="display:inline;">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <button class="btn btn-sm" type="submit">Aprovar</button>
      </form>`);
    botoes.push(`
      <form method="POST" action="/transferencias/${t.id}/recusar" onsubmit="return confirm('Recusar esta transferência?');" style="display:inline;">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <button class="btn btn-sm btn-danger" type="submit">Recusar</button>
      </form>`);
  }
  if (podeConfirmarRecebimento) {
    botoes.push(`
      <form method="POST" action="/transferencias/${t.id}/confirmar-recebimento" onsubmit="return confirm('Confirmar que a mercadoria chegou na loja e já pode entrar no estoque?');" style="display:inline;">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <button class="btn btn-sm" type="submit">✔ OK, mercadoria recebida</button>
      </form>`);
  }
  return botoes.join(' ') || '-';
}

function transferenciasListPage({ user, flash, transferencias, csrfToken }) {
  user.__canManage = user.role === 'direcao' || user.role === 'gerencia';

  const rows = transferencias
    .map(
      (t) => `
    <tr>
      <td>${escapeHtml(t.nome_peca)}</td>
      <td>${t.quantidade}</td>
      <td>${escapeHtml(t.loja_origem_nome)} → ${escapeHtml(t.loja_destino_nome)}</td>
      <td><span class="badge badge-${STATUS_BADGE_CLASS[t.status] || 'atencao'}">${STATUS_LABELS[t.status] || t.status}</span></td>
      <td>${escapeHtml(t.solicitante_nome || '-')}</td>
      <td>${formatDate(t.created_at)}</td>
      <td>${transferenciaActions(t, user, csrfToken)}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Transferências entre lojas',
    activeNav: 'transferencias',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Transferências entre lojas</h1>
          <p class="subtitle">Peças enviadas de uma loja para outra — aprovação da Gerência/Direção e confirmação de recebimento pela loja destino</p>
        </div>
      </div>
      <div class="card">
        ${
          transferencias.length
            ? `<table><thead><tr><th>Peça</th><th>Qtd.</th><th>Rota</th><th>Status</th><th>Solicitado por</th><th>Data</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhuma transferência registrada ainda.</div>'
        }
      </div>
    `,
  });
}

function transferenciaFormPage({ user, flash, peca, lojasDestino, csrfToken }) {
  const lojaOptions = lojasDestino
    .map((l) => `<option value="${l.id}">${escapeHtml(l.nome)}</option>`)
    .join('');

  return layout({
    title: `Transferir ${peca.nome}`,
    activeNav: 'transferencias',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Solicitar transferência</h1>
          <p class="subtitle">${escapeHtml(peca.nome)} — estoque atual na loja de origem: ${peca.quantidade} un. (${formatMoney(peca.preco_venda)} cada)</p>
        </div>
      </div>
      <div class="card">
        <form method="POST" action="/transferencias">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <input type="hidden" name="peca_id" value="${peca.id}">
          <div class="form-grid">
            <div class="field">
              <label for="quantidade">Quantidade a transferir *</label>
              <input type="number" id="quantidade" name="quantidade" min="1" max="${peca.quantidade}" step="1" value="1" required>
            </div>
            <div class="field">
              <label for="loja_destino_id">Loja destino *</label>
              <select id="loja_destino_id" name="loja_destino_id" required>
                <option value="">Selecione...</option>
                ${lojaOptions}
              </select>
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes"></textarea>
            </div>
          </div>
          <p class="muted">A transferência só sai do estoque da loja de origem depois que a Direção ou Gerência aprovar. A loja destino precisa confirmar o recebimento pra entrar no estoque de lá.</p>
          <div class="actions-row">
            <button class="btn" type="submit">Solicitar transferência</button>
            <a class="btn btn-secondary" href="/estoque">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { transferenciasListPage, transferenciaFormPage, STATUS_LABELS };

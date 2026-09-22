'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDateOnly } = require('../utils');

const STATUS_LABELS = { pendente: 'Pendente', pago: 'Pago' };

function isAtrasada(conta) {
  if (conta.status !== 'pendente' || !conta.vencimento) return false;
  const hoje = new Date().toISOString().slice(0, 10);
  return conta.vencimento < hoje;
}

function contaPagarStatusBadge(conta) {
  if (conta.status === 'pago') return '<span class="badge badge-ok">Pago</span>';
  if (isAtrasada(conta)) return '<span class="badge badge-atencao">Atrasada</span>';
  return '<span class="badge" style="background:#fde8d8;color:var(--warn);">Pendente</span>';
}

function contasPagarListPage({ user, flash, contas, csrfToken, lojas, lojaFiltroId, mostrarColunaLoja, statusFilter }) {
  const rows = contas
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.descricao)}${c.fornecedor_nome ? `<div class="muted">Fornecedor: ${escapeHtml(c.fornecedor_nome)}</div>` : ''}</td>
      ${mostrarColunaLoja ? `<td>${c.loja_nome ? escapeHtml(c.loja_nome) : '<span class="muted">Geral</span>'}</td>` : ''}
      <td>${formatDateOnly(c.vencimento)}</td>
      <td>${formatMoney(c.valor)}</td>
      <td>${contaPagarStatusBadge(c)}</td>
      <td>
        <div class="actions-row" style="margin:0;gap:8px;">
          ${c.__podeEditar ? `<a class="btn btn-sm btn-secondary" href="/contas-pagar/${c.id}/editar">Editar</a>` : ''}
          ${
            c.__podeEditar
              ? c.status === 'pendente'
                ? `<form method="POST" action="/contas-pagar/${c.id}/marcar-pago"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm" type="submit">Marcar como pago</button></form>`
                : `<form method="POST" action="/contas-pagar/${c.id}/reabrir"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-secondary" type="submit">Reabrir</button></form>`
              : ''
          }
          ${
            c.__podeEditar
              ? `<form method="POST" action="/contas-pagar/${c.id}/excluir" onsubmit="return confirm('Excluir esta conta a pagar?');"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-danger" type="submit">Excluir</button></form>`
              : ''
          }
        </div>
      </td>
    </tr>`
    )
    .join('');

  const filterLink = (value, label) =>
    `<a class="btn btn-sm ${statusFilter === value ? 'btn' : 'btn-secondary'}" href="/contas-pagar${value ? `?status=${value}` : ''}">${label}</a>`;

  const lojaFilterHtml =
    lojas && lojas.length > 1
      ? `<form method="GET" action="/contas-pagar" class="actions-row" style="margin-top:0;margin-bottom:20px;">
          ${statusFilter ? `<input type="hidden" name="status" value="${escapeHtml(statusFilter)}">` : ''}
          <select name="loja_id" onchange="this.form.submit()">
            <option value="">Todas as lojas que posso ver</option>
            ${lojas.map((l) => `<option value="${l.id}" ${String(lojaFiltroId) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
          </select>
        </form>`
      : '';

  return layout({
    title: 'Contas a Pagar',
    activeNav: 'contas-pagar',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Contas a Pagar</h1>
          <p class="subtitle">Despesas e pagamentos a fornecedores</p>
        </div>
        <a class="btn" href="/contas-pagar/novo">+ Nova Conta a Pagar</a>
      </div>
      <div class="actions-row" style="margin-top:0;margin-bottom:20px;">
        ${filterLink('', 'Todas')}
        ${filterLink('pendente', 'Pendentes')}
        ${filterLink('pago', 'Pagas')}
      </div>
      ${lojaFilterHtml}
      <div class="card">
        ${
          contas.length
            ? `<table>
          <thead><tr><th>Descrição</th>${mostrarColunaLoja ? '<th>Loja</th>' : ''}<th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma conta a pagar encontrada.</div>'
        }
      </div>
    `,
  });
}

function contaPagarFormPage({ user, flash, conta, csrfToken, lojas, lojaFixaNome, fornecedores }) {
  const isEdit = !!conta;

  const lojaFieldHtml = lojaFixaNome
    ? `<div class="field">
        <label>Loja</label>
        <input type="text" value="${escapeHtml(lojaFixaNome)}" disabled>
      </div>`
    : `<div class="field">
        <label for="loja_id">Loja</label>
        <select id="loja_id" name="loja_id">
          <option value="">Geral (não vinculada a uma loja específica)</option>
          ${lojas.map((l) => `<option value="${l.id}" ${conta && String(conta.loja_id) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
        </select>
      </div>`;

  const fornecedorOptions = fornecedores
    .map((f) => `<option value="${f.id}" ${conta && String(conta.fornecedor_id) === String(f.id) ? 'selected' : ''}>${escapeHtml(f.nome)}</option>`)
    .join('');

  const semLojaAtivaHtml =
    !lojaFixaNome && lojas.length === 0
      ? `<div class="flash flash-error">Não há nenhuma loja ativa cadastrada, então o campo Loja só vai mostrar "Geral". <a class="link-btn" href="/lojas">Cadastre ou reative uma loja em Configurações → Lojas</a>, se quiser vincular esta conta a uma loja específica.</div>`
      : '';

  return layout({
    title: isEdit ? 'Editar conta a pagar' : 'Nova conta a pagar',
    activeNav: 'contas-pagar',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar conta a pagar' : 'Nova conta a pagar'}</h1></div></div>
      ${semLojaAtivaHtml}
      <div class="card">
        <form method="POST" action="${isEdit ? `/contas-pagar/${conta.id}` : '/contas-pagar'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="descricao">Descrição *</label>
              <input type="text" id="descricao" name="descricao" required value="${escapeHtml(conta ? conta.descricao : '')}" placeholder="Ex: Conta de energia, compra de peças, aluguel...">
            </div>
            <div class="field">
              <label for="valor">Valor (R$) *</label>
              <input type="number" id="valor" name="valor" min="0" step="0.01" required value="${conta ? conta.valor : ''}">
            </div>
            <div class="field">
              <label for="vencimento">Vencimento</label>
              <input type="date" id="vencimento" name="vencimento" value="${conta && conta.vencimento ? conta.vencimento : ''}">
            </div>
            <div class="field">
              <label for="fornecedor_id">Fornecedor</label>
              <select id="fornecedor_id" name="fornecedor_id">
                <option value="">Nenhum</option>
                ${fornecedorOptions}
              </select>
            </div>
            <div class="field">
              <label for="forma_pagamento">Forma de pagamento</label>
              <input type="text" id="forma_pagamento" name="forma_pagamento" value="${escapeHtml(conta ? conta.forma_pagamento : '')}" placeholder="Ex: Boleto, Pix, transferência...">
            </div>
            ${lojaFieldHtml}
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes">${escapeHtml(conta ? conta.observacoes : '')}</textarea>
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar conta'}</button>
            <a class="btn btn-secondary" href="/contas-pagar">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { contasPagarListPage, contaPagarFormPage, STATUS_LABELS };

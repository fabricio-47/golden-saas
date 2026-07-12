'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDateOnly } = require('../utils');

const STATUS_LABELS = { pendente: 'Pendente', recebido: 'Recebido' };

function isAtrasada(conta) {
  if (conta.status !== 'pendente' || !conta.vencimento) return false;
  const hoje = new Date().toISOString().slice(0, 10);
  return conta.vencimento < hoje;
}

function contaReceberStatusBadge(conta) {
  if (conta.status === 'recebido') return '<span class="badge badge-ok">Recebido</span>';
  if (isAtrasada(conta)) return '<span class="badge badge-atencao">Atrasada</span>';
  return '<span class="badge" style="background:#fde8d8;color:var(--warn);">Pendente</span>';
}

function contasReceberListPage({ user, flash, contas, csrfToken, lojas, lojaFiltroId, mostrarColunaLoja, statusFilter }) {
  const rows = contas
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.descricao)}
        ${c.cliente_nome ? `<div class="muted">Cliente: ${escapeHtml(c.cliente_nome)}</div>` : ''}
        ${c.ordem_servico_id ? `<div class="muted">Parcela ${c.numero_parcela}/${c.total_parcelas} da <a class="link-btn" href="/os/${c.ordem_servico_id}">${escapeHtml(c.os_numero || 'O.S.')}</a></div>` : ''}
        ${c.venda_id ? `<div class="muted">Parcela ${c.numero_parcela}/${c.total_parcelas} da <a class="link-btn" href="/vendas/${c.venda_id}">${escapeHtml(c.venda_numero || 'Venda')}</a></div>` : ''}
      </td>
      ${mostrarColunaLoja ? `<td>${c.loja_nome ? escapeHtml(c.loja_nome) : '<span class="muted">Geral</span>'}</td>` : ''}
      <td>${formatDateOnly(c.vencimento)}</td>
      <td>${formatMoney(c.valor)}</td>
      <td>${contaReceberStatusBadge(c)}</td>
      <td>
        <div class="actions-row" style="margin:0;gap:8px;">
          ${c.__podeEditar ? `<a class="btn btn-sm btn-secondary" href="/contas-receber/${c.id}/editar">Editar</a>` : ''}
          ${
            c.__podeEditar
              ? c.status === 'pendente'
                ? `<form method="POST" action="/contas-receber/${c.id}/marcar-recebido"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm" type="submit">Marcar como recebido</button></form>`
                : `<form method="POST" action="/contas-receber/${c.id}/reabrir"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-secondary" type="submit">Reabrir</button></form>`
              : ''
          }
          ${
            c.__podeEditar
              ? `<form method="POST" action="/contas-receber/${c.id}/excluir" onsubmit="return confirm('Excluir esta conta a receber?');"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="btn btn-sm btn-danger" type="submit">Excluir</button></form>`
              : ''
          }
        </div>
      </td>
    </tr>`
    )
    .join('');

  const filterLink = (value, label) =>
    `<a class="btn btn-sm ${statusFilter === value ? 'btn' : 'btn-secondary'}" href="/contas-receber${value ? `?status=${value}` : ''}">${label}</a>`;

  const lojaFilterHtml =
    lojas && lojas.length > 1
      ? `<form method="GET" action="/contas-receber" class="actions-row" style="margin-top:0;margin-bottom:20px;">
          ${statusFilter ? `<input type="hidden" name="status" value="${escapeHtml(statusFilter)}">` : ''}
          <select name="loja_id" onchange="this.form.submit()">
            <option value="">Todas as lojas que posso ver</option>
            ${lojas.map((l) => `<option value="${l.id}" ${String(lojaFiltroId) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
          </select>
        </form>`
      : '';

  return layout({
    title: 'Contas a Receber',
    activeNav: 'contas-receber',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Contas a Receber</h1>
          <p class="subtitle">Valores a receber de clientes — incluindo parcelas geradas automaticamente por O.S. no crédito</p>
        </div>
        <a class="btn" href="/contas-receber/novo">+ Nova Conta a Receber</a>
      </div>
      <div class="actions-row" style="margin-top:0;margin-bottom:20px;">
        ${filterLink('', 'Todas')}
        ${filterLink('pendente', 'Pendentes')}
        ${filterLink('recebido', 'Recebidas')}
      </div>
      ${lojaFilterHtml}
      <div class="card">
        ${
          contas.length
            ? `<table>
          <thead><tr><th>Descrição</th>${mostrarColunaLoja ? '<th>Loja</th>' : ''}<th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma conta a receber encontrada.</div>'
        }
      </div>
    `,
  });
}

function contaReceberFormPage({ user, flash, conta, csrfToken, lojas, lojaFixaNome, clientes }) {
  const isEdit = !!conta;
  const geradaPorOs = isEdit && !!conta.ordem_servico_id;
  const geradaPorVenda = isEdit && !!conta.venda_id;

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

  const clienteOptions = clientes
    .map((c) => `<option value="${c.id}" ${conta && String(conta.cliente_id) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`)
    .join('');

  return layout({
    title: isEdit ? 'Editar conta a receber' : 'Nova conta a receber',
    activeNav: 'contas-receber',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar conta a receber' : 'Nova conta a receber'}</h1></div></div>
      ${
        geradaPorOs
          ? `<div class="flash flash-success">Esta conta foi gerada automaticamente pela Ordem de Serviço <a class="link-btn" href="/os/${conta.ordem_servico_id}">${escapeHtml(conta.os_numero || '')}</a> (parcela ${conta.numero_parcela} de ${conta.total_parcelas}).</div>`
          : ''
      }
      ${
        geradaPorVenda
          ? `<div class="flash flash-success">Esta conta foi gerada automaticamente pela Venda <a class="link-btn" href="/vendas/${conta.venda_id}">${escapeHtml(conta.venda_numero || '')}</a> (parcela ${conta.numero_parcela} de ${conta.total_parcelas}).</div>`
          : ''
      }
      <div class="card">
        <form method="POST" action="${isEdit ? `/contas-receber/${conta.id}` : '/contas-receber'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="descricao">Descrição *</label>
              <input type="text" id="descricao" name="descricao" required value="${escapeHtml(conta ? conta.descricao : '')}" placeholder="Ex: Parcela de venda, serviço a prazo...">
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
              <label for="cliente_id">Cliente</label>
              <select id="cliente_id" name="cliente_id">
                <option value="">Nenhum</option>
                ${clienteOptions}
              </select>
            </div>
            ${lojaFieldHtml}
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes">${escapeHtml(conta ? conta.observacoes : '')}</textarea>
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar conta'}</button>
            <a class="btn btn-secondary" href="/contas-receber">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { contasReceberListPage, contaReceberFormPage, STATUS_LABELS };

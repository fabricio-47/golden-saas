'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney } = require('../utils');

const CATEGORIAS_SUGERIDAS = [
  'Bateria',
  'Controladora',
  'Motor',
  'Freios',
  'Pneus e câmaras',
  'Elétrica / Fiação',
  'Transmissão',
  'Outro',
];

function estoqueBadge(peca) {
  if (peca.quantidade <= 0) return '<span class="badge badge-atencao">Sem estoque</span>';
  if (peca.quantidade <= peca.estoque_minimo) return '<span class="badge" style="background:#fde8d8;color:var(--warn);">Estoque baixo</span>';
  return '<span class="badge badge-ok">OK</span>';
}

function pecasListPage({ user, flash, pecas, csrfToken }) {
  const rows = pecas
    .map(
      (p) => `
    <tr>
      <td><a class="link-btn" href="/estoque/${p.id}/editar">${escapeHtml(p.nome)}</a>${p.numero_serie ? `<div class="muted">Série: ${escapeHtml(p.numero_serie)}</div>` : ''}</td>
      <td>${escapeHtml(p.categoria || '-')}</td>
      <td>${p.quantidade}</td>
      <td>${estoqueBadge(p)}</td>
      <td>${p.custo_unitario !== null ? formatMoney(p.custo_unitario) : '-'}</td>
      <td>${formatMoney(p.preco_venda)}</td>
      <td>
        <div class="actions-row" style="margin:0;gap:8px;">
          <a class="btn btn-sm btn-secondary" href="/estoque/${p.id}/editar">Editar</a>
          <form method="POST" action="/estoque/${p.id}/excluir" onsubmit="return confirm('Excluir esta peça do estoque?');">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <button class="btn btn-sm btn-danger" type="submit">Excluir</button>
          </form>
        </div>
      </td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Estoque',
    activeNav: 'estoque',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Estoque de Peças</h1>
          <p class="subtitle">Controle de quantidade, custo e preço de venda das peças da oficina</p>
        </div>
        <a class="btn" href="/estoque/novo">+ Nova Peça</a>
      </div>
      <div class="card">
        ${
          pecas.length
            ? `<table>
          <thead><tr><th>Peça</th><th>Categoria</th><th>Qtd.</th><th>Situação</th><th>Custo</th><th>Preço de venda</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma peça cadastrada ainda. <a class="link-btn" href="/estoque/novo">Cadastrar a primeira</a></div>'
        }
      </div>
    `,
  });
}

function pecaFormPage({ user, flash, peca, csrfToken }) {
  const isEdit = !!peca;
  const datalistOptions = CATEGORIAS_SUGERIDAS.map((c) => `<option value="${escapeHtml(c)}">`).join('');

  return layout({
    title: isEdit ? `Editar ${peca.nome}` : 'Nova Peça',
    activeNav: 'estoque',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${isEdit ? 'Editar peça' : 'Nova peça'}</h1>
          <p class="subtitle">Cadastro de peça no estoque</p>
        </div>
      </div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/estoque/${peca.id}` : '/estoque'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome da peça *</label>
              <input type="text" id="nome" name="nome" required value="${escapeHtml(peca ? peca.nome : '')}" placeholder="Ex: Pastilha de freio (par)">
            </div>
            <div class="field">
              <label for="categoria">Categoria</label>
              <input type="text" id="categoria" name="categoria" list="categorias-sugeridas" value="${escapeHtml(peca ? peca.categoria : '')}">
              <datalist id="categorias-sugeridas">${datalistOptions}</datalist>
            </div>
            <div class="field">
              <label for="numero_serie">Número de série (opcional)</label>
              <input type="text" id="numero_serie" name="numero_serie" value="${escapeHtml(peca ? peca.numero_serie : '')}" placeholder="Para peças rastreáveis, ex: baterias">
            </div>
            <div class="field">
              <label for="quantidade">Quantidade em estoque *</label>
              <input type="number" id="quantidade" name="quantidade" min="0" step="1" required value="${peca ? peca.quantidade : 0}">
            </div>
            <div class="field">
              <label for="estoque_minimo">Estoque mínimo (avisa quando chegar nesse valor)</label>
              <input type="number" id="estoque_minimo" name="estoque_minimo" min="0" step="1" value="${peca ? peca.estoque_minimo : 1}">
            </div>
            <div class="field">
              <label for="custo_unitario">Custo unitário — quanto você paga (R$)</label>
              <input type="number" id="custo_unitario" name="custo_unitario" min="0" step="0.01" value="${peca && peca.custo_unitario !== null ? peca.custo_unitario : ''}">
            </div>
            <div class="field">
              <label for="preco_venda">Preço de venda — quanto você cobra do cliente (R$) *</label>
              <input type="number" id="preco_venda" name="preco_venda" min="0" step="0.01" required value="${peca ? peca.preco_venda : ''}">
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes">${escapeHtml(peca ? peca.observacoes : '')}</textarea>
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar peça'}</button>
            <a class="btn btn-secondary" href="/estoque">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { pecasListPage, pecaFormPage, CATEGORIAS_SUGERIDAS };

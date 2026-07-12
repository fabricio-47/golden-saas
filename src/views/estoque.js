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

function pecasListPage({ user, flash, pecas, csrfToken, lojas, lojaFiltroId, mostrarColunaLoja }) {
  const rows = pecas
    .map(
      (p) => `
    <tr>
      <td><a class="link-btn" href="/estoque/${p.id}/editar">${escapeHtml(p.nome)}</a>${p.numero_serie ? `<div class="muted">Série: ${escapeHtml(p.numero_serie)}</div>` : ''}${p.fornecedor_nome ? `<div class="muted">Fornecedor: ${escapeHtml(p.fornecedor_nome)}</div>` : ''}</td>
      ${mostrarColunaLoja ? `<td>${escapeHtml(p.loja_nome || '-')}</td>` : ''}
      <td>${escapeHtml(p.categoria || '-')}</td>
      <td>${p.quantidade}</td>
      <td>${estoqueBadge(p)}</td>
      <td>${p.custo_unitario !== null ? formatMoney(p.custo_unitario) : '-'}</td>
      <td>${formatMoney(p.preco_venda)}</td>
      <td>
        <div class="actions-row" style="margin:0;gap:8px;">
          ${p.__podeEditar ? `<a class="btn btn-sm btn-secondary" href="/estoque/${p.id}/editar">Editar</a>` : ''}
          <a class="btn btn-sm btn-secondary" href="/transferencias/novo?peca_id=${p.id}">Transferir</a>
          ${
            p.__podeEditar
              ? `<form method="POST" action="/estoque/${p.id}/excluir" onsubmit="return confirm('Excluir esta peça do estoque?');">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <button class="btn btn-sm btn-danger" type="submit">Excluir</button>
          </form>`
              : ''
          }
        </div>
      </td>
    </tr>`
    )
    .join('');

  const lojaFilterHtml =
    lojas && lojas.length > 1
      ? `<form method="GET" action="/estoque" class="actions-row" style="margin-top:0;margin-bottom:20px;">
          <select name="loja_id" onchange="this.form.submit()">
            <option value="">Todas as lojas que posso ver</option>
            ${lojas.map((l) => `<option value="${l.id}" ${String(lojaFiltroId) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
          </select>
        </form>`
      : '';

  const totalPecas = pecas.length;
  const valorEstoque = pecas.reduce((sum, p) => sum + p.quantidade * (p.custo_unitario !== null && p.custo_unitario !== undefined ? p.custo_unitario : 0), 0);
  const estoqueBaixoCount = pecas.filter((p) => p.quantidade <= p.estoque_minimo).length;

  const statsHtml = `
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${totalPecas}</div><div class="label">Peças cadastradas${lojaFiltroId || (lojas && lojas.length > 1) ? ' (nesta visão)' : ''}</div></div>
        <div class="stat-card"><div class="num">${formatMoney(valorEstoque)}</div><div class="label">Valor em estoque (custo)</div></div>
        <div class="stat-card"><div class="num">${estoqueBaixoCount}</div><div class="label">Itens com estoque baixo ou zerado</div></div>
      </div>`;

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
      ${statsHtml}
      ${lojaFilterHtml}
      <div class="card">
        ${
          pecas.length
            ? `<table>
          <thead><tr><th>Peça</th>${mostrarColunaLoja ? '<th>Loja</th>' : ''}<th>Categoria</th><th>Qtd.</th><th>Situação</th><th>Custo</th><th>Preço de venda</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma peça cadastrada ainda. <a class="link-btn" href="/estoque/novo">Cadastrar a primeira</a></div>'
        }
      </div>
    `,
  });
}

function pecaFormPage({ user, flash, peca, csrfToken, lojas, lojaFixaNome, fornecedores }) {
  const isEdit = !!peca;
  const datalistOptions = CATEGORIAS_SUGERIDAS.map((c) => `<option value="${escapeHtml(c)}">`).join('');
  const fornecedorOptions = (fornecedores || [])
    .map((f) => `<option value="${f.id}" ${peca && String(peca.fornecedor_id) === String(f.id) ? 'selected' : ''}>${escapeHtml(f.nome)}</option>`)
    .join('');

  const lojaFieldHtml = lojaFixaNome
    ? `<div class="field">
        <label>Loja</label>
        <input type="text" value="${escapeHtml(lojaFixaNome)}" disabled>
        <p class="muted" style="margin-top:4px;">Você só pode cadastrar peças na sua própria loja. Pra levar estoque a outra loja, use "Transferir".</p>
      </div>`
    : `<div class="field">
        <label for="loja_id">Loja *</label>
        <select id="loja_id" name="loja_id" required>
          ${lojas.map((l) => `<option value="${l.id}" ${peca && peca.loja_id === l.id ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
        </select>
      </div>`;

  const semLojaAtivaHtml =
    !lojaFixaNome && lojas.length === 0
      ? `<div class="flash flash-error">Não há nenhuma loja ativa cadastrada. <a class="link-btn" href="/lojas">Cadastre ou reative uma loja em Configurações → Lojas</a> antes de cadastrar uma peça.</div>`
      : '';

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
      ${semLojaAtivaHtml}
      <div class="card">
        <form method="POST" action="${isEdit ? `/estoque/${peca.id}` : '/estoque'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome da peça *</label>
              <input type="text" id="nome" name="nome" required value="${escapeHtml(peca ? peca.nome : '')}" placeholder="Ex: Pastilha de freio (par)">
            </div>
            ${lojaFieldHtml}
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
            <div class="field">
              <label for="fornecedor_id">Fornecedor</label>
              <select id="fornecedor_id" name="fornecedor_id">
                <option value="">Nenhum</option>
                ${fornecedorOptions}
              </select>
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

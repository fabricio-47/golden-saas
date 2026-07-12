'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDate } = require('../utils');

const STATUS_LABELS = { aberta: 'Em aberto', concluida: 'Concluída' };

const FORMA_PAGAMENTO_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
};

function formaPagamentoLabel(venda) {
  if (!venda.forma_pagamento) return '-';
  const base = FORMA_PAGAMENTO_LABELS[venda.forma_pagamento] || venda.forma_pagamento;
  if (venda.forma_pagamento === 'credito' && venda.parcelas && venda.parcelas > 1) {
    return `${base} (${venda.parcelas}x)`;
  }
  return base;
}

function vendaStatusBadge(venda) {
  return venda.status === 'concluida'
    ? '<span class="badge badge-concluida">Concluída</span>'
    : '<span class="badge badge-execucao">Em aberto</span>';
}

function vendasListPage({ user, flash, vendas, lojas, lojaFiltroId, mostrarColunaLoja }) {
  const rows = vendas
    .map(
      (v) => `
    <tr>
      <td><a class="link-btn" href="/vendas/${v.id}">${escapeHtml(v.numero)}</a></td>
      <td>${escapeHtml(v.cliente_nome)}</td>
      ${mostrarColunaLoja ? `<td>${v.loja_nome ? escapeHtml(v.loja_nome) : '<span class="muted">Geral</span>'}</td>` : ''}
      <td>${formatMoney(v.valor_total)}</td>
      <td>${formaPagamentoLabel(v)}</td>
      <td>${vendaStatusBadge(v)}</td>
      <td>${formatDate(v.created_at)}</td>
    </tr>`
    )
    .join('');

  const lojaFilterHtml =
    lojas && lojas.length > 1
      ? `<form method="GET" action="/vendas" class="actions-row" style="margin-top:0;margin-bottom:20px;">
          <select name="loja_id" onchange="this.form.submit()">
            <option value="">Todas as lojas que posso ver</option>
            ${lojas.map((l) => `<option value="${l.id}" ${String(lojaFiltroId) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
          </select>
        </form>`
      : '';

  return layout({
    title: 'Venda Direto',
    activeNav: 'vendas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Venda Direto</h1>
          <p class="subtitle">Vendas de peças e produtos direto no balcão, sem precisar abrir uma Ordem de Serviço</p>
        </div>
        <a class="btn" href="/vendas/novo">+ Nova Venda</a>
      </div>
      ${lojaFilterHtml}
      <div class="card">
        ${
          vendas.length
            ? `<table>
          <thead><tr><th>Número</th><th>Cliente</th>${mostrarColunaLoja ? '<th>Loja</th>' : ''}<th>Valor</th><th>Pagamento</th><th>Status</th><th>Data</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma venda registrada ainda. <a class="link-btn" href="/vendas/novo">Registrar a primeira</a></div>'
        }
      </div>
    `,
  });
}

function vendaFormPage({ user, flash, clientes, lojas, lojaFixaNome, csrfToken }) {
  const clienteOptions = clientes.map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');

  const lojaFieldHtml = lojaFixaNome
    ? `<div class="field">
        <label>Loja</label>
        <input type="text" value="${escapeHtml(lojaFixaNome)}" disabled>
      </div>`
    : `<div class="field">
        <label for="loja_id">Loja</label>
        <select id="loja_id" name="loja_id">
          <option value="">Geral (não vinculada a uma loja específica)</option>
          ${lojas.map((l) => `<option value="${l.id}">${escapeHtml(l.nome)}</option>`).join('')}
        </select>
      </div>`;

  return layout({
    title: 'Nova Venda',
    activeNav: 'vendas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Nova Venda Direto</h1>
          <p class="subtitle">Depois de salvar, você adiciona as peças vendidas na tela seguinte</p>
        </div>
      </div>
      <div class="card">
        <form method="POST" action="/vendas">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="cliente_id">Cliente *</label>
              <select id="cliente_id" name="cliente_id" required>
                <option value="">Selecione...</option>
                ${clienteOptions}
              </select>
            </div>
            ${lojaFieldHtml}
            <div class="field">
              <label for="forma_pagamento">Forma de pagamento</label>
              <select id="forma_pagamento" name="forma_pagamento" onchange="toggleParcelas()">
                <option value="">Não definida</option>
                <option value="pix">Pix</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="debito">Cartão de débito</option>
                <option value="credito">Cartão de crédito</option>
              </select>
            </div>
            <div class="field" id="campo-parcelas">
              <label for="parcelas">Parcelado em quantas vezes</label>
              <input type="number" id="parcelas" name="parcelas" min="1" max="24" value="1">
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes"></textarea>
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">Continuar</button>
            <a class="btn btn-secondary" href="/vendas">Cancelar</a>
          </div>
        </form>
      </div>
      <script>
        function toggleParcelas() {
          var forma = document.getElementById('forma_pagamento').value;
          document.getElementById('campo-parcelas').style.display = forma === 'credito' ? '' : 'none';
        }
        toggleParcelas();
      </script>
    `,
  });
}

function vendaItensSection(venda, itens, pecasDisponiveis, csrfToken) {
  const rows = itens
    .map((item) => {
      const subtotal = item.quantidade * item.preco_unitario;
      return `
    <tr>
      <td>${escapeHtml(item.nome_peca)}</td>
      <td>${item.quantidade}</td>
      <td>${formatMoney(item.preco_unitario)}</td>
      <td>${formatMoney(subtotal)}</td>
      <td>
        ${
          venda.status === 'aberta'
            ? `<form method="POST" action="/vendas/${venda.id}/itens/${item.id}/excluir" onsubmit="return confirm('Remover este item da venda? A quantidade volta pro estoque.');">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <button class="btn btn-sm btn-danger" type="submit">Remover</button>
        </form>`
            : ''
        }
      </td>
    </tr>`;
    })
    .join('');

  const options = pecasDisponiveis
    .map((p) => `<option value="${p.id}" data-preco="${p.preco_venda}">${escapeHtml(p.nome)} (estoque: ${p.quantidade}) — ${formatMoney(p.preco_venda)}</option>`)
    .join('');

  return `
      <div class="card">
        <h2>Itens da venda</h2>
        ${
          itens.length
            ? `<table><thead><tr><th>Peça</th><th>Qtd.</th><th>Preço unit.</th><th>Subtotal</th><th></th></tr></thead><tbody>${rows}</tbody></table>
               <p style="margin-top:12px;"><strong>Total: ${formatMoney(venda.valor_total)}</strong></p>`
            : '<p class="muted">Nenhum item adicionado ainda.</p>'
        }
        ${
          venda.status === 'aberta'
            ? pecasDisponiveis.length
              ? `<form method="POST" action="/vendas/${venda.id}/itens" style="margin-top:16px;">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <div class="form-grid">
              <div class="field">
                <label for="peca_id">Peça</label>
                <select id="peca_id" name="peca_id" required>
                  <option value="">Selecione...</option>
                  ${options}
                </select>
              </div>
              <div class="field">
                <label for="item_quantidade">Quantidade</label>
                <input type="number" id="item_quantidade" name="quantidade" min="1" step="1" value="1" required>
              </div>
            </div>
            <button class="btn btn-sm" type="submit">+ Adicionar item</button>
          </form>`
              : '<p class="muted" style="margin-top:12px;">Nenhuma peça disponível no estoque desta loja.</p>'
            : ''
        }
      </div>`;
}

function vendaShowPage({ user, flash, venda, itens, pecasDisponiveis, csrfToken }) {
  return layout({
    title: venda.numero,
    activeNav: 'vendas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${escapeHtml(venda.numero)} ${vendaStatusBadge(venda)}</h1>
          <p class="subtitle">
            Cliente: <a class="link-btn" href="/clientes/${venda.cliente_id}">${escapeHtml(venda.cliente_nome)}</a>
            &nbsp;·&nbsp; Loja: ${venda.loja_nome ? escapeHtml(venda.loja_nome) : '<span class="muted">Geral</span>'}
            &nbsp;·&nbsp; Pagamento: ${formaPagamentoLabel(venda)}
          </p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          ${
            venda.status === 'aberta' && itens.length
              ? `<form method="POST" action="/vendas/${venda.id}/finalizar" onsubmit="return confirm('Finalizar esta venda? Depois de finalizada não é mais possível adicionar ou remover itens.');">
            <input type="hidden" name="csrf" value="${csrfToken}">
            <button class="btn" type="submit">✔ Finalizar venda</button>
          </form>`
              : ''
          }
        </div>
      </div>

      ${venda.status === 'concluida' ? `<div class="flash flash-success">Venda finalizada em ${formatDate(venda.finalizada_at)}.</div>` : ''}

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${formatMoney(venda.valor_total)}</div><div class="label">Valor total da venda</div></div>
        <div class="stat-card"><div class="num">${itens.length}</div><div class="label">Itens vendidos</div></div>
        <div class="stat-card"><div class="num">${formatDate(venda.created_at).split(' ')[0]}</div><div class="label">Data da venda</div></div>
      </div>

      ${vendaItensSection(venda, itens, pecasDisponiveis, csrfToken)}

      ${
        venda.observacoes
          ? `<div class="card"><h2>Observações</h2><p>${escapeHtml(venda.observacoes).replace(/\n/g, '<br>')}</p></div>`
          : ''
      }
    `,
  });
}

module.exports = {
  vendasListPage,
  vendaFormPage,
  vendaShowPage,
  STATUS_LABELS,
  FORMA_PAGAMENTO_LABELS,
  formaPagamentoLabel,
};

'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDate } = require('../utils');

function caixaEspeciePage({ user, flash, saldo, movimentos, csrfToken, podeFechar }) {
  const rows = (movimentos || [])
    .map((mv) => {
      const ehEntrada = mv.tipo === 'entrada';
      const tipoTxt = ehEntrada ? 'Entrada (dinheiro)' : 'Fechamento (retirada)';
      const cor = ehEntrada ? '#1f6b3a' : '#a1352a';
      const sinal = ehEntrada ? '+' : '−';
      return `
      <tr>
        <td>${formatDate(mv.created_at)}</td>
        <td><span style="color:${cor};font-weight:600;">${tipoTxt}</span></td>
        <td>${escapeHtml(mv.descricao || '-')}${mv.venda_id ? ` <a class="link-btn" href="/vendas/${mv.venda_id}">(venda)</a>` : ''}</td>
        <td style="text-align:right;font-weight:600;color:${cor};">${sinal} ${formatMoney(mv.valor)}</td>
      </tr>`;
    })
    .join('');

  return layout({
    title: 'Caixa em espécie',
    activeNav: 'caixa-especie',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Caixa em espécie</h1>
          <p class="subtitle">Dinheiro físico recebido nas vendas, aguardando conferência do diretor</p>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card" style="border-left:4px solid #8a6d1f;">
          <div class="num" style="color:#8a6d1f;">${formatMoney(saldo)}</div>
          <div class="label">Saldo em dinheiro no caixa</div>
        </div>
      </div>

      ${
        podeFechar
          ? `<div class="card">
        <h2 style="margin-top:0;">Fechar o caixa (diretor)</h2>
        <p class="muted" style="margin-top:-4px;">Ao receber o dinheiro físico em mãos, informe o valor conferido para zerar (ou abater) o saldo.</p>
        <form method="POST" action="/financeiro/caixa-especie/fechar" onsubmit="return confirm('Confirmar o fechamento do caixa com este valor? Isso abate o saldo em espécie.');">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <div class="form-grid">
            <div class="field">
              <label for="valor">Valor recebido em espécie (R$)</label>
              <input type="number" id="valor" name="valor" min="0" step="0.01" value="${(Number(saldo) || 0).toFixed(2)}" required>
            </div>
            <div class="field">
              <label for="obs">Observação (opcional)</label>
              <input type="text" id="obs" name="obs" placeholder="Ex.: Conferido e guardado no cofre">
            </div>
          </div>
          <button class="btn" type="submit">Fechar caixa</button>
        </form>
      </div>`
          : ''
      }

      <div class="card">
        <h2>Movimentações</h2>
        ${
          rows
            ? `<table>
          <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th style="text-align:right;">Valor</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma movimentação no caixa em espécie ainda.</div>'
        }
      </div>
    `,
  });
}

module.exports = { caixaEspeciePage };

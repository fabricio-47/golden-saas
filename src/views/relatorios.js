'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDateOnly } = require('../utils');

const OS_STATUS = { orcamento: 'Orçamento', execucao: 'Execução', concluida: 'Concluída' };

function relatoriosPage({
  user,
  flash,
  de,
  ate,
  osList,
  osTotal,
  vendasList,
  vendasTotal,
  recebido,
  pago,
  resultado,
}) {
  const corValor = (v) => (v >= 0 ? '#1f6b3a' : '#a1352a');

  const osRows = osList
    .map(
      (o) => `
    <tr>
      <td><a class="link-btn" href="/os/${o.id}">${escapeHtml(o.numero)}</a></td>
      <td>${formatDateOnly(o.data_entrada)}</td>
      <td>${escapeHtml(o.cliente_nome)}</td>
      <td>${escapeHtml(o.marca || '')} ${escapeHtml(o.modelo || '')}</td>
      <td>${o.tecnico_nome ? escapeHtml(o.tecnico_nome) : '<span class="muted">—</span>'}</td>
      <td>${OS_STATUS[o.status] || o.status}</td>
      <td style="text-align:right;">${formatMoney(o.valor)}</td>
    </tr>`
    )
    .join('');

  const vendasRows = vendasList
    .map(
      (v) => `
    <tr>
      <td><a class="link-btn" href="/vendas/${v.id}">${escapeHtml(v.numero)}</a></td>
      <td>${formatDateOnly(v.created_at)}</td>
      <td>${escapeHtml(v.cliente_nome)}</td>
      <td>${escapeHtml(v.status)}</td>
      <td style="text-align:right;">${formatMoney(v.valor_total)}</td>
    </tr>`
    )
    .join('');

  const q = `de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`;

  return layout({
    title: 'Relatórios',
    activeNav: 'relatorios',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Relatórios</h1>
          <p class="subtitle">Resumo por período, com exportação para planilha (CSV)</p>
        </div>
      </div>

      <div class="card">
        <form method="GET" action="/relatorios" class="form-grid" style="align-items:end;">
          <div class="field">
            <label for="de">De</label>
            <input type="date" id="de" name="de" value="${escapeHtml(de)}">
          </div>
          <div class="field">
            <label for="ate">Até</label>
            <input type="date" id="ate" name="ate" value="${escapeHtml(ate)}">
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="btn" type="submit">Aplicar período</button>
          </div>
        </form>
      </div>

      <h2 style="margin:24px 0 12px;">Resumo financeiro do período</h2>
      <div class="stat-grid">
        <div class="stat-card"><div class="num" style="color:#1f6b3a;">${formatMoney(recebido)}</div><div class="label">Recebido</div></div>
        <div class="stat-card"><div class="num" style="color:#a1352a;">${formatMoney(pago)}</div><div class="label">Pago</div></div>
        <div class="stat-card"><div class="num" style="color:${corValor(resultado)};">${formatMoney(resultado)}</div><div class="label">Resultado</div></div>
      </div>

      <div class="card" style="margin-top:24px;">
        <div class="page-header" style="margin-bottom:12px;">
          <div><h2 style="margin:0;">Ordens de Serviço no período</h2><p class="subtitle" style="margin:0;">${osList.length} O.S. · total ${formatMoney(osTotal)}</p></div>
          <a class="btn btn-secondary btn-sm" href="/relatorios/export?tipo=os&${q}">⬇ Exportar CSV</a>
        </div>
        ${
          osList.length
            ? `<table><thead><tr><th>Número</th><th>Entrada</th><th>Cliente</th><th>Veículo</th><th>Técnico</th><th>Status</th><th style="text-align:right;">Valor</th></tr></thead><tbody>${osRows}</tbody></table>`
            : '<p class="muted">Nenhuma O.S. no período.</p>'
        }
      </div>

      <div class="card" style="margin-top:4px;">
        <div class="page-header" style="margin-bottom:12px;">
          <div><h2 style="margin:0;">Vendas no período</h2><p class="subtitle" style="margin:0;">${vendasList.length} venda(s) · total ${formatMoney(vendasTotal)}</p></div>
          <a class="btn btn-secondary btn-sm" href="/relatorios/export?tipo=vendas&${q}">⬇ Exportar CSV</a>
        </div>
        ${
          vendasList.length
            ? `<table><thead><tr><th>Número</th><th>Data</th><th>Cliente</th><th>Status</th><th style="text-align:right;">Valor</th></tr></thead><tbody>${vendasRows}</tbody></table>`
            : '<p class="muted">Nenhuma venda no período.</p>'
        }
      </div>

      <div class="card" style="margin-top:4px;">
        <div class="page-header" style="margin-bottom:0;">
          <div><h2 style="margin:0;">Movimentações financeiras</h2><p class="subtitle" style="margin:0;">Exporte os recebimentos e pagamentos do período.</p></div>
          <div class="actions-row" style="margin-top:0;">
            <a class="btn btn-secondary btn-sm" href="/relatorios/export?tipo=recebimentos&${q}">⬇ Recebimentos</a>
            <a class="btn btn-secondary btn-sm" href="/relatorios/export?tipo=pagamentos&${q}">⬇ Pagamentos</a>
          </div>
        </div>
      </div>
    `,
  });
}

module.exports = { relatoriosPage };

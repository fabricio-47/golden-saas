'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney, formatDateOnly } = require('../utils');

function financeiroResumoPage({
  user,
  flash,
  aReceberPendente,
  aReceberVencidasValor,
  aReceberVencidasQtd,
  aPagarPendente,
  aPagarVencidasValor,
  aPagarVencidasQtd,
  saldoPrevisto,
  recebidoMes,
  pagoMes,
  resultadoMes,
  mesLabel,
  fluxo,
  vencimentos,
}) {
  const corValor = (v) => (v >= 0 ? '#1f6b3a' : '#a1352a');

  const maxFluxo = Math.max(1, ...fluxo.map((f) => Math.max(f.recebido, f.pago)));
  const fluxoRows = fluxo
    .map((f) => {
      const pr = Math.round((f.recebido / maxFluxo) * 100);
      const pp = Math.round((f.pago / maxFluxo) * 100);
      return `
      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
          <strong>${f.label}</strong>
          <span style="color:${corValor(f.saldo)};font-weight:600;">Saldo ${formatMoney(f.saldo)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
          <span style="width:80px;font-size:12px;color:var(--text-muted);">Recebido</span>
          <div style="flex:1;background:var(--border);border-radius:5px;height:16px;overflow:hidden;"><div style="width:${pr}%;height:100%;background:#2f6b3a;border-radius:5px;min-width:2px;"></div></div>
          <span style="width:100px;text-align:right;font-size:12px;font-weight:600;">${formatMoney(f.recebido)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:80px;font-size:12px;color:var(--text-muted);">Pago</span>
          <div style="flex:1;background:var(--border);border-radius:5px;height:16px;overflow:hidden;"><div style="width:${pp}%;height:100%;background:#a1352a;border-radius:5px;min-width:2px;"></div></div>
          <span style="width:100px;text-align:right;font-size:12px;font-weight:600;">${formatMoney(f.pago)}</span>
        </div>
      </div>`;
    })
    .join('');

  const vencRows = vencimentos
    .map((v) => {
      const cor = v.tipo === 'receber' ? '#1f6b3a' : '#a1352a';
      const tipoTxt = v.tipo === 'receber' ? 'A receber' : 'A pagar';
      const prazo = v.atrasada
        ? `<span style="color:#a1352a;font-weight:600;">${formatDateOnly(v.vencimento)} · vencida</span>`
        : formatDateOnly(v.vencimento);
      return `
      <tr>
        <td><span style="color:${cor};font-weight:600;">${tipoTxt}</span></td>
        <td>${escapeHtml(v.descricao)}${v.nome ? `<div class="muted">${escapeHtml(v.nome)}</div>` : ''}</td>
        <td>${prazo}</td>
        <td style="text-align:right;font-weight:600;">${formatMoney(v.valor)}</td>
      </tr>`;
    })
    .join('');

  return layout({
    title: 'Financeiro',
    activeNav: 'financeiro-resumo',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Visão geral do financeiro</h1>
          <p class="subtitle">Pendências, resultado do mês e fluxo de caixa</p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          <a class="btn btn-secondary" href="/contas-receber">Contas a Receber</a>
          <a class="btn btn-secondary" href="/contas-pagar">Contas a Pagar</a>
        </div>
      </div>

      <h2 style="margin-bottom:12px;">Em aberto</h2>
      <div class="stat-grid">
        <div class="stat-card" style="border-left:4px solid #2f6b3a;">
          <div class="num" style="color:#1f6b3a;">${formatMoney(aReceberPendente)}</div>
          <div class="label">A receber${aReceberVencidasQtd ? ` · ${aReceberVencidasQtd} vencida(s): ${formatMoney(aReceberVencidasValor)}` : ''}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #a1352a;">
          <div class="num" style="color:#a1352a;">${formatMoney(aPagarPendente)}</div>
          <div class="label">A pagar${aPagarVencidasQtd ? ` · ${aPagarVencidasQtd} vencida(s): ${formatMoney(aPagarVencidasValor)}` : ''}</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:${corValor(saldoPrevisto)};">${formatMoney(saldoPrevisto)}</div>
          <div class="label">Saldo previsto (se tudo for quitado)</div>
        </div>
      </div>

      <h2 style="margin:24px 0 12px;">Resultado de ${mesLabel} (realizado)</h2>
      <div class="stat-grid">
        <div class="stat-card"><div class="num" style="color:#1f6b3a;">${formatMoney(recebidoMes)}</div><div class="label">Recebido no mês</div></div>
        <div class="stat-card"><div class="num" style="color:#a1352a;">${formatMoney(pagoMes)}</div><div class="label">Pago no mês</div></div>
        <div class="stat-card"><div class="num" style="color:${corValor(resultadoMes)};">${formatMoney(resultadoMes)}</div><div class="label">Resultado do mês</div></div>
      </div>

      <div class="card" style="margin-top:24px;">
        <h2>Fluxo de caixa — últimos 6 meses</h2>
        <p class="muted" style="margin-top:-4px;margin-bottom:16px;">Valores efetivamente recebidos e pagos em cada mês.</p>
        ${fluxoRows}
      </div>

      <div class="card" style="margin-top:4px;">
        <h2>Próximos vencimentos (vencidas e até 7 dias)</h2>
        ${
          vencimentos.length
            ? `<table>
          <thead><tr><th>Tipo</th><th>Descrição</th><th>Vencimento</th><th style="text-align:right;">Valor</th></tr></thead>
          <tbody>${vencRows}</tbody>
        </table>`
            : '<p class="muted">Nada vencido nem vencendo nos próximos 7 dias. 👍</p>'
        }
      </div>
    `,
  });
}

module.exports = { financeiroResumoPage };

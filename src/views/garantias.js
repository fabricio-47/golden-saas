'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDateOnly } = require('../utils');

// Componentes cobertos pela garantia e de onde vem o prazo (meses).
// campoMeses = coluna de override na garantia; chaveConfig = prazo padrão.
const COMPONENTES = [
  { key: 'geral', label: 'Veículo (geral / chassi)', serie: 'chassi_numero', campoMeses: 'meses_geral', chaveConfig: 'garantia_meses_geral' },
  { key: 'motor', label: 'Motor', serie: 'motor_serial', campoMeses: 'meses_motor', chaveConfig: 'garantia_meses_motor' },
  { key: 'controladora', label: 'Controladora', serie: 'controladora_serial', campoMeses: 'meses_controladora', chaveConfig: 'garantia_meses_controladora' },
  { key: 'bateria', label: 'Bateria', serie: 'bateria_serial', campoMeses: 'meses_bateria', chaveConfig: 'garantia_meses_bateria' },
];

function somaMeses(dataIso, meses) {
  const base = String(dataIso).length <= 10 ? dataIso + 'T00:00:00' : dataIso;
  const d = new Date(base);
  if (isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + Number(meses || 0));
  return d;
}

// Calcula o status de cada componente de UMA garantia. Retorna linhas com
// vencimento e se ainda está dentro do prazo (e quantos dias faltam/passaram).
function calcularStatus(g, config) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return COMPONENTES.map((c) => {
    const serie = g[c.serie];
    const meses = g[c.campoMeses] != null ? g[c.campoMeses] : (config ? config[c.chaveConfig] : null);
    const vence = somaMeses(g.data_venda, meses);
    let dentro = null;
    let dias = null;
    if (vence) {
      const vd = new Date(vence);
      vd.setHours(0, 0, 0, 0);
      dias = Math.round((vd - hoje) / 86400000);
      dentro = dias >= 0;
    }
    return { key: c.key, label: c.label, serie: serie || '', meses, vence, dentro, dias };
  });
}

function badgeStatus(linha) {
  if (linha.dentro == null) return '<span class="badge">-</span>';
  if (linha.dentro) {
    return `<span class="badge badge-ok">Na garantia</span> <span class="muted">(faltam ${linha.dias} dia${linha.dias === 1 ? '' : 's'})</span>`;
  }
  return `<span class="badge badge-desativada">Fora da garantia</span> <span class="muted">(venceu há ${Math.abs(linha.dias)} dia${Math.abs(linha.dias) === 1 ? '' : 's'})</span>`;
}

function cardResultado(g, config) {
  const linhas = calcularStatus(g, config);
  const corpo = linhas
    .map(
      (l) => `
      <tr>
        <td>${l.label}</td>
        <td>${l.serie ? escapeHtml(l.serie) : '<span class="muted">—</span>'}</td>
        <td>${l.vence ? formatDateOnly(l.vence.toISOString()) : '-'}</td>
        <td>${l.serie ? badgeStatus(l) : '<span class="muted">sem série</span>'}</td>
      </tr>`
    )
    .join('');
  return `
    <div class="card" style="margin-bottom:16px;">
      <div class="page-header" style="margin-bottom:8px;">
        <div>
          <h2 style="margin:0;">${escapeHtml(g.descricao_produto || 'Produto')}</h2>
          <p class="subtitle" style="margin:4px 0 0;">
            ${g.cliente_nome ? 'Cliente: ' + escapeHtml(g.cliente_nome) + ' · ' : ''}Vendido em ${formatDateOnly(g.data_venda)}
          </p>
        </div>
        <a class="btn btn-secondary" href="/garantias/${g.id}/editar">Editar</a>
      </div>
      <table>
        <thead><tr><th>Componente</th><th>Nº de série</th><th>Vence em</th><th>Situação</th></tr></thead>
        <tbody>${corpo}</tbody>
      </table>
      ${g.observacoes ? `<p class="muted" style="margin-top:8px;">Obs.: ${escapeHtml(g.observacoes)}</p>` : ''}
    </div>`;
}

function garantiaConsultaPage({ user, flash, termo, resultados, recentes, config }) {
  const buscou = termo != null && termo !== '';
  let corpoResultados = '';
  if (buscou) {
    corpoResultados = resultados && resultados.length
      ? resultados.map((g) => cardResultado(g, config)).join('')
      : `<div class="card"><div class="empty">Nenhuma garantia encontrada para "<strong>${escapeHtml(termo)}</strong>". Confira o número ou registre a venda.</div></div>`;
  }
  const listaRecentes = (recentes || [])
    .map(
      (g) => `
      <tr>
        <td><a class="link-btn" href="/garantias/${g.id}/editar">${escapeHtml(g.descricao_produto || 'Produto')}</a></td>
        <td>${g.cliente_nome ? escapeHtml(g.cliente_nome) : '<span class="muted">—</span>'}</td>
        <td>${g.chassi_numero ? escapeHtml(g.chassi_numero) : '<span class="muted">—</span>'}</td>
        <td>${formatDateOnly(g.data_venda)}</td>
      </tr>`
    )
    .join('');
  return layout({
    title: 'Garantias',
    activeNav: 'garantias',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Consulta de garantia</h1>
          <p class="subtitle">Digite o chassi ou o número de série (motor, controladora ou bateria)</p>
        </div>
        <div style="display:flex;gap:8px;">
          <a class="btn btn-secondary" href="/garantias/prazos">Prazos padrão</a>
          <a class="btn" href="/garantias/nova">+ Registrar garantia</a>
        </div>
      </div>
      <div class="card">
        <form method="GET" action="/garantias" style="display:flex;gap:8px;align-items:flex-end;">
          <div class="field full" style="margin:0;flex:1;">
            <label for="q">Chassi ou número de série</label>
            <input type="text" id="q" name="q" value="${escapeHtml(termo || '')}" placeholder="Ex.: 9C2KC1670..." autofocus>
          </div>
          <button class="btn" type="submit">Consultar</button>
        </form>
      </div>
      ${corpoResultados}
      ${
        !buscou
          ? `<div class="card">
          <h2 style="margin-top:0;">Últimas garantias registradas</h2>
          ${
            listaRecentes
              ? `<table><thead><tr><th>Produto</th><th>Cliente</th><th>Chassi</th><th>Venda</th></tr></thead><tbody>${listaRecentes}</tbody></table>`
              : '<div class="empty">Nenhuma garantia registrada ainda. Clique em “Registrar garantia” ao vender uma unidade.</div>'
          }
        </div>`
          : ''
      }
    `,
  });
}

function garantiaFormPage({ user, flash, garantia, csrfToken, config, produtos, clientes }) {
  const isEdit = !!(garantia && garantia.id);
  const g = garantia || {};
  const hoje = new Date().toISOString().slice(0, 10);
  const clienteOptions = (clientes || [])
    .map((c) => `<option value="${c.id}" ${g.cliente_id == c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`)
    .join('');
  const produtoOptions = (produtos || [])
    .map(
      (p) =>
        `<option value="${p.id}" ${g.produto_id == p.id ? 'selected' : ''}
          data-nome="${escapeHtml(p.nome)}"
          data-chassi="${escapeHtml(p.chassi_numero || '')}"
          data-motor="${escapeHtml(p.motor_serial || '')}"
          data-controladora="${escapeHtml(p.controladora_serial || '')}"
          data-bateria="${escapeHtml(p.bateria_serial || '')}">${escapeHtml(p.nome)}</option>`
    )
    .join('');
  const ph = (chave) => (config && config[chave] != null ? `padrão: ${config[chave]} meses` : 'meses');
  return layout({
    title: isEdit ? 'Editar garantia' : 'Registrar garantia',
    activeNav: 'garantias',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar garantia' : 'Registrar garantia'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/garantias/${g.id}` : '/garantias'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="produto_id">Produto (opcional — preenche as séries)</label>
              <select id="produto_id" name="produto_id">
                <option value="">— selecione —</option>
                ${produtoOptions}
              </select>
            </div>
            <div class="field">
              <label for="cliente_id">Cliente</label>
              <select id="cliente_id" name="cliente_id">
                <option value="">— selecione —</option>
                ${clienteOptions}
              </select>
            </div>
            <div class="field full">
              <label for="descricao_produto">Descrição do produto *</label>
              <input type="text" id="descricao_produto" name="descricao_produto" required value="${escapeHtml(g.descricao_produto || '')}" placeholder="Ex.: Patinete Voltz EVS / Moto elétrica X">
            </div>
            <div class="field">
              <label for="chassi_numero">Chassi</label>
              <input type="text" id="chassi_numero" name="chassi_numero" value="${escapeHtml(g.chassi_numero || '')}">
            </div>
            <div class="field">
              <label for="data_venda">Data da venda *</label>
              <input type="date" id="data_venda" name="data_venda" required value="${escapeHtml(g.data_venda ? String(g.data_venda).slice(0, 10) : hoje)}">
            </div>
            <div class="field">
              <label for="motor_serial">Nº de série do motor</label>
              <input type="text" id="motor_serial" name="motor_serial" value="${escapeHtml(g.motor_serial || '')}">
            </div>
            <div class="field">
              <label for="controladora_serial">Nº de série da controladora</label>
              <input type="text" id="controladora_serial" name="controladora_serial" value="${escapeHtml(g.controladora_serial || '')}">
            </div>
            <div class="field">
              <label for="bateria_serial">Nº de série da bateria</label>
              <input type="text" id="bateria_serial" name="bateria_serial" value="${escapeHtml(g.bateria_serial || '')}">
            </div>
          </div>

          <h2 style="margin-top:24px;">Prazos desta garantia (opcional)</h2>
          <p class="subtitle">Deixe em branco para usar o prazo padrão da loja.</p>
          <div class="form-grid">
            <div class="field">
              <label for="meses_geral">Veículo (geral)</label>
              <input type="number" id="meses_geral" name="meses_geral" min="0" step="1" value="${g.meses_geral != null ? g.meses_geral : ''}" placeholder="${ph('garantia_meses_geral')}">
            </div>
            <div class="field">
              <label for="meses_motor">Motor</label>
              <input type="number" id="meses_motor" name="meses_motor" min="0" step="1" value="${g.meses_motor != null ? g.meses_motor : ''}" placeholder="${ph('garantia_meses_motor')}">
            </div>
            <div class="field">
              <label for="meses_controladora">Controladora</label>
              <input type="number" id="meses_controladora" name="meses_controladora" min="0" step="1" value="${g.meses_controladora != null ? g.meses_controladora : ''}" placeholder="${ph('garantia_meses_controladora')}">
            </div>
            <div class="field">
              <label for="meses_bateria">Bateria</label>
              <input type="number" id="meses_bateria" name="meses_bateria" min="0" step="1" value="${g.meses_bateria != null ? g.meses_bateria : ''}" placeholder="${ph('garantia_meses_bateria')}">
            </div>
          </div>

          <div class="field full">
            <label for="observacoes">Observações</label>
            <textarea id="observacoes" name="observacoes" rows="2">${escapeHtml(g.observacoes || '')}</textarea>
          </div>

          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Registrar garantia'}</button>
            <a class="btn btn-secondary" href="/garantias">Cancelar</a>
          </div>
        </form>
        ${
          isEdit
            ? `<form method="POST" action="/garantias/${g.id}/excluir" onsubmit="return confirm('Excluir esta garantia?');" style="margin-top:12px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <button class="btn btn-danger" type="submit">Excluir garantia</button>
        </form>`
            : ''
        }
      </div>
      <script>
        (function () {
          var sel = document.getElementById('produto_id');
          if (!sel) return;
          sel.addEventListener('change', function () {
            var o = sel.options[sel.selectedIndex];
            if (!o || !o.value) return;
            function set(id, v) { var el = document.getElementById(id); if (el && !el.value) el.value = v || ''; }
            var desc = document.getElementById('descricao_produto');
            if (desc && !desc.value) desc.value = o.getAttribute('data-nome') || '';
            set('chassi_numero', o.getAttribute('data-chassi'));
            set('motor_serial', o.getAttribute('data-motor'));
            set('controladora_serial', o.getAttribute('data-controladora'));
            set('bateria_serial', o.getAttribute('data-bateria'));
          });
        })();
      </script>
    `,
  });
}

function garantiaPrazosPage({ user, flash, config, csrfToken }) {
  const c = config || {};
  return layout({
    title: 'Prazos de garantia',
    activeNav: 'garantias',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>Prazos padrão de garantia</h1><p class="subtitle">Em meses. Valem para toda garantia nova que não tiver prazo próprio.</p></div></div>
      <div class="card">
        <form method="POST" action="/garantias/prazos">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="garantia_meses_geral">Veículo (geral)</label>
              <input type="number" id="garantia_meses_geral" name="garantia_meses_geral" min="0" step="1" value="${c.garantia_meses_geral != null ? c.garantia_meses_geral : 3}">
            </div>
            <div class="field">
              <label for="garantia_meses_motor">Motor</label>
              <input type="number" id="garantia_meses_motor" name="garantia_meses_motor" min="0" step="1" value="${c.garantia_meses_motor != null ? c.garantia_meses_motor : 12}">
            </div>
            <div class="field">
              <label for="garantia_meses_controladora">Controladora</label>
              <input type="number" id="garantia_meses_controladora" name="garantia_meses_controladora" min="0" step="1" value="${c.garantia_meses_controladora != null ? c.garantia_meses_controladora : 12}">
            </div>
            <div class="field">
              <label for="garantia_meses_bateria">Bateria</label>
              <input type="number" id="garantia_meses_bateria" name="garantia_meses_bateria" min="0" step="1" value="${c.garantia_meses_bateria != null ? c.garantia_meses_bateria : 6}">
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">Salvar prazos</button>
            <a class="btn btn-secondary" href="/garantias">Voltar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { garantiaConsultaPage, garantiaFormPage, garantiaPrazosPage, calcularStatus };

'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate, formatMoney } = require('../utils');

const STATUS_LABELS = {
  aberta: 'Aberta',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
};

const CHECKLIST_ITEMS = [
  'Inspeção visual do quadro',
  'Motor (ruído / funcionamento)',
  'Fiação e conectores',
  'Display / computador de bordo',
  'Integridade física da bateria',
  'Freios',
  'Pneus e câmaras',
  'Sistema de transmissão',
];

function ordensListPage({ user, flash, ordens, statusFilter }) {
  const rows = ordens
    .map(
      (os) => `
    <tr>
      <td><a class="link-btn" href="/os/${os.id}">${escapeHtml(os.numero)}</a></td>
      <td>${escapeHtml(os.cliente_nome)}</td>
      <td>${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</td>
      <td><span class="badge badge-${os.status}">${STATUS_LABELS[os.status] || os.status}</span></td>
      <td>${formatMoney(os.valor_estimado)}</td>
      <td>${formatDate(os.data_entrada)}</td>
    </tr>`
    )
    .join('');

  const filterLink = (value, label) =>
    `<a class="btn btn-sm ${statusFilter === value ? 'btn' : 'btn-secondary'}" href="/os${value ? `?status=${value}` : ''}">${label}</a>`;

  return layout({
    title: 'Ordens de Serviço',
    activeNav: 'os',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Ordens de Serviço</h1>
          <p class="subtitle">Acompanhe o fluxo de manutenção da oficina</p>
        </div>
        <a class="btn" href="/os/novo">+ Nova Ordem de Serviço</a>
      </div>
      <div class="actions-row" style="margin-top:0;margin-bottom:20px;">
        ${filterLink('', 'Todas')}
        ${filterLink('aberta', 'Abertas')}
        ${filterLink('em_andamento', 'Em andamento')}
        ${filterLink('concluida', 'Concluídas')}
      </div>
      <div class="card">
        ${
          ordens.length
            ? `<table>
          <thead><tr><th>Número</th><th>Cliente</th><th>Bicicleta</th><th>Status</th><th>Valor</th><th>Entrada</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma ordem de serviço encontrada.</div>'
        }
      </div>
    `,
  });
}

function checklistFormFields(checklist) {
  const existing = {};
  (checklist || []).forEach((c) => {
    existing[c.item] = c;
  });
  return CHECKLIST_ITEMS.map((item, idx) => {
    const current = existing[item] || { status: 'ok', observacao: '' };
    return `
      <div class="checklist-row">
        <label class="item-name">${escapeHtml(item)}</label>
        <div class="radio-group">
          <label><input type="radio" name="checklist_status_${idx}" value="ok" ${current.status === 'ok' ? 'checked' : ''}> OK</label>
          <label><input type="radio" name="checklist_status_${idx}" value="atencao" ${current.status === 'atencao' ? 'checked' : ''}> Atenção</label>
        </div>
        <input type="text" name="checklist_obs_${idx}" placeholder="Observação (opcional)" value="${escapeHtml(current.observacao)}">
        <input type="hidden" name="checklist_item_${idx}" value="${escapeHtml(item)}">
      </div>`;
  }).join('');
}

function ordemFormPage({ user, flash, os, clientes, bicicletas, defaultClienteId, defaultBicicletaId, csrfToken }) {
  const isEdit = !!os;
  const checklist = os && os.checklist_json ? JSON.parse(os.checklist_json) : [];

  const clienteOptions = clientes
    .map(
      (c) =>
        `<option value="${c.id}" ${(os && os.cliente_id === c.id) || (!os && defaultClienteId == c.id) ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`
    )
    .join('');

  const bicicletaOptionsHtml = bicicletas
    .map(
      (b) =>
        `<option value="${b.id}" data-cliente="${b.cliente_id}" ${
          (os && os.bicicleta_id === b.id) || (!os && defaultBicicletaId == b.id) ? 'selected' : ''
        }>${escapeHtml(b.marca || '')} ${escapeHtml(b.modelo)} — ${escapeHtml(b.cliente_nome)}</option>`
    )
    .join('');

  const statusOptions = ['aberta', 'em_andamento', 'concluida']
    .map((s) => `<option value="${s}" ${os && os.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`)
    .join('');

  return layout({
    title: isEdit ? `Editar ${os.numero}` : 'Nova Ordem de Serviço',
    activeNav: 'os',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${isEdit ? escapeHtml(os.numero) : 'Nova Ordem de Serviço'}</h1>
          <p class="subtitle">Checklist de entrada especializado e diagnóstico técnico</p>
        </div>
      </div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/os/${os.id}` : '/os'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="cliente_id">Cliente *</label>
              <select id="cliente_id" name="cliente_id" required onchange="filterBicicletas()">
                <option value="">Selecione...</option>
                ${clienteOptions}
              </select>
            </div>
            <div class="field">
              <label for="bicicleta_id">Bicicleta *</label>
              <select id="bicicleta_id" name="bicicleta_id" required>
                <option value="">Selecione o cliente primeiro...</option>
                ${bicicletaOptionsHtml}
              </select>
            </div>
            ${
              isEdit
                ? `<div class="field">
              <label for="status">Status</label>
              <select id="status" name="status">${statusOptions}</select>
            </div>`
                : ''
            }
            <div class="field">
              <label for="valor_estimado">Valor estimado (R$)</label>
              <input type="number" id="valor_estimado" name="valor_estimado" min="0" step="0.01" value="${os && os.valor_estimado !== null ? os.valor_estimado : ''}">
            </div>
          </div>

          <h2 style="margin-top:24px;">Checklist de entrada</h2>
          <div style="margin-bottom:16px;">
            ${checklistFormFields(checklist)}
          </div>

          <div class="form-grid">
            <div class="field full">
              <label for="diagnostico">Diagnóstico técnico</label>
              <textarea id="diagnostico" name="diagnostico">${escapeHtml(os ? os.diagnostico : '')}</textarea>
            </div>
            <div class="field full">
              <label for="servicos_realizados">Serviços realizados</label>
              <textarea id="servicos_realizados" name="servicos_realizados">${escapeHtml(os ? os.servicos_realizados : '')}</textarea>
            </div>
          </div>

          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Abrir Ordem de Serviço'}</button>
            <a class="btn btn-secondary" href="${isEdit ? `/os/${os.id}` : '/os'}">Cancelar</a>
          </div>
        </form>
      </div>

      <script>
        var allBikeOptions = Array.prototype.slice.call(document.querySelectorAll('#bicicleta_id option[data-cliente]'))
          .map(function(o) { return { value: o.value, cliente: o.getAttribute('data-cliente'), text: o.textContent }; });

        function filterBicicletas() {
          var clienteId = document.getElementById('cliente_id').value;
          var select = document.getElementById('bicicleta_id');
          var current = select.value;
          select.innerHTML = '';
          var placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = clienteId ? 'Selecione a bicicleta...' : 'Selecione o cliente primeiro...';
          select.appendChild(placeholder);
          allBikeOptions.filter(function(o) { return !clienteId || o.cliente === clienteId; }).forEach(function(o) {
            var opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.text;
            if (o.value === current) opt.selected = true;
            select.appendChild(opt);
          });
        }
        document.getElementById('cliente_id').addEventListener('change', filterBicicletas);
        if (document.getElementById('cliente_id').value) { filterBicicletas(); }
      </script>
    `,
  });
}

function ordemShowPage({ user, flash, os, csrfToken }) {
  const checklist = os.checklist_json ? JSON.parse(os.checklist_json) : [];
  const checklistRows = checklist
    .map(
      (c) => `
    <tr>
      <td>${escapeHtml(c.item)}</td>
      <td><span class="badge badge-${c.status}">${c.status === 'ok' ? 'OK' : 'Atenção'}</span></td>
      <td>${escapeHtml(c.observacao || '-')}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: os.numero,
    activeNav: 'os',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${escapeHtml(os.numero)} <span class="badge badge-${os.status}">${STATUS_LABELS[os.status] || os.status}</span></h1>
          <p class="subtitle">
            Cliente: <a class="link-btn" href="/clientes/${os.cliente_id}">${escapeHtml(os.cliente_nome)}</a>
            &nbsp;·&nbsp;
            Bicicleta: <a class="link-btn" href="/bicicletas/${os.bicicleta_id}">${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</a>
          </p>
        </div>
        <a class="btn btn-secondary" href="/os/${os.id}/editar">Editar</a>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${formatMoney(os.valor_estimado)}</div><div class="label">Valor estimado</div></div>
        <div class="stat-card"><div class="num">${formatDate(os.data_entrada).split(' ')[0]}</div><div class="label">Data de entrada</div></div>
        <div class="stat-card"><div class="num">${os.data_conclusao ? formatDate(os.data_conclusao).split(' ')[0] : '-'}</div><div class="label">Data de conclusão</div></div>
      </div>

      <div class="card">
        <h2>Checklist de entrada</h2>
        ${
          checklist.length
            ? `<table><thead><tr><th>Item</th><th>Status</th><th>Observação</th></tr></thead><tbody>${checklistRows}</tbody></table>`
            : '<div class="empty">Nenhum checklist preenchido.</div>'
        }
      </div>

      <div class="card">
        <h2>Diagnóstico técnico</h2>
        <p>${os.diagnostico ? escapeHtml(os.diagnostico).replace(/\n/g, '<br>') : '<span class="muted">Nenhum diagnóstico registrado.</span>'}</p>
      </div>

      <div class="card">
        <h2>Serviços realizados</h2>
        <p>${os.servicos_realizados ? escapeHtml(os.servicos_realizados).replace(/\n/g, '<br>') : '<span class="muted">Nenhum serviço registrado ainda.</span>'}</p>
      </div>

      <form method="POST" action="/os/${os.id}/excluir" onsubmit="return confirm('Tem certeza que deseja excluir esta ordem de serviço?');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn btn-danger btn-sm" type="submit">Excluir O.S.</button>
      </form>
    `,
  });
}

module.exports = { ordensListPage, ordemFormPage, ordemShowPage, CHECKLIST_ITEMS, STATUS_LABELS };

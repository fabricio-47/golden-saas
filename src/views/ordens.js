'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate, formatMoney } = require('../utils');

const STATUS_LABELS = {
  orcamento: 'Orçamento',
  execucao: 'Execução',
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

function totalValor(os) {
  const pecas = Number(os.valor_pecas) || 0;
  const maoObra = Number(os.valor_mao_obra) || 0;
  return pecas + maoObra;
}

const FORMA_PAGAMENTO_LABELS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
};

function formaPagamentoLabel(os) {
  if (!os.forma_pagamento) return '-';
  const base = FORMA_PAGAMENTO_LABELS[os.forma_pagamento] || os.forma_pagamento;
  if (os.forma_pagamento === 'credito' && os.parcelas && os.parcelas > 1) {
    return `${base} (${os.parcelas}x)`;
  }
  return base;
}

function ordensListPage({ user, flash, ordens, statusFilter }) {
  const rows = ordens
    .map(
      (os) => `
    <tr>
      <td><a class="link-btn" href="/os/${os.id}">${escapeHtml(os.numero)}</a></td>
      <td>${escapeHtml(os.cliente_nome)}</td>
      <td>${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</td>
      <td><span class="badge badge-${os.status}">${STATUS_LABELS[os.status] || os.status}</span></td>
      <td>${formatMoney(totalValor(os))}</td>
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
        ${filterLink('orcamento', 'Orçamento')}
        ${filterLink('execucao', 'Execução')}
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

  const statusOptions = ['orcamento', 'execucao', 'concluida']
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
              <label for="bicicleta_id">Veículo *</label>
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
          </div>

          <h2 style="margin-top:24px;">Problema relatado pelo cliente</h2>
          <div class="form-grid">
            <div class="field full">
              <label for="problema_relatado">O que o cliente relatou ao trazer o veículo</label>
              <textarea id="problema_relatado" name="problema_relatado" placeholder="Ex: cliente relata ruído no motor e autonomia baixa">${escapeHtml(os ? os.problema_relatado : '')}</textarea>
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

          <h2 style="margin-top:24px;">Valores</h2>
          <div class="form-grid">
            <div class="field">
              <label for="valor_pecas">Valor de peças (R$)</label>
              <input type="number" id="valor_pecas" name="valor_pecas" min="0" step="0.01" value="${os && os.valor_pecas !== null ? os.valor_pecas : ''}">
            </div>
            <div class="field">
              <label for="valor_mao_obra">Valor de mão de obra (R$)</label>
              <input type="number" id="valor_mao_obra" name="valor_mao_obra" min="0" step="0.01" value="${os && os.valor_mao_obra !== null ? os.valor_mao_obra : ''}">
            </div>
            <div class="field">
              <label for="forma_pagamento">Forma de pagamento</label>
              <select id="forma_pagamento" name="forma_pagamento" onchange="toggleParcelas()">
                <option value="">Não definida</option>
                <option value="pix" ${os && os.forma_pagamento === 'pix' ? 'selected' : ''}>Pix</option>
                <option value="dinheiro" ${os && os.forma_pagamento === 'dinheiro' ? 'selected' : ''}>Dinheiro</option>
                <option value="debito" ${os && os.forma_pagamento === 'debito' ? 'selected' : ''}>Cartão de débito</option>
                <option value="credito" ${os && os.forma_pagamento === 'credito' ? 'selected' : ''}>Cartão de crédito</option>
              </select>
            </div>
            <div class="field" id="campo-parcelas">
              <label for="parcelas">Parcelado em quantas vezes</label>
              <input type="number" id="parcelas" name="parcelas" min="1" max="24" value="${os && os.parcelas ? os.parcelas : 1}">
            </div>
          </div>

          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Abrir Ordem de Serviço'}</button>
            <a class="btn btn-secondary" href="${isEdit ? `/os/${os.id}` : '/os'}">Cancelar</a>
          </div>
          ${!isEdit ? '<p class="muted" style="margin-top:12px;">Depois de salvar, você poderá adicionar fotos e vídeos da checagem e dos serviços realizados.</p>' : ''}
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
          placeholder.textContent = clienteId ? 'Selecione o veículo...' : 'Selecione o cliente primeiro...';
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

        function toggleParcelas() {
          var forma = document.getElementById('forma_pagamento').value;
          document.getElementById('campo-parcelas').style.display = forma === 'credito' ? '' : 'none';
        }
        toggleParcelas();
      </script>
    `,
  });
}

function mediaGrid(midias, osId, csrfToken) {
  if (!midias.length) return '<p class="muted">Nenhum arquivo enviado ainda.</p>';
  return `<div class="media-grid">${midias
    .map(
      (m) => `
    <div class="media-item">
      ${
        m.tipo_arquivo === 'video'
          ? `<video src="/uploads/${m.caminho_arquivo}" controls preload="metadata"></video>`
          : `<a href="/uploads/${m.caminho_arquivo}" target="_blank"><img src="/uploads/${m.caminho_arquivo}" alt="${escapeHtml(m.nome_arquivo)}" loading="lazy"></a>`
      }
      <form method="POST" action="/os/${osId}/midias/${m.id}/excluir" style="display:inline;" onsubmit="return confirm('Remover este arquivo?');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="media-del" type="submit" title="Remover">×</button>
      </form>
    </div>`
    )
    .join('')}</div>`;
}

function ordemShowPage({ user, flash, os, midiasChecklist, midiasServico, csrfToken }) {
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
            Veículo: <a class="link-btn" href="/bicicletas/${os.bicicleta_id}">${escapeHtml(os.marca || '')} ${escapeHtml(os.modelo)}</a>
          </p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          <form method="POST" action="/os/${os.id}/enviar-email" onsubmit="return confirm('Enviar um resumo desta O.S. por e-mail para o cliente?');">
            <input type="hidden" name="csrf" value="${csrfToken}">
            <button class="btn btn-secondary" type="submit">✉ Enviar por e-mail</button>
          </form>
          <a class="btn btn-secondary" href="/os/${os.id}/editar">Editar</a>
          ${
            os.status !== 'concluida'
              ? `<form method="POST" action="/os/${os.id}/finalizar" onsubmit="return confirm('Finalizar esta O.S. e avisar o cliente por e-mail que o serviço está pronto?');">
            <input type="hidden" name="csrf" value="${csrfToken}">
            <button class="btn" type="submit">✔ Finalizar e avisar cliente</button>
          </form>`
              : ''
          }
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${formatMoney(totalValor(os))}</div><div class="label">Valor total (peças + mão de obra)</div></div>
        <div class="stat-card"><div class="num">${formatDate(os.data_entrada).split(' ')[0]}</div><div class="label">Data de entrada</div></div>
        <div class="stat-card"><div class="num">${os.data_conclusao ? formatDate(os.data_conclusao).split(' ')[0] : '-'}</div><div class="label">Data de conclusão</div></div>
      </div>

      <div class="card">
        <h2>Valores</h2>
        <div class="value-breakdown">
          <div class="item"><div class="muted">Peças</div><div style="font-size:18px;font-weight:600;">${formatMoney(os.valor_pecas)}</div></div>
          <div class="item"><div class="muted">Mão de obra</div><div style="font-size:18px;font-weight:600;">${formatMoney(os.valor_mao_obra)}</div></div>
          <div class="item"><div class="muted">Total</div><div style="font-size:18px;font-weight:600;color:#1f6b3a;">${formatMoney(totalValor(os))}</div></div>
          <div class="item"><div class="muted">Pagamento</div><div style="font-size:18px;font-weight:600;">${formaPagamentoLabel(os)}</div></div>
        </div>
      </div>

      <div class="card">
        <h2>Problema relatado pelo cliente</h2>
        <p>${os.problema_relatado ? escapeHtml(os.problema_relatado).replace(/\n/g, '<br>') : '<span class="muted">Nenhum problema relatado registrado.</span>'}</p>
      </div>

      <div class="card">
        <h2>Checklist de entrada</h2>
        ${
          checklist.length
            ? `<table><thead><tr><th>Item</th><th>Status</th><th>Observação</th></tr></thead><tbody>${checklistRows}</tbody></table>`
            : '<div class="empty">Nenhum checklist preenchido.</div>'
        }
        <h2 style="margin-top:20px;">Fotos da checagem</h2>
        ${mediaGrid(midiasChecklist, os.id, csrfToken)}
        <form method="POST" action="/os/${os.id}/midias" enctype="multipart/form-data" style="margin-top:12px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <input type="hidden" name="categoria" value="checklist">
          <div class="upload-box">
            <input type="file" name="arquivos" accept="image/*" multiple capture="environment">
            <button class="btn btn-sm" type="submit" style="margin-top:10px;">Enviar fotos da checagem</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Diagnóstico técnico</h2>
        <p>${os.diagnostico ? escapeHtml(os.diagnostico).replace(/\n/g, '<br>') : '<span class="muted">Nenhum diagnóstico registrado.</span>'}</p>
      </div>

      <div class="card">
        <h2>Serviços realizados</h2>
        <p>${os.servicos_realizados ? escapeHtml(os.servicos_realizados).replace(/\n/g, '<br>') : '<span class="muted">Nenhum serviço registrado ainda.</span>'}</p>
        <h2 style="margin-top:20px;">Fotos e vídeos dos serviços realizados</h2>
        ${mediaGrid(midiasServico, os.id, csrfToken)}
        <form method="POST" action="/os/${os.id}/midias" enctype="multipart/form-data" style="margin-top:12px;">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <input type="hidden" name="categoria" value="servico">
          <div class="upload-box">
            <input type="file" name="arquivos" accept="image/*,video/*" multiple capture="environment">
            <button class="btn btn-sm" type="submit" style="margin-top:10px;">Enviar fotos/vídeos do serviço</button>
          </div>
        </form>
        <p class="muted" style="margin-top:8px;">Arquivos até 20MB cada. No plano gratuito de hospedagem, esses arquivos podem ser apagados quando o servidor "dormir" por inatividade.</p>
      </div>

      <form method="POST" action="/os/${os.id}/excluir" onsubmit="return confirm('Tem certeza que deseja excluir esta ordem de serviço?');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn btn-danger btn-sm" type="submit">Excluir O.S.</button>
      </form>
    `,
  });
}

module.exports = {
  ordensListPage,
  ordemFormPage,
  ordemShowPage,
  CHECKLIST_ITEMS,
  STATUS_LABELS,
  totalValor,
  formaPagamentoLabel,
  FORMA_PAGAMENTO_LABELS,
};

'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate } = require('../utils');
const { STATUS_LABELS } = require('./dashboard');

const TIPO_VEICULO_LABELS = {
  bicicleta: 'Bicicleta elétrica',
  moto: 'Moto elétrica',
};

function sohBadge(soh) {
  if (soh === null || soh === undefined) return '-';
  const cls = soh < 90 ? 'badge-atencao' : 'badge-ok';
  return `<span class="badge ${cls}">${soh}%</span>`;
}

function bicicletasListPage({ user, flash, bicicletas }) {
  const rows = bicicletas
    .map(
      (b) => `
    <tr>
      <td><a class="link-btn" href="/bicicletas/${b.id}">${escapeHtml(b.marca || '')} ${escapeHtml(b.modelo)}</a></td>
      <td class="muted">${TIPO_VEICULO_LABELS[b.tipo_veiculo] || 'Bicicleta elétrica'}</td>
      <td>${escapeHtml(b.cliente_nome)}</td>
      <td>${sohBadge(b.bateria_soh_percent)}</td>
      <td>${b.bateria_ciclos_carga !== null ? b.bateria_ciclos_carga : '-'}</td>
      <td>${escapeHtml(b.bateria_serial || '-')}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Bicicletas',
    activeNav: 'bicicletas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Bicicletas</h1>
          <p class="subtitle">Frota cadastrada e saúde das baterias</p>
        </div>
        <a class="btn" href="/bicicletas/novo">+ Nova Bicicleta</a>
      </div>
      <div class="card">
        ${
          bicicletas.length
            ? `<table>
          <thead><tr><th>Veículo</th><th>Tipo</th><th>Cliente</th><th>SOH Bateria</th><th>Ciclos de carga</th><th>Nº série bateria</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhuma bicicleta cadastrada ainda. <a class="link-btn" href="/bicicletas/novo">Cadastrar a primeira</a></div>'
        }
      </div>
    `,
  });
}

function existingPhoto(midias, tipo) {
  return (midias || []).find((m) => m.tipo === tipo) || null;
}

function bicicletaFormPage({ user, flash, bicicleta, clientes, defaultClienteId, csrfToken, midias }) {
  const isEdit = !!bicicleta;
  const options = clientes
    .map(
      (c) =>
        `<option value="${c.id}" ${
          (bicicleta && bicicleta.cliente_id === c.id) || (!bicicleta && defaultClienteId == c.id) ? 'selected' : ''
        }>${escapeHtml(c.nome)}</option>`
    )
    .join('');

  const fotoChassi = existingPhoto(midias, 'chassi');
  const fotoBateria = existingPhoto(midias, 'bateria_serial');
  const isMoto = bicicleta && bicicleta.tipo_veiculo === 'moto';

  return layout({
    title: isEdit ? 'Editar Bicicleta' : 'Nova Bicicleta',
    activeNav: 'bicicletas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${isEdit ? 'Editar Bicicleta' : 'Nova Bicicleta'}</h1>
          <p class="subtitle">Dados técnicos de motor, controladora e bateria</p>
        </div>
      </div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/bicicletas/${bicicleta.id}` : '/bicicletas'}" enctype="multipart/form-data">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="cliente_id">Cliente (dono do veículo) *</label>
              <select id="cliente_id" name="cliente_id" required>
                <option value="">Selecione...</option>
                ${options}
              </select>
            </div>
            <div class="field full">
              <label for="tipo_veiculo">Tipo de veículo *</label>
              <select id="tipo_veiculo" name="tipo_veiculo" required onchange="toggleFotosObrigatorias()">
                <option value="bicicleta" ${!bicicleta || bicicleta.tipo_veiculo === 'bicicleta' ? 'selected' : ''}>Bicicleta elétrica</option>
                <option value="moto" ${bicicleta && bicicleta.tipo_veiculo === 'moto' ? 'selected' : ''}>Moto elétrica</option>
              </select>
            </div>
            <div class="field">
              <label for="marca">Marca</label>
              <input type="text" id="marca" name="marca" value="${escapeHtml(bicicleta ? bicicleta.marca : '')}">
            </div>
            <div class="field">
              <label for="modelo">Modelo *</label>
              <input type="text" id="modelo" name="modelo" required value="${escapeHtml(bicicleta ? bicicleta.modelo : '')}">
            </div>
            <div class="field">
              <label for="cor">Cor</label>
              <input type="text" id="cor" name="cor" value="${escapeHtml(bicicleta ? bicicleta.cor : '')}">
            </div>
            <div class="field">
              <label for="km_estimado">Quilometragem estimada</label>
              <input type="number" id="km_estimado" name="km_estimado" min="0" value="${bicicleta && bicicleta.km_estimado !== null ? bicicleta.km_estimado : ''}">
            </div>
          </div>

          <h2 style="margin-top:24px;">Componentes eletrônicos</h2>
          <div class="form-grid">
            <div class="field">
              <label for="motor_serial">Número de série do motor</label>
              <input type="text" id="motor_serial" name="motor_serial" value="${escapeHtml(bicicleta ? bicicleta.motor_serial : '')}">
            </div>
            <div class="field">
              <label for="controladora_serial">Número de série da controladora</label>
              <input type="text" id="controladora_serial" name="controladora_serial" value="${escapeHtml(bicicleta ? bicicleta.controladora_serial : '')}">
            </div>
            <div class="field">
              <label for="bateria_serial">Número de série da bateria</label>
              <input type="text" id="bateria_serial" name="bateria_serial" value="${escapeHtml(bicicleta ? bicicleta.bateria_serial : '')}">
            </div>
            <div class="field">
              <label for="bateria_soh_percent">Saúde da bateria — SOH (%)</label>
              <input type="number" id="bateria_soh_percent" name="bateria_soh_percent" min="0" max="100" value="${bicicleta && bicicleta.bateria_soh_percent !== null ? bicicleta.bateria_soh_percent : ''}">
            </div>
            <div class="field">
              <label for="bateria_ciclos_carga">Ciclos de carga acumulados</label>
              <input type="number" id="bateria_ciclos_carga" name="bateria_ciclos_carga" min="0" value="${bicicleta && bicicleta.bateria_ciclos_carga !== null ? bicicleta.bateria_ciclos_carga : ''}">
            </div>
            <div class="field full">
              <label for="observacoes">Observações técnicas</label>
              <textarea id="observacoes" name="observacoes">${escapeHtml(bicicleta ? bicicleta.observacoes : '')}</textarea>
            </div>
          </div>

          <h2 id="fotos-obrigatorias-titulo" style="margin-top:24px;">Fotos obrigatórias para motos elétricas</h2>
          <p class="muted" id="fotos-obrigatorias-desc">Foto do chassi (número/plaqueta de identificação) e foto do número de série da bateria.</p>
          <div class="form-grid">
            <div class="field">
              <label for="foto_chassi">Foto do chassi ${fotoChassi ? '(já enviada — envie outra para substituir)' : ''}</label>
              ${fotoChassi ? `<div class="media-grid" style="max-width:160px;margin-bottom:8px;"><div class="media-item"><a href="/uploads/${fotoChassi.caminho_arquivo}" target="_blank"><img src="/uploads/${fotoChassi.caminho_arquivo}" alt="Foto do chassi"></a></div></div>` : ''}
              <input type="file" id="foto_chassi" name="foto_chassi" accept="image/*" capture="environment">
            </div>
            <div class="field">
              <label for="foto_bateria_serial">Foto do nº de série da bateria ${fotoBateria ? '(já enviada — envie outra para substituir)' : ''}</label>
              ${fotoBateria ? `<div class="media-grid" style="max-width:160px;margin-bottom:8px;"><div class="media-item"><a href="/uploads/${fotoBateria.caminho_arquivo}" target="_blank"><img src="/uploads/${fotoBateria.caminho_arquivo}" alt="Foto da bateria"></a></div></div>` : ''}
              <input type="file" id="foto_bateria_serial" name="foto_bateria_serial" accept="image/*" capture="environment">
            </div>
          </div>

          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar bicicleta'}</button>
            <a class="btn btn-secondary" href="${isEdit ? `/bicicletas/${bicicleta.id}` : '/bicicletas'}">Cancelar</a>
          </div>
        </form>
      </div>

      <script>
        function toggleFotosObrigatorias() {
          var tipo = document.getElementById('tipo_veiculo').value;
          var isMoto = tipo === 'moto';
          var titulo = document.getElementById('fotos-obrigatorias-titulo');
          var desc = document.getElementById('fotos-obrigatorias-desc');
          var chassiInput = document.getElementById('foto_chassi');
          var bateriaInput = document.getElementById('foto_bateria_serial');
          titulo.style.display = isMoto ? '' : 'none';
          desc.style.display = isMoto ? '' : 'none';
          chassiInput.closest('.field').style.display = isMoto ? '' : 'none';
          bateriaInput.closest('.field').style.display = isMoto ? '' : 'none';
          // só marca como obrigatório se ainda não existe uma foto salva (para não travar edição já cadastrada)
          chassiInput.required = isMoto && ${fotoChassi ? 'false' : 'true'};
          bateriaInput.required = isMoto && ${fotoBateria ? 'false' : 'true'};
        }
        toggleFotosObrigatorias();
      </script>
    `,
  });
}

function bicicletaShowPage({ user, flash, bicicleta, ordensServico, midias, csrfToken }) {
  const fotoChassi = existingPhoto(midias, 'chassi');
  const fotoBateria = existingPhoto(midias, 'bateria_serial');
  const osRows = ordensServico
    .map(
      (os) => `
    <tr>
      <td><a class="link-btn" href="/os/${os.id}">${escapeHtml(os.numero)}</a></td>
      <td><span class="badge badge-${os.status}">${STATUS_LABELS[os.status] || os.status}</span></td>
      <td>${formatDate(os.data_entrada)}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: `${bicicleta.marca || ''} ${bicicleta.modelo}`,
    activeNav: 'bicicletas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${escapeHtml(bicicleta.marca || '')} ${escapeHtml(bicicleta.modelo)}</h1>
          <p class="subtitle">${TIPO_VEICULO_LABELS[bicicleta.tipo_veiculo] || 'Bicicleta elétrica'} · Dono(a): <a class="link-btn" href="/clientes/${bicicleta.cliente_id}">${escapeHtml(bicicleta.cliente_nome)}</a></p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          <a class="btn btn-secondary" href="/bicicletas/${bicicleta.id}/editar">Editar</a>
          <a class="btn" href="/os/novo?bicicleta_id=${bicicleta.id}">+ Nova O.S.</a>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${bicicleta.bateria_soh_percent !== null ? bicicleta.bateria_soh_percent + '%' : '-'}</div><div class="label">Saúde da bateria (SOH)</div></div>
        <div class="stat-card"><div class="num">${bicicleta.bateria_ciclos_carga !== null ? bicicleta.bateria_ciclos_carga : '-'}</div><div class="label">Ciclos de carga</div></div>
        <div class="stat-card"><div class="num">${bicicleta.km_estimado !== null ? bicicleta.km_estimado : '-'}</div><div class="label">Km estimados</div></div>
      </div>

      <div class="card">
        <h2>Componentes</h2>
        <table>
          <tbody>
            <tr><td style="width:220px;color:#6b6558;">Nº série do motor</td><td>${escapeHtml(bicicleta.motor_serial || '-')}</td></tr>
            <tr><td style="color:#6b6558;">Nº série da controladora</td><td>${escapeHtml(bicicleta.controladora_serial || '-')}</td></tr>
            <tr><td style="color:#6b6558;">Nº série da bateria</td><td>${escapeHtml(bicicleta.bateria_serial || '-')}</td></tr>
            <tr><td style="color:#6b6558;">Cor</td><td>${escapeHtml(bicicleta.cor || '-')}</td></tr>
          </tbody>
        </table>
        ${bicicleta.observacoes ? `<p class="muted" style="margin-top:12px;">${escapeHtml(bicicleta.observacoes)}</p>` : ''}
      </div>

      ${
        bicicleta.tipo_veiculo === 'moto'
          ? `<div class="card">
        <h2>Documentação fotográfica</h2>
        <div class="form-grid">
          <div class="field">
            <label>Foto do chassi</label>
            ${
              fotoChassi
                ? `<div class="media-grid" style="max-width:200px;"><div class="media-item"><a href="/uploads/${fotoChassi.caminho_arquivo}" target="_blank"><img src="/uploads/${fotoChassi.caminho_arquivo}" alt="Foto do chassi"></a></div></div>`
                : '<p class="muted">⚠ Não enviada ainda. <a class="link-btn" href="/bicicletas/' + bicicleta.id + '/editar">Enviar agora</a></p>'
            }
          </div>
          <div class="field">
            <label>Foto do nº de série da bateria</label>
            ${
              fotoBateria
                ? `<div class="media-grid" style="max-width:200px;"><div class="media-item"><a href="/uploads/${fotoBateria.caminho_arquivo}" target="_blank"><img src="/uploads/${fotoBateria.caminho_arquivo}" alt="Foto da bateria"></a></div></div>`
                : '<p class="muted">⚠ Não enviada ainda. <a class="link-btn" href="/bicicletas/' + bicicleta.id + '/editar">Enviar agora</a></p>'
            }
          </div>
        </div>
      </div>`
          : ''
      }

      <div class="card">
        <h2>Histórico de Ordens de Serviço (${ordensServico.length})</h2>
        ${
          ordensServico.length
            ? `<table><thead><tr><th>Número</th><th>Status</th><th>Entrada</th></tr></thead><tbody>${osRows}</tbody></table>`
            : '<div class="empty">Nenhuma O.S. registrada para esta bicicleta ainda.</div>'
        }
      </div>

      <form method="POST" action="/bicicletas/${bicicleta.id}/excluir" onsubmit="return confirm('Tem certeza que deseja excluir esta bicicleta?');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn btn-danger btn-sm" type="submit">Excluir bicicleta</button>
      </form>
    `,
  });
}

module.exports = { bicicletasListPage, bicicletaFormPage, bicicletaShowPage, TIPO_VEICULO_LABELS };

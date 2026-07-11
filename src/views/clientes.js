'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatDate } = require('../utils');
const { STATUS_LABELS } = require('./dashboard');

function clientesListPage({ user, flash, clientes }) {
  const rows = clientes
    .map(
      (c) => `
    <tr>
      <td><a class="link-btn" href="/clientes/${c.id}">${escapeHtml(c.nome)}</a></td>
      <td>${escapeHtml(c.telefone || '-')}</td>
      <td>${escapeHtml(c.email || '-')}</td>
      <td>${c.total_bicicletas}</td>
      <td>${formatDate(c.created_at)}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Clientes',
    activeNav: 'clientes',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Clientes</h1>
          <p class="subtitle">Lojas, oficinas e frotistas atendidos</p>
        </div>
        <a class="btn" href="/clientes/novo">+ Novo Cliente</a>
      </div>
      <div class="card">
        ${
          clientes.length
            ? `<table>
          <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Bicicletas</th><th>Cadastrado em</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
            : '<div class="empty">Nenhum cliente cadastrado ainda. <a class="link-btn" href="/clientes/novo">Cadastrar o primeiro</a></div>'
        }
      </div>
    `,
  });
}

function clienteFormPage({ user, flash, cliente, csrfToken }) {
  const isEdit = !!cliente;
  return layout({
    title: isEdit ? 'Editar Cliente' : 'Novo Cliente',
    activeNav: 'clientes',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${isEdit ? 'Editar Cliente' : 'Novo Cliente'}</h1>
          <p class="subtitle">${isEdit ? escapeHtml(cliente.nome) : 'Preencha os dados do cliente'}</p>
        </div>
      </div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/clientes/${cliente.id}` : '/clientes'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome / Razão social *</label>
              <input type="text" id="nome" name="nome" required value="${escapeHtml(cliente ? cliente.nome : '')}">
            </div>
            <div class="field">
              <label for="telefone">Telefone / WhatsApp</label>
              <input type="tel" id="telefone" name="telefone" value="${escapeHtml(cliente ? cliente.telefone : '')}">
            </div>
            <div class="field">
              <label for="email">E-mail</label>
              <input type="email" id="email" name="email" value="${escapeHtml(cliente ? cliente.email : '')}">
            </div>
            <div class="field full">
              <label for="endereco">Endereço</label>
              <input type="text" id="endereco" name="endereco" value="${escapeHtml(cliente ? cliente.endereco : '')}">
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes">${escapeHtml(cliente ? cliente.observacoes : '')}</textarea>
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar cliente'}</button>
            <a class="btn btn-secondary" href="${isEdit ? `/clientes/${cliente.id}` : '/clientes'}">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

function clienteShowPage({ user, flash, cliente, bicicletas, ordensServico, csrfToken }) {
  const bikeRows = bicicletas
    .map(
      (b) => `
    <tr>
      <td><a class="link-btn" href="/bicicletas/${b.id}">${escapeHtml(b.marca || '')} ${escapeHtml(b.modelo)}</a></td>
      <td>${b.bateria_soh_percent !== null ? b.bateria_soh_percent + '%' : '-'}</td>
      <td>${escapeHtml(b.bateria_serial || '-')}</td>
    </tr>`
    )
    .join('');

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
    title: cliente.nome,
    activeNav: 'clientes',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>${escapeHtml(cliente.nome)}</h1>
          <p class="subtitle">${escapeHtml(cliente.telefone || '')} ${cliente.telefone && cliente.email ? '·' : ''} ${escapeHtml(cliente.email || '')}</p>
        </div>
        <div class="actions-row" style="margin-top:0;">
          <a class="btn btn-secondary" href="/clientes/${cliente.id}/editar">Editar</a>
          <a class="btn" href="/bicicletas/novo?cliente_id=${cliente.id}">+ Nova Bicicleta</a>
        </div>
      </div>

      ${cliente.endereco ? `<p class="muted">📍 ${escapeHtml(cliente.endereco)}</p>` : ''}
      ${cliente.observacoes ? `<p class="muted">${escapeHtml(cliente.observacoes)}</p>` : ''}

      <div class="card">
        <h2>Bicicletas (${bicicletas.length})</h2>
        ${
          bicicletas.length
            ? `<table><thead><tr><th>Bicicleta</th><th>Saúde da bateria</th><th>Nº série bateria</th></tr></thead><tbody>${bikeRows}</tbody></table>`
            : '<div class="empty">Nenhuma bicicleta cadastrada para este cliente.</div>'
        }
      </div>

      <div class="card">
        <h2>Ordens de Serviço (${ordensServico.length})</h2>
        ${
          ordensServico.length
            ? `<table><thead><tr><th>Número</th><th>Status</th><th>Entrada</th></tr></thead><tbody>${osRows}</tbody></table>`
            : '<div class="empty">Nenhuma ordem de serviço para este cliente.</div>'
        }
      </div>

      <form method="POST" action="/clientes/${cliente.id}/excluir" onsubmit="return confirm('Tem certeza que deseja excluir este cliente? Isso também removerá suas bicicletas e ordens de serviço.');">
        <input type="hidden" name="csrf" value="${csrfToken}">
        <button class="btn btn-danger btn-sm" type="submit">Excluir cliente</button>
      </form>
    `,
  });
}

module.exports = { clientesListPage, clienteFormPage, clienteShowPage };

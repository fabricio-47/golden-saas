'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

function fornecedoresListPage({ user, flash, fornecedores }) {
  const rows = fornecedores
    .map(
      (f) => `
    <tr>
      <td><a class="link-btn" href="/fornecedores/${f.id}/editar">${escapeHtml(f.nome)}</a></td>
      <td>${escapeHtml(f.cnpj_cpf || '-')}</td>
      <td>${escapeHtml(f.telefone || '-')}</td>
      <td>${escapeHtml(f.email || '-')}</td>
      <td>${f.ativo ? '<span class="badge badge-ok">Ativo</span>' : '<span class="badge badge-desativada">Inativo</span>'}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Fornecedores',
    activeNav: 'fornecedores',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Fornecedores</h1>
          <p class="subtitle">Cadastro de fornecedores de peças e produtos</p>
        </div>
        <a class="btn" href="/fornecedores/novo">+ Novo Fornecedor</a>
      </div>
      <div class="card">
        ${
          fornecedores.length
            ? `<table><thead><tr><th>Nome</th><th>CNPJ/CPF</th><th>Telefone</th><th>E-mail</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhum fornecedor cadastrado ainda.</div>'
        }
      </div>
    `,
  });
}

function fornecedorFormPage({ user, flash, fornecedor, csrfToken }) {
  const isEdit = !!fornecedor;
  return layout({
    title: isEdit ? `Editar ${fornecedor.nome}` : 'Novo fornecedor',
    activeNav: 'fornecedores',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar fornecedor' : 'Novo fornecedor'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/fornecedores/${fornecedor.id}` : '/fornecedores'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome / Razão social *</label>
              <input type="text" id="nome" name="nome" required value="${escapeHtml(fornecedor ? fornecedor.nome : '')}">
            </div>
            <div class="field">
              <label for="cnpj_cpf">CNPJ ou CPF</label>
              <input type="text" id="cnpj_cpf" name="cnpj_cpf" value="${escapeHtml(fornecedor ? fornecedor.cnpj_cpf : '')}">
            </div>
            <div class="field">
              <label for="telefone">Telefone</label>
              <input type="text" id="telefone" name="telefone" value="${escapeHtml(fornecedor ? fornecedor.telefone : '')}">
            </div>
            <div class="field">
              <label for="email">E-mail</label>
              <input type="email" id="email" name="email" value="${escapeHtml(fornecedor ? fornecedor.email : '')}">
            </div>
            <div class="field">
              <label for="endereco">Endereço</label>
              <input type="text" id="endereco" name="endereco" value="${escapeHtml(fornecedor ? fornecedor.endereco : '')}">
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes">${escapeHtml(fornecedor ? fornecedor.observacoes : '')}</textarea>
            </div>
            ${
              isEdit
                ? `<div class="field">
              <label for="ativo">Situação</label>
              <select id="ativo" name="ativo">
                <option value="1" ${fornecedor.ativo ? 'selected' : ''}>Ativo</option>
                <option value="0" ${!fornecedor.ativo ? 'selected' : ''}>Inativo</option>
              </select>
            </div>`
                : ''
            }
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar fornecedor'}</button>
            <a class="btn btn-secondary" href="/fornecedores">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { fornecedoresListPage, fornecedorFormPage };

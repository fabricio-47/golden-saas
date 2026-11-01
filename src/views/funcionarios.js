'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

function funcionariosListPage({ user, flash, funcionarios }) {
  const rows = funcionarios
    .map(
      (f) => `
    <tr>
      <td><a class="link-btn" href="/funcionarios/${f.id}/editar">${escapeHtml(f.nome)}</a></td>
      <td>${escapeHtml(f.funcao || '-')}</td>
      <td>${escapeHtml(f.telefone || '-')}</td>
      <td>${f.ativo ? '<span class="badge badge-ok">Ativo</span>' : '<span class="badge badge-desativada">Inativo</span>'}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Funcionários',
    activeNav: 'funcionarios',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Funcionários</h1>
          <p class="subtitle">Equipe da oficina — técnicos e vendedores atribuídos nas O.S.</p>
        </div>
        <a class="btn" href="/funcionarios/novo">+ Novo Funcionário</a>
      </div>
      <div class="card">
        ${
          funcionarios.length
            ? `<table><thead><tr><th>Nome</th><th>Função</th><th>Telefone</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhum funcionário cadastrado ainda.</div>'
        }
      </div>
    `,
  });
}

function funcionarioFormPage({ user, flash, funcionario, csrfToken }) {
  const isEdit = !!(funcionario && funcionario.id);
  return layout({
    title: isEdit ? `Editar ${funcionario.nome}` : 'Novo funcionário',
    activeNav: 'funcionarios',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar funcionário' : 'Novo funcionário'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/funcionarios/${funcionario.id}` : '/funcionarios'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome *</label>
              <input type="text" id="nome" name="nome" required value="${escapeHtml(funcionario ? funcionario.nome : '')}">
            </div>
            <div class="field">
              <label for="funcao">Função / Cargo</label>
              <input type="text" id="funcao" name="funcao" value="${escapeHtml(funcionario ? funcionario.funcao || '' : '')}" placeholder="Ex: Técnico, Vendedor, Mecânico...">
            </div>
            <div class="field">
              <label for="telefone">Telefone</label>
              <input type="text" id="telefone" name="telefone" value="${escapeHtml(funcionario ? funcionario.telefone || '' : '')}">
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes">${escapeHtml(funcionario ? funcionario.observacoes || '' : '')}</textarea>
            </div>
            ${
              isEdit
                ? `<div class="field">
              <label for="ativo">Situação</label>
              <select id="ativo" name="ativo">
                <option value="1" ${funcionario.ativo ? 'selected' : ''}>Ativo</option>
                <option value="0" ${!funcionario.ativo ? 'selected' : ''}>Inativo</option>
              </select>
            </div>`
                : ''
            }
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar funcionário'}</button>
            <a class="btn btn-secondary" href="/funcionarios">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { funcionariosListPage, funcionarioFormPage };

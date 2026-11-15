'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

function transportadorasListPage({ user, flash, transportadoras }) {
  const rows = transportadoras
    .map(
      (t) => `
    <tr>
      <td><a class="link-btn" href="/transportadoras/${t.id}/editar">${escapeHtml(t.nome)}</a></td>
      <td>${escapeHtml(t.cnpj_cpf || '-')}</td>
      <td>${escapeHtml(t.telefone || '-')}</td>
      <td>${escapeHtml(t.email || '-')}</td>
      <td>${t.ativo ? '<span class="badge badge-ok">Ativo</span>' : '<span class="badge badge-desativada">Inativo</span>'}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Transportadoras',
    activeNav: 'transportadoras',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Transportadoras</h1>
          <p class="subtitle">Cadastro de transportadoras (quem faz suas entregas)</p>
        </div>
        <a class="btn" href="/transportadoras/novo">+ Nova Transportadora</a>
      </div>
      <div class="card">
        ${
          transportadoras.length
            ? `<table><thead><tr><th>Nome</th><th>CNPJ/CPF</th><th>Telefone</th><th>E-mail</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhuma transportadora cadastrada ainda.</div>'
        }
      </div>
    `,
  });
}

function transportadoraFormPage({ user, flash, transportadora, csrfToken }) {
  const isEdit = !!transportadora;
  return layout({
    title: isEdit ? `Editar ${transportadora.nome}` : 'Nova transportadora',
    activeNav: 'transportadoras',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar transportadora' : 'Nova transportadora'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/transportadoras/${transportadora.id}` : '/transportadoras'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome / Razão social *</label>
              <input type="text" id="nome" name="nome" required value="${escapeHtml(transportadora ? transportadora.nome : '')}">
            </div>
            <div class="field">
              <label for="cnpj_cpf">CNPJ ou CPF</label>
              <input type="text" id="cnpj_cpf" name="cnpj_cpf" value="${escapeHtml(transportadora ? transportadora.cnpj_cpf : '')}">
            </div>
            <div class="field">
              <label for="telefone">Telefone</label>
              <input type="text" id="telefone" name="telefone" value="${escapeHtml(transportadora ? transportadora.telefone : '')}">
            </div>
            <div class="field">
              <label for="email">E-mail</label>
              <input type="email" id="email" name="email" value="${escapeHtml(transportadora ? transportadora.email : '')}">
            </div>
            <div class="field">
              <label for="endereco">Endereço</label>
              <input type="text" id="endereco" name="endereco" value="${escapeHtml(transportadora ? transportadora.endereco : '')}">
            </div>
            <div class="field full">
              <label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes">${escapeHtml(transportadora ? transportadora.observacoes : '')}</textarea>
            </div>
            ${
              isEdit
                ? `<div class="field">
              <label for="ativo">Situação</label>
              <select id="ativo" name="ativo">
                <option value="1" ${transportadora.ativo ? 'selected' : ''}>Ativo</option>
                <option value="0" ${!transportadora.ativo ? 'selected' : ''}>Inativo</option>
              </select>
            </div>`
                : ''
            }
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar transportadora'}</button>
            <a class="btn btn-secondary" href="/transportadoras">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { transportadorasListPage, transportadoraFormPage };

'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

function lojasListPage({ user, flash, lojas }) {
  const rows = lojas
    .map(
      (l) => `
    <tr>
      <td><a class="link-btn" href="/lojas/${l.id}/editar">${escapeHtml(l.nome)}</a></td>
      <td>${escapeHtml(l.endereco || '-')}</td>
      <td>${escapeHtml(l.telefone || '-')}</td>
      <td>${l.ativo ? '<span class="badge badge-ok">Ativa</span>' : '<span class="badge badge-desativada">Inativa</span>'}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Lojas',
    activeNav: 'lojas',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Lojas</h1>
          <p class="subtitle">Unidades da rede — cada loja tem seu próprio estoque</p>
        </div>
        <a class="btn" href="/lojas/novo">+ Nova Loja</a>
      </div>
      <div class="card">
        ${
          lojas.length
            ? `<table><thead><tr><th>Nome</th><th>Endereço</th><th>Telefone</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhuma loja cadastrada.</div>'
        }
      </div>
    `,
  });
}

function lojaFormPage({ user, flash, loja, csrfToken }) {
  const isEdit = !!loja;
  return layout({
    title: isEdit ? `Editar ${loja.nome}` : 'Nova loja',
    activeNav: 'lojas',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar loja' : 'Nova loja'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/lojas/${loja.id}` : '/lojas'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome da loja *</label>
              <input type="text" id="nome" name="nome" required value="${escapeHtml(loja ? loja.nome : '')}" placeholder="Ex: Loja Centro">
            </div>
            <div class="field">
              <label for="endereco">Endereço</label>
              <input type="text" id="endereco" name="endereco" value="${escapeHtml(loja ? loja.endereco : '')}">
            </div>
            <div class="field">
              <label for="telefone">Telefone</label>
              <input type="text" id="telefone" name="telefone" value="${escapeHtml(loja ? loja.telefone : '')}">
            </div>
            ${
              isEdit
                ? `<div class="field">
              <label for="ativo">Situação</label>
              <select id="ativo" name="ativo">
                <option value="1" ${loja.ativo ? 'selected' : ''}>Ativa</option>
                <option value="0" ${!loja.ativo ? 'selected' : ''}>Inativa</option>
              </select>
            </div>`
                : ''
            }
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar loja'}</button>
            <a class="btn btn-secondary" href="/lojas">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { lojasListPage, lojaFormPage };

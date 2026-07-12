'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');
const { ROLES, ROLE_LABELS } = require('../roles');

function usuariosListPage({ user, flash, usuarios, csrfToken }) {
  const rows = usuarios
    .map((u) => {
      const isSelf = String(u.id) === String(user.id);
      const actionBtn = isSelf
        ? '<span class="muted">Você</span>'
        : u.ativo
        ? `<form method="POST" action="/usuarios/${u.id}/desativar" onsubmit="return confirm('Desativar este usuário? Ele não vai conseguir mais entrar no sistema.');">
             <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
             <button class="btn btn-sm btn-danger" type="submit">Desativar</button>
           </form>`
        : `<form method="POST" action="/usuarios/${u.id}/ativar">
             <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
             <button class="btn btn-sm" type="submit">Reativar</button>
           </form>`;
      return `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge badge-role">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td>${u.ativo ? '<span class="badge badge-ok">Ativo</span>' : '<span class="badge badge-desativada">Inativo</span>'}</td>
      <td>
        <div class="actions-row" style="margin:0;gap:8px;">
          <a class="btn btn-sm btn-secondary" href="/usuarios/${u.id}/editar">Editar</a>
          ${actionBtn}
        </div>
      </td>
    </tr>`;
    })
    .join('');

  return layout({
    title: 'Usuários',
    activeNav: 'usuarios',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Usuários</h1>
          <p class="subtitle">Gerencie quem tem acesso ao sistema e o nível de cada um</p>
        </div>
        <a class="btn" href="/usuarios/novo">+ Novo Usuário</a>
      </div>
      <div class="card">
        ${
          usuarios.length
            ? `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Nível</th><th>Situação</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhum usuário cadastrado.</div>'
        }
      </div>
    `,
  });
}

function usuarioFormPage({ user, flash, usuario, csrfToken }) {
  const isEdit = !!usuario;
  const roleOptions = ROLES.map(
    (r) => `<option value="${r}" ${usuario && usuario.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`
  ).join('');

  return layout({
    title: isEdit ? `Editar ${usuario.name}` : 'Novo usuário',
    activeNav: 'usuarios',
    user,
    flash,
    children: `
      <div class="page-header">
        <div><h1>${isEdit ? 'Editar usuário' : 'Novo usuário'}</h1></div>
      </div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/usuarios/${usuario.id}` : '/usuarios'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="name">Nome *</label>
              <input type="text" id="name" name="name" required value="${escapeHtml(usuario ? usuario.name : '')}">
            </div>
            <div class="field">
              <label for="email">E-mail *</label>
              <input type="email" id="email" name="email" required value="${escapeHtml(usuario ? usuario.email : '')}">
            </div>
            <div class="field">
              <label for="role">Nível de acesso *</label>
              <select id="role" name="role">${roleOptions}</select>
            </div>
            <div class="field">
              <label for="password">${isEdit ? 'Nova senha (deixe em branco para manter a atual)' : 'Senha *'}</label>
              <input type="password" id="password" name="password" ${isEdit ? '' : 'required'} autocomplete="new-password">
            </div>
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar usuário'}</button>
            <a class="btn btn-secondary" href="/usuarios">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { usuariosListPage, usuarioFormPage };

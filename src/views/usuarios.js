'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

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
      <td><span class="badge badge-role">${escapeHtml(u.nivel_nome || '(sem nível)')}</span></td>
      <td>${u.loja_nome ? escapeHtml(u.loja_nome) : '<span class="muted">Todas as lojas</span>'}${u.pode_ver_outras_lojas ? ' <span class="badge badge-role">+ outras lojas</span>' : ''}</td>
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
          <p class="subtitle">Gerencie quem tem acesso ao sistema, o nível e a loja de cada um</p>
        </div>
        <a class="btn" href="/usuarios/novo">+ Novo Usuário</a>
      </div>
      <div class="card">
        ${
          usuarios.length
            ? `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Nível</th><th>Loja</th><th>Situação</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhum usuário cadastrado.</div>'
        }
      </div>
    `,
  });
}

function usuarioFormPage({ user, flash, usuario, csrfToken, lojas, niveis }) {
  const isEdit = !!usuario;
  const nivelOptions = niveis
    .map(
      (n) => `<option value="${n.id}" ${usuario && String(usuario.nivel_id) === String(n.id) ? 'selected' : ''}>${escapeHtml(n.nome)}</option>`
    )
    .join('');
  const lojaOptions = lojas
    .map((l) => `<option value="${l.id}" ${usuario && String(usuario.loja_id) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`)
    .join('');

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
              <label for="nivel_id">Nível de acesso *</label>
              <select id="nivel_id" name="nivel_id" required>
                <option value="">Selecione...</option>
                ${nivelOptions}
              </select>
              <p class="muted" style="margin-top:4px;">Gerencie os níveis disponíveis em Configurações → Níveis de permissão.</p>
            </div>
            <div class="field">
              <label for="password">${isEdit ? 'Nova senha (deixe em branco para manter a atual)' : 'Senha *'}</label>
              <input type="password" id="password" name="password" ${isEdit ? '' : 'required'} autocomplete="new-password">
            </div>
            <div class="field">
              <label for="loja_id">Loja</label>
              <select id="loja_id" name="loja_id">
                <option value="">Todas as lojas (Direção/Gerência)</option>
                ${lojaOptions}
              </select>
              <p class="muted" style="margin-top:4px;">Vendedor e Mecânico devem ficar amarrados a uma loja específica.</p>
            </div>
            <div class="field" style="display:flex;align-items:center;gap:8px;padding-top:26px;">
              <input type="checkbox" id="pode_ver_outras_lojas" name="pode_ver_outras_lojas" value="1" style="width:auto;" ${usuario && usuario.pode_ver_outras_lojas ? 'checked' : ''}>
              <label for="pode_ver_outras_lojas" style="margin:0;">Pode ver o estoque de outras lojas (só visualizar)</label>
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

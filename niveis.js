'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');
const { MODULOS } = require('../roles');

function niveisPage({ user, flash, niveis, permissoesPorNivel, csrfToken }) {
  const niveisRowsHtml = niveis
    .map(
      (n) => `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
      <form method="POST" action="/niveis/${n.id}/renomear" style="flex:1;display:flex;gap:10px;align-items:center;margin:0;">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <input type="text" name="nome" value="${escapeHtml(n.nome)}" required>
        <button class="btn btn-sm btn-secondary" type="submit" style="flex-shrink:0;">Salvar nome</button>
      </form>
      <form method="POST" action="/niveis/${n.id}/excluir" style="margin:0;" onsubmit="return confirm('Excluir o nível \\u201c${escapeHtml(n.nome)}\\u201d? Só funciona se nenhum usuário estiver usando esse nível.');">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <button class="btn btn-sm btn-danger" type="submit">Excluir</button>
      </form>
    </div>`
    )
    .join('');

  const theadModulos = MODULOS.map((m) => `<th style="text-align:center;">${escapeHtml(m.label)}</th>`).join('');

  const matrizRows = niveis
    .map((n) => {
      const perms = permissoesPorNivel[n.id] || {};
      const cells = MODULOS.map(
        (m) => `<td style="text-align:center;">
          <input type="checkbox" name="perm_${n.id}_${m.key}" value="1" ${perms[m.key] ? 'checked' : ''} style="width:auto;">
        </td>`
      ).join('');
      return `<tr><td>${escapeHtml(n.nome)}</td>${cells}</tr>`;
    })
    .join('');

  return layout({
    title: 'Níveis de permissão',
    activeNav: 'niveis',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Níveis de permissão</h1>
          <p class="subtitle">Defina os níveis (ex.: Vendedor, Financeiro) e marque o que cada um pode ver no sistema.</p>
        </div>
      </div>

      <div class="card">
        <form method="POST" action="/niveis" style="display:flex;gap:10px;align-items:flex-end;margin:0;">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <div class="field" style="flex:1;margin:0;">
            <label for="nome-novo-nivel">Nome do novo nível</label>
            <input type="text" id="nome-novo-nivel" name="nome" placeholder="ex.: Vendedor" required>
          </div>
          <button class="btn" type="submit" style="flex-shrink:0;">+ Novo nível</button>
        </form>
      </div>

      <div class="card">
        <h2>Seus níveis</h2>
        ${niveis.length ? niveisRowsHtml : '<div class="empty">Nenhum nível cadastrado ainda.</div>'}
      </div>

      <div class="card">
        <h2>O que cada nível pode ver</h2>
        ${
          niveis.length
            ? `<form method="POST" action="/niveis/permissoes">
                <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
                <div style="overflow-x:auto;">
                  <table>
                    <thead><tr><th>Nível</th>${theadModulos}</tr></thead>
                    <tbody>${matrizRows}</tbody>
                  </table>
                </div>
                <p class="muted" style="margin-top:12px;">Quem tem acesso a "Configurações" também consegue criar/editar usuários e mudar estas permissões — libere com cuidado.</p>
                <div class="actions-row">
                  <button class="btn" type="submit">Salvar permissões</button>
                </div>
              </form>`
            : '<div class="empty">Crie ao menos um nível para configurar as permissões.</div>'
        }
      </div>
    `,
  });
}

module.exports = { niveisPage };

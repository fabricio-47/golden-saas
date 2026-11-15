'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

const TIPOS = { texto: 'Texto', numero: 'Número', data: 'Data' };

function camposExtrasListPage({ user, flash, campos }) {
  const rows = campos
    .map(
      (c) => `
    <tr>
      <td><a class="link-btn" href="/campos-extras/${c.id}/editar">${escapeHtml(c.nome)}</a></td>
      <td>${TIPOS[c.tipo] || c.tipo}</td>
      <td>${c.obrigatorio ? 'Sim' : 'Não'}</td>
      <td>${c.ativo ? '<span class="badge badge-ok">Ativo</span>' : '<span class="badge badge-desativada">Inativo</span>'}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Campos extras',
    activeNav: 'campos-extras',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Campos extras</h1>
          <p class="subtitle">Campos personalizados que aparecem no cadastro de cliente (ex.: aniversário, código interno)</p>
        </div>
        <a class="btn" href="/campos-extras/novo">+ Novo campo</a>
      </div>
      <div class="card">
        ${
          campos.length
            ? `<table><thead><tr><th>Nome</th><th>Tipo</th><th>Obrigatório</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhum campo extra criado ainda. Crie campos que o cadastro padrão não tem.</div>'
        }
      </div>
    `,
  });
}

function campoExtraFormPage({ user, flash, campo, csrfToken }) {
  const isEdit = !!campo;
  const tipoAtual = campo ? campo.tipo : 'texto';
  const tipoOptions = Object.entries(TIPOS)
    .map(([v, label]) => `<option value="${v}" ${tipoAtual === v ? 'selected' : ''}>${label}</option>`)
    .join('');
  return layout({
    title: isEdit ? `Editar ${campo.nome}` : 'Novo campo extra',
    activeNav: 'campos-extras',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar campo extra' : 'Novo campo extra'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/campos-extras/${campo.id}` : '/campos-extras'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome do campo *</label>
              <input type="text" id="nome" name="nome" required value="${escapeHtml(campo ? campo.nome : '')}" placeholder="Ex.: Data de aniversário">
            </div>
            <div class="field">
              <label for="tipo">Tipo</label>
              <select id="tipo" name="tipo">${tipoOptions}</select>
            </div>
            <div class="field">
              <label for="ordem">Ordem (menor aparece primeiro)</label>
              <input type="number" id="ordem" name="ordem" step="1" value="${campo ? campo.ordem : 0}">
            </div>
            <div class="field">
              <label style="display:flex;align-items:center;gap:8px;font-weight:normal;margin-top:24px;">
                <input type="checkbox" name="obrigatorio" value="1" ${campo && campo.obrigatorio ? 'checked' : ''} style="width:auto;"> Preenchimento obrigatório
              </label>
            </div>
            ${
              isEdit
                ? `<div class="field">
              <label for="ativo">Situação</label>
              <select id="ativo" name="ativo">
                <option value="1" ${campo.ativo ? 'selected' : ''}>Ativo</option>
                <option value="0" ${!campo.ativo ? 'selected' : ''}>Inativo (some do cadastro)</option>
              </select>
            </div>`
                : ''
            }
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Criar campo'}</button>
            <a class="btn btn-secondary" href="/campos-extras">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

// Bloco HTML dos campos extras para embutir no formulário de cliente.
function camposExtrasClienteHtml(campos, valores) {
  if (!campos || !campos.length) return '';
  const fields = campos
    .map((c) => {
      const val = valores && valores[c.id] != null ? valores[c.id] : '';
      const req = c.obrigatorio ? 'required' : '';
      const tipoInput = c.tipo === 'numero' ? 'number' : c.tipo === 'data' ? 'date' : 'text';
      const step = c.tipo === 'numero' ? 'step="any"' : '';
      return `
        <div class="field">
          <label for="campo_extra_${c.id}">${escapeHtml(c.nome)}${c.obrigatorio ? ' *' : ''}</label>
          <input type="${tipoInput}" ${step} id="campo_extra_${c.id}" name="campo_extra_${c.id}" value="${escapeHtml(String(val))}" ${req}>
        </div>`;
    })
    .join('');
  return `
    <h2 style="margin-top:24px;">Informações adicionais</h2>
    <div class="form-grid">${fields}</div>`;
}

module.exports = { camposExtrasListPage, campoExtraFormPage, camposExtrasClienteHtml, TIPOS };

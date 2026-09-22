'use strict';

const { layout } = require('./layout');
const { escapeHtml, formatMoney } = require('../utils');

function tiposServicoListPage({ user, flash, servicos }) {
  const rows = servicos
    .map(
      (s) => `
    <tr>
      <td><a class="link-btn" href="/servicos/${s.id}/editar">${escapeHtml(s.nome)}</a></td>
      <td>${escapeHtml(s.categoria || '-')}</td>
      <td>${formatMoney(s.valor)}</td>
      <td>${s.ativo ? '<span class="badge badge-ok">Ativo</span>' : '<span class="badge badge-desativada">Inativo</span>'}</td>
    </tr>`
    )
    .join('');

  return layout({
    title: 'Tipos de Serviço',
    activeNav: 'servicos',
    user,
    flash,
    children: `
      <div class="page-header">
        <div>
          <h1>Tipos de Serviço</h1>
          <p class="subtitle">Catálogo de serviços e valores de mão de obra, usado como sugestão ao preencher uma O.S.</p>
        </div>
        <a class="btn" href="/servicos/novo">+ Novo Tipo de Serviço</a>
      </div>
      <div class="card">
        ${
          servicos.length
            ? `<table><thead><tr><th>Nome</th><th>Categoria</th><th>Valor</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">Nenhum tipo de serviço cadastrado ainda.</div>'
        }
      </div>
    `,
  });
}

function tipoServicoFormPage({ user, flash, servico, csrfToken }) {
  const isEdit = !!servico;
  return layout({
    title: isEdit ? `Editar ${servico.nome}` : 'Novo tipo de serviço',
    activeNav: 'servicos',
    user,
    flash,
    children: `
      <div class="page-header"><div><h1>${isEdit ? 'Editar tipo de serviço' : 'Novo tipo de serviço'}</h1></div></div>
      <div class="card">
        <form method="POST" action="${isEdit ? `/servicos/${servico.id}` : '/servicos'}">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field full">
              <label for="nome">Nome do serviço *</label>
              <input type="text" id="nome" name="nome" required placeholder="Ex: Revisão completa, Troca de pastilha, Diagnóstico elétrico" value="${escapeHtml(servico ? servico.nome : '')}">
            </div>
            <div class="field">
              <label for="categoria">Categoria</label>
              <input type="text" id="categoria" name="categoria" placeholder="Ex: Revisão, Elétrica, Freios" value="${escapeHtml(servico ? servico.categoria : '')}">
            </div>
            <div class="field">
              <label for="valor">Valor da mão de obra (R$) *</label>
              <input type="number" id="valor" name="valor" min="0" step="0.01" required value="${servico && servico.valor !== null ? servico.valor : ''}">
            </div>
            ${
              isEdit
                ? `<div class="field">
              <label for="ativo">Situação</label>
              <select id="ativo" name="ativo">
                <option value="1" ${servico.ativo ? 'selected' : ''}>Ativo</option>
                <option value="0" ${!servico.ativo ? 'selected' : ''}>Inativo</option>
              </select>
            </div>`
                : ''
            }
          </div>
          <div class="actions-row">
            <button class="btn" type="submit">${isEdit ? 'Salvar alterações' : 'Cadastrar tipo de serviço'}</button>
            <a class="btn btn-secondary" href="/servicos">Cancelar</a>
          </div>
        </form>
      </div>
    `,
  });
}

module.exports = { tiposServicoListPage, tipoServicoFormPage };

'use strict';

const { layout } = require('./layout');
const { escapeHtml } = require('../utils');

// Cargos que aparecem na lista do cadastro. Para incluir um novo, é só acrescentar aqui.
const CARGOS = [
  'Técnico',
  'Mecânico',
  'Vendedor',
  'Atendente',
  'Caixa',
  'Gerente',
  'Auxiliar administrativo',
  'Financeiro',
  'Entregador',
];

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

function funcionarioFormPage({ user, flash, funcionario, csrfToken, niveis, lojas, jaTemAcesso, convitePendente, podeDarAcesso }) {
  const isEdit = !!(funcionario && funcionario.id);
  const nivelOptions = (niveis || []).map((n) => `<option value="${n.id}">${escapeHtml(n.nome)}</option>`).join('');
  const lojaOptions = (lojas || []).map((l) => `<option value="${l.id}">${escapeHtml(l.nome)}</option>`).join('');
  const funcaoAtual = funcionario ? funcionario.funcao || '' : '';
  const funcaoOutro = !!funcaoAtual && !CARGOS.includes(funcaoAtual);
  const cargoOptions = CARGOS.map(
    (c) => `<option value="${escapeHtml(c)}" ${c === funcaoAtual ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');

  let acessoHtml = '';
  if (isEdit && podeDarAcesso) {
    if (jaTemAcesso) {
      acessoHtml = `
      <div class="card">
        <h2 style="margin-top:0;">Acesso ao sistema</h2>
        <p>Este funcionário já tem login <span class="badge badge-ok">Com acesso</span>${funcionario.email ? ` — <strong>${escapeHtml(funcionario.email)}</strong>` : ''}.</p>
        <p class="muted">A senha é definida pelo próprio funcionário. Para gerenciar o usuário (nível, desativar), vá em Configurações → Usuários.</p>
      </div>`;
    } else if (!funcionario.email) {
      acessoHtml = `
      <div class="card">
        <h2 style="margin-top:0;">Acesso ao sistema</h2>
        <p class="muted">Cadastre um <strong>e-mail</strong> acima e salve para poder enviar o convite de acesso. O funcionário recebe um link, valida e cria a própria senha.</p>
      </div>`;
    } else {
      acessoHtml = `
      <div class="card">
        <h2 style="margin-top:0;">Acesso ao sistema</h2>
        <p class="muted">Enviar um convite para <strong>${escapeHtml(funcionario.email)}</strong>. O funcionário recebe um link, valida o e-mail e <strong>cria a própria senha</strong>.</p>
        ${convitePendente ? '<p class="muted">Já existe um convite pendente — enviar de novo gera um link novo.</p>' : ''}
        <form method="POST" action="/funcionarios/${funcionario.id}/convite">
          <input type="hidden" name="csrf" value="${csrfToken}">
          <div class="form-grid">
            <div class="field">
              <label for="nivel_id">Nível de acesso do login</label>
              <select id="nivel_id" name="nivel_id" required>
                <option value="">Selecione...</option>
                ${nivelOptions}
              </select>
            </div>
            ${
              lojas && lojas.length
                ? `<div class="field">
              <label for="loja_id">Loja do funcionário</label>
              <select id="loja_id" name="loja_id">
                <option value="">Todas (direção/gerência)</option>
                ${lojaOptions}
              </select>
            </div>`
                : ''
            }
          </div>
          <button class="btn" type="submit">✉ Enviar convite de acesso</button>
        </form>
      </div>`;
    }
  }
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
              <label for="funcao_sel">Função / Cargo</label>
              <select id="funcao_sel">
                <option value="" ${!funcaoAtual ? 'selected' : ''}>Selecione...</option>
                ${cargoOptions}
                <option value="__outro" ${funcaoOutro ? 'selected' : ''}>Outro (digitar)</option>
              </select>
              <input type="text" id="funcao" name="funcao" value="${escapeHtml(funcaoAtual)}" placeholder="Digite o cargo" style="margin-top:8px;${funcaoOutro ? '' : 'display:none;'}">
            </div>
            <div class="field">
              <label for="telefone">Telefone</label>
              <input type="text" id="telefone" name="telefone" value="${escapeHtml(funcionario ? funcionario.telefone || '' : '')}">
            </div>
            <div class="field full">
              <label for="email">E-mail (para dar acesso ao sistema)</label>
              <input type="email" id="email" name="email" value="${escapeHtml(funcionario ? funcionario.email || '' : '')}" placeholder="Ex: funcionario@email.com">
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
      ${acessoHtml}
      <script>
        (function () {
          var sel = document.getElementById('funcao_sel');
          var inp = document.getElementById('funcao');
          if (!sel || !inp) return;
          sel.addEventListener('change', function () {
            if (sel.value === '__outro') {
              inp.style.display = '';
              inp.value = '';
              inp.focus();
            } else {
              inp.style.display = 'none';
              inp.value = sel.value;
            }
          });
        })();
      </script>
    `,
  });
}

module.exports = { funcionariosListPage, funcionarioFormPage };

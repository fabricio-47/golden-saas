'use strict';

const { db } = require('./db');

// Módulos do sistema que podem ser liberados/bloqueados por nível de permissão.
// A ordem aqui é a ordem em que aparecem na matriz da tela "Níveis de permissão".
const MODULOS = [
  { key: 'painel', label: 'Painel' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'bicicletas', label: 'Bicicletas' },
  { key: 'os', label: 'Ordens de Serviço' },
  { key: 'vendas', label: 'Venda Direto' },
  { key: 'estoque', label: 'Estoque' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'configuracoes', label: 'Configurações' },
];
const MODULO_KEYS = MODULOS.map((m) => m.key);

function listNiveis() {
  return db.prepare('SELECT * FROM niveis_permissao ORDER BY id ASC').all();
}

function getNivel(nivelId) {
  if (!nivelId) return null;
  return db.prepare('SELECT * FROM niveis_permissao WHERE id = ?').get(nivelId);
}

// Retorna { modulo: 0|1, ... } para todos os módulos conhecidos, para um nível.
function getNivelPermissoesMap(nivelId) {
  const map = {};
  for (const modulo of MODULO_KEYS) map[modulo] = 0;
  if (!nivelId) return map;
  const rows = db.prepare('SELECT modulo, pode_ver FROM nivel_permissoes WHERE nivel_id = ?').all(nivelId);
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(map, r.modulo)) map[r.modulo] = r.pode_ver ? 1 : 0;
  }
  return map;
}

function createNivel(nome) {
  const nomeLimpo = (nome || '').trim();
  if (!nomeLimpo) throw new Error('Nome do nível é obrigatório.');
  const existente = db.prepare('SELECT id FROM niveis_permissao WHERE nome = ?').get(nomeLimpo);
  if (existente) throw new Error('Já existe um nível com esse nome.');
  const info = db.prepare('INSERT INTO niveis_permissao (nome) VALUES (?)').run(nomeLimpo);
  const nivelId = info.lastInsertRowid;
  // novo nível nasce sem nenhum módulo liberado, por segurança — quem criar
  // precisa marcar explicitamente o que esse nível pode ver.
  const insPerm = db.prepare('INSERT INTO nivel_permissoes (nivel_id, modulo, pode_ver) VALUES (?, ?, 0)');
  for (const modulo of MODULO_KEYS) insPerm.run(nivelId, modulo);
  return nivelId;
}

function renameNivel(nivelId, novoNome) {
  const nomeLimpo = (novoNome || '').trim();
  if (!nomeLimpo) throw new Error('Nome do nível é obrigatório.');
  const dup = db.prepare('SELECT id FROM niveis_permissao WHERE nome = ? AND id != ?').get(nomeLimpo, nivelId);
  if (dup) throw new Error('Já existe um nível com esse nome.');
  const info = db.prepare('UPDATE niveis_permissao SET nome = ? WHERE id = ?').run(nomeLimpo, nivelId);
  if (info.changes === 0) throw new Error('Nível não encontrado.');
}

function deleteNivel(nivelId) {
  const emUso = db.prepare('SELECT COUNT(*) c FROM users WHERE nivel_id = ?').get(nivelId).c;
  if (emUso > 0) {
    throw new Error('Não é possível excluir esse nível: ainda existem usuários usando ele. Troque o nível deles primeiro.');
  }
  db.prepare('DELETE FROM nivel_permissoes WHERE nivel_id = ?').run(nivelId);
  const info = db.prepare('DELETE FROM niveis_permissao WHERE id = ?').run(nivelId);
  if (info.changes === 0) throw new Error('Nível não encontrado.');
}

// matrizPorNivel: { [nivelId]: { [modulo]: 0|1 } }
function setPermissoesMatrix(matrizPorNivel) {
  const upsert = db.prepare(
    `INSERT INTO nivel_permissoes (nivel_id, modulo, pode_ver) VALUES (?, ?, ?)
     ON CONFLICT(nivel_id, modulo) DO UPDATE SET pode_ver = excluded.pode_ver`
  );
  for (const [nivelId, modulos] of Object.entries(matrizPorNivel)) {
    for (const modulo of MODULO_KEYS) {
      const podeVer = modulos && modulos[modulo] ? 1 : 0;
      upsert.run(Number(nivelId), modulo, podeVer);
    }
  }
}

function userCanAccessModulo(user, modulo) {
  if (!user || !user.nivel_id) return false;
  const row = db.prepare('SELECT pode_ver FROM nivel_permissoes WHERE nivel_id = ? AND modulo = ?').get(user.nivel_id, modulo);
  return !!(row && row.pode_ver);
}

// "Configurações" é o módulo que dá acesso a Lojas, Usuários, Auditoria,
// Backup e à própria tela de Níveis de permissão — equivalente ao antigo
// hasManagementAccess (Direção/Gerência).
function hasManagementAccess(user) {
  return userCanAccessModulo(user, 'configuracoes');
}

function nivelNome(user) {
  if (!user || !user.nivel_id) return '(sem nível)';
  const row = db.prepare('SELECT nome FROM niveis_permissao WHERE id = ?').get(user.nivel_id);
  return row ? row.nome : '(nível removido)';
}

// Conta usuários ATIVOS que enxergam um módulo — usado para impedir que o
// sistema fique sem ninguém capaz de gerenciar Configurações/Usuários.
function countUsuariosAtivosComAcesso(modulo) {
  const row = db
    .prepare(
      `SELECT COUNT(*) c FROM users u
       JOIN nivel_permissoes np ON np.nivel_id = u.nivel_id AND np.modulo = ?
       WHERE u.ativo = 1 AND np.pode_ver = 1`
    )
    .get(modulo);
  return row.c;
}

// Usuário sem loja_id (Direção/Gerência tipicamente) enxerga todas as lojas.
function canSeeAllLojas(user) {
  return !!user && !user.loja_id;
}

// Pode ver o estoque de uma loja específica: é a própria loja do usuário,
// ou o usuário enxerga todas as lojas, ou tem a permissão explícita de
// ver estoque de outras lojas.
function canSeeLoja(user, lojaId) {
  if (!user) return false;
  if (canSeeAllLojas(user)) return true;
  if (String(user.loja_id) === String(lojaId)) return true;
  return !!user.pode_ver_outras_lojas;
}

// Pode editar/cadastrar/excluir peças de uma loja específica: só a própria
// loja do usuário, ou quem enxerga todas as lojas (Direção/Gerência).
function canEditLoja(user, lojaId) {
  if (!user) return false;
  if (canSeeAllLojas(user)) return true;
  return String(user.loja_id) === String(lojaId);
}

module.exports = {
  MODULOS,
  MODULO_KEYS,
  listNiveis,
  getNivel,
  getNivelPermissoesMap,
  createNivel,
  renameNivel,
  deleteNivel,
  setPermissoesMatrix,
  userCanAccessModulo,
  hasManagementAccess,
  nivelNome,
  countUsuariosAtivosComAcesso,
  canSeeAllLojas,
  canSeeLoja,
  canEditLoja,
};

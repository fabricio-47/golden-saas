'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Em produção (Render com disco persistente), defina a variável de ambiente
// DATA_DIR apontando para a pasta do disco montado (ex: /var/data), assim o
// banco de dados sobrevive a reinicializações. Sem essa variável, usa a pasta
// local "data" (comportamento de sempre, inclusive rodando na sua máquina).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'golden-saas.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS lojas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    endereco TEXT,
    telefone TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'direcao',
    ativo INTEGER NOT NULL DEFAULT 1,
    loja_id INTEGER REFERENCES lojas(id) ON DELETE SET NULL,
    pode_ver_outras_lojas INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS niveis_permissao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS nivel_permissoes (
    nivel_id INTEGER NOT NULL REFERENCES niveis_permissao(id) ON DELETE CASCADE,
    modulo TEXT NOT NULL,
    pode_ver INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (nivel_id, modulo)
  );

  CREATE TABLE IF NOT EXISTS login_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_tentativo TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sucesso INTEGER NOT NULL DEFAULT 0,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    telefone TEXT,
    email TEXT,
    endereco TEXT,
    observacoes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bicicletas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    tipo_veiculo TEXT NOT NULL DEFAULT 'bicicleta',
    marca TEXT,
    modelo TEXT NOT NULL,
    cor TEXT,
    motor_serial TEXT,
    controladora_serial TEXT,
    bateria_serial TEXT,
    chassi_numero TEXT,
    bateria_soh_percent INTEGER,
    bateria_ciclos_carga INTEGER,
    km_estimado INTEGER,
    observacoes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ordens_servico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    bicicleta_id INTEGER NOT NULL REFERENCES bicicletas(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'orcamento',
    ativo INTEGER NOT NULL DEFAULT 1,
    checklist_json TEXT,
    problema_relatado TEXT,
    diagnostico TEXT,
    servicos_realizados TEXT,
    valor_pecas REAL,
    valor_mao_obra REAL,
    valor_estimado REAL,
    forma_pagamento TEXT,
    parcelas INTEGER,
    data_entrada TEXT NOT NULL DEFAULT (datetime('now')),
    data_conclusao TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS os_midias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ordem_servico_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    categoria TEXT NOT NULL,
    tipo_arquivo TEXT NOT NULL,
    nome_arquivo TEXT NOT NULL,
    caminho_arquivo TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bicicleta_midias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bicicleta_id INTEGER NOT NULL REFERENCES bicicletas(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    tipo_arquivo TEXT NOT NULL,
    nome_arquivo TEXT NOT NULL,
    caminho_arquivo TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pecas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    categoria TEXT,
    numero_serie TEXT,
    quantidade INTEGER NOT NULL DEFAULT 0,
    estoque_minimo INTEGER NOT NULL DEFAULT 1,
    custo_unitario REAL,
    preco_venda REAL NOT NULL DEFAULT 0,
    observacoes TEXT,
    loja_id INTEGER REFERENCES lojas(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS peca_cores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    peca_id INTEGER NOT NULL REFERENCES pecas(id) ON DELETE CASCADE,
    cor TEXT NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transferencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    peca_origem_id INTEGER REFERENCES pecas(id) ON DELETE SET NULL,
    nome_peca TEXT NOT NULL,
    categoria TEXT,
    custo_unitario REAL,
    preco_venda REAL,
    quantidade INTEGER NOT NULL,
    loja_origem_id INTEGER NOT NULL REFERENCES lojas(id),
    loja_destino_id INTEGER NOT NULL REFERENCES lojas(id),
    status TEXT NOT NULL DEFAULT 'pendente_aprovacao',
    observacoes TEXT,
    solicitado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    aprovado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    recebido_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    aprovado_at TEXT,
    recebido_at TEXT
  );

  CREATE TABLE IF NOT EXISTS os_pecas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ordem_servico_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    peca_id INTEGER REFERENCES pecas(id) ON DELETE SET NULL,
    nome_peca TEXT NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 1,
    preco_unitario REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS os_servicos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ordem_servico_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    tipo_servico_id INTEGER REFERENCES tipos_servico(id) ON DELETE SET NULL,
    nome_servico TEXT NOT NULL,
    valor REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fornecedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cnpj_cpf TEXT,
    telefone TEXT,
    email TEXT,
    endereco TEXT,
    observacoes TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS funcionarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    funcao TEXT,
    telefone TEXT,
    observacoes TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contas_pagar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT NOT NULL,
    valor REAL NOT NULL DEFAULT 0,
    vencimento TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    forma_pagamento TEXT,
    loja_id INTEGER REFERENCES lojas(id) ON DELETE SET NULL,
    fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
    observacoes TEXT,
    pago_em TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Registro de cada entrada de mercadoria no estoque (produto novo ou
  -- reposição de um já existente), com o vínculo pra conta a pagar que foi
  -- gerada automaticamente a partir dela (quando teve custo informado).
  CREATE TABLE IF NOT EXISTS entradas_estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    peca_id INTEGER REFERENCES pecas(id) ON DELETE SET NULL,
    nome_produto TEXT NOT NULL,
    quantidade INTEGER NOT NULL,
    custo_unitario REAL,
    valor_total REAL NOT NULL DEFAULT 0,
    loja_id INTEGER REFERENCES lojas(id) ON DELETE SET NULL,
    fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
    conta_pagar_id INTEGER REFERENCES contas_pagar(id) ON DELETE SET NULL,
    observacoes TEXT,
    criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    loja_id INTEGER REFERENCES lojas(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'aberta',
    valor_total REAL NOT NULL DEFAULT 0,
    forma_pagamento TEXT,
    parcelas INTEGER,
    observacoes TEXT,
    vendedor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    finalizada_at TEXT
  );

  CREATE TABLE IF NOT EXISTS venda_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    peca_id INTEGER REFERENCES pecas(id) ON DELETE SET NULL,
    bicicleta_id INTEGER REFERENCES bicicletas(id) ON DELETE SET NULL,
    nome_peca TEXT NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 1,
    preco_unitario REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contas_receber (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao TEXT NOT NULL,
    valor REAL NOT NULL DEFAULT 0,
    vencimento TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    loja_id INTEGER REFERENCES lojas(id) ON DELETE SET NULL,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    ordem_servico_id INTEGER REFERENCES ordens_servico(id) ON DELETE SET NULL,
    venda_id INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
    numero_parcela INTEGER,
    total_parcelas INTEGER,
    observacoes TEXT,
    recebido_em TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orcamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    bicicleta_id INTEGER REFERENCES bicicletas(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'aberto',
    validade TEXT,
    observacoes TEXT,
    valor_total REAL NOT NULL DEFAULT 0,
    convertido_os_id INTEGER REFERENCES ordens_servico(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orcamento_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL DEFAULT 'servico',
    peca_id INTEGER REFERENCES pecas(id) ON DELETE SET NULL,
    tipo_servico_id INTEGER REFERENCES tipos_servico(id) ON DELETE SET NULL,
    nome TEXT NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 1,
    preco_unitario REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tipos_servico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    categoria TEXT,
    valor REAL NOT NULL DEFAULT 0,
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contratos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    venda_id INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
    ordem_servico_id INTEGER REFERENCES ordens_servico(id) ON DELETE SET NULL,
    titulo TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pendente',
    arquivo_original TEXT,
    arquivo_assinado TEXT,
    hash_original TEXT,
    assinante_nome TEXT,
    assinante_documento TEXT,
    assinante_ip TEXT,
    assinante_user_agent TEXT,
    assinado_em TEXT,
    criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_contratos_cliente ON contratos(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_contratos_token ON contratos(token);
  CREATE INDEX IF NOT EXISTS idx_contratos_status ON contratos(status);
  CREATE INDEX IF NOT EXISTS idx_bicicletas_cliente ON bicicletas(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_os_cliente ON ordens_servico(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_os_bicicleta ON ordens_servico(bicicleta_id);
  CREATE INDEX IF NOT EXISTS idx_os_status ON ordens_servico(status);
  CREATE INDEX IF NOT EXISTS idx_midias_os ON os_midias(ordem_servico_id);
  CREATE INDEX IF NOT EXISTS idx_midias_bicicleta ON bicicleta_midias(bicicleta_id);
  CREATE INDEX IF NOT EXISTS idx_os_pecas_os ON os_pecas(ordem_servico_id);
  CREATE INDEX IF NOT EXISTS idx_os_pecas_peca ON os_pecas(peca_id);
  CREATE INDEX IF NOT EXISTS idx_os_servicos_os ON os_servicos(ordem_servico_id);
  CREATE INDEX IF NOT EXISTS idx_os_servicos_tipo ON os_servicos(tipo_servico_id);
  CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente ON orcamentos(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_orcamentos_status ON orcamentos(status);
  CREATE INDEX IF NOT EXISTS idx_orcamento_itens_orc ON orcamento_itens(orcamento_id);
  CREATE INDEX IF NOT EXISTS idx_login_audit_created ON login_audit(created_at);
  CREATE INDEX IF NOT EXISTS idx_pecas_loja ON pecas(loja_id);
  CREATE INDEX IF NOT EXISTS idx_peca_cores_peca ON peca_cores(peca_id);
  CREATE INDEX IF NOT EXISTS idx_users_loja ON users(loja_id);
  CREATE INDEX IF NOT EXISTS idx_transferencias_origem ON transferencias(loja_origem_id);
  CREATE INDEX IF NOT EXISTS idx_transferencias_destino ON transferencias(loja_destino_id);
  CREATE INDEX IF NOT EXISTS idx_transferencias_status ON transferencias(status);
  CREATE INDEX IF NOT EXISTS idx_contas_pagar_loja ON contas_pagar(loja_id);
  CREATE INDEX IF NOT EXISTS idx_contas_pagar_status ON contas_pagar(status);
  CREATE INDEX IF NOT EXISTS idx_entradas_estoque_peca ON entradas_estoque(peca_id);
  CREATE INDEX IF NOT EXISTS idx_entradas_estoque_loja ON entradas_estoque(loja_id);
  CREATE INDEX IF NOT EXISTS idx_contas_receber_loja ON contas_receber(loja_id);
  CREATE INDEX IF NOT EXISTS idx_contas_receber_status ON contas_receber(status);
  CREATE INDEX IF NOT EXISTS idx_contas_receber_os ON contas_receber(ordem_servico_id);
  CREATE INDEX IF NOT EXISTS idx_contas_receber_venda ON contas_receber(venda_id);
  CREATE INDEX IF NOT EXISTS idx_vendas_cliente ON vendas(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_vendas_loja ON vendas(loja_id);
  CREATE INDEX IF NOT EXISTS idx_vendas_status ON vendas(status);
  CREATE INDEX IF NOT EXISTS idx_venda_itens_venda ON venda_itens(venda_id);
`);

// --- migrações leves para bancos criados por versões anteriores ---
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('bicicletas', 'tipo_veiculo', "TEXT NOT NULL DEFAULT 'bicicleta'");
ensureColumn('ordens_servico', 'problema_relatado', 'TEXT');
ensureColumn('ordens_servico', 'valor_pecas', 'REAL');
ensureColumn('ordens_servico', 'valor_mao_obra', 'REAL');
ensureColumn('ordens_servico', 'forma_pagamento', 'TEXT');
ensureColumn('ordens_servico', 'parcelas', 'INTEGER');
ensureColumn('ordens_servico', 'ativo', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'direcao'");
ensureColumn('users', 'nivel_id', 'INTEGER');
ensureColumn('users', 'ativo', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'loja_id', 'INTEGER');
ensureColumn('users', 'pode_ver_outras_lojas', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('pecas', 'loja_id', 'INTEGER');
ensureColumn('pecas', 'fornecedor_id', 'INTEGER');
ensureColumn('contas_receber', 'venda_id', 'INTEGER');
ensureColumn('bicicletas', 'chassi_numero', 'TEXT');
ensureColumn('venda_itens', 'bicicleta_id', 'INTEGER');
ensureColumn('venda_itens', 'tipo_servico_id', 'INTEGER');
ensureColumn('contas_pagar', 'anexo_caminho', 'TEXT');
ensureColumn('contas_pagar', 'anexo_nome', 'TEXT');
ensureColumn('ordens_servico', 'previsao_entrega', 'TEXT');
ensureColumn('ordens_servico', 'prioridade', "TEXT NOT NULL DEFAULT 'normal'");
ensureColumn('ordens_servico', 'termos_garantia', 'TEXT');
ensureColumn('ordens_servico', 'acessorios', 'TEXT');
ensureColumn('ordens_servico', 'tecnico_id', 'INTEGER');
ensureColumn('ordens_servico', 'desconto', 'REAL');

// ---------------- Integração fiscal (NF-e via Focus NFe) ----------------
// Configuração fiscal: linha única (id = 1). Guarda os tokens da Focus, o
// ambiente ativo (homologação por padrão, para nunca emitir nota com valor
// jurídico sem a troca ser explícita) e os padrões fiscais usados quando um
// produto não tem os seus próprios. Os padrões são preenchidos COM o contador.
db.exec(`
  CREATE TABLE IF NOT EXISTS config_fiscal (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    focus_token_homologacao TEXT,
    focus_token_producao TEXT,
    ambiente TEXT NOT NULL DEFAULT 'homologacao',
    regime_tributario INTEGER NOT NULL DEFAULT 1,
    natureza_operacao TEXT NOT NULL DEFAULT 'Venda de mercadoria',
    serie_nfe TEXT,
    ncm_padrao TEXT,
    cfop_padrao TEXT,
    cfop_interestadual_padrao TEXT,
    csosn_padrao TEXT,
    origem_padrao INTEGER NOT NULL DEFAULT 0,
    unidade_padrao TEXT NOT NULL DEFAULT 'UN',
    atualizado_em TEXT
  );
`);
db.exec("INSERT OR IGNORE INTO config_fiscal (id, ambiente) VALUES (1, 'homologacao')");

// Campos fiscais dos produtos (peças). Nulos por padrão; o contador preenche.
ensureColumn('pecas', 'ncm', 'TEXT');
ensureColumn('pecas', 'cfop', 'TEXT');
ensureColumn('pecas', 'csosn', 'TEXT');
ensureColumn('pecas', 'origem_mercadoria', 'INTEGER');
ensureColumn('pecas', 'unidade_comercial', 'TEXT');
// Foto do produto (uma por produto), caminho relativo em uploads (peca-<id>/...).
ensureColumn('pecas', 'foto_caminho', 'TEXT');

// Desconto (R$) aplicado na venda. valor_total já fica com o desconto abatido.
ensureColumn('vendas', 'desconto', 'REAL');

// Permissão de editar/excluir por nível. 1 (padrão) = pode; 0 = só criar/ver
// (não edita nem exclui produto, O.S. nem cancela nota). Direção/Gerência
// sempre podem, independente disso.
ensureColumn('niveis_permissao', 'pode_alterar', 'INTEGER NOT NULL DEFAULT 1');

// Configuração geral (linha única, id = 1). Guarda a senha do caixa (hash),
// usada para o caixa "dar baixa" (confirmar o pagamento) de uma venda.
db.exec(`
  CREATE TABLE IF NOT EXISTS config_geral (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    senha_caixa_hash TEXT,
    senha_caixa_salt TEXT,
    atualizado_em TEXT
  );
`);
db.exec('INSERT OR IGNORE INTO config_geral (id) VALUES (1)');

// Comprovante do pagamento anexado na baixa (obrigatório quando digital).
ensureColumn('vendas', 'comprovante_caminho', 'TEXT');
ensureColumn('vendas', 'comprovante_nome', 'TEXT');

// Caixa em espécie: livro de movimentos do dinheiro físico. 'entrada' quando
// uma venda em dinheiro recebe baixa; 'fechamento' quando o diretor confere e
// zera o caixa. Saldo = soma(entradas) - soma(fechamentos).
db.exec(`
  CREATE TABLE IF NOT EXISTS caixa_movimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    valor REAL NOT NULL DEFAULT 0,
    venda_id INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
    descricao TEXT,
    usuario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Pagamentos de uma venda (permite pagamento misto: várias formas na mesma
// venda, cada uma com seu valor; crédito pode ter parcelas).
db.exec(`
  CREATE TABLE IF NOT EXISTS venda_pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    forma TEXT NOT NULL,
    valor REAL NOT NULL DEFAULT 0,
    parcelas INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Dados fiscais / endereço estruturado do cliente (destinatário da NF-e).
ensureColumn('clientes', 'cpf_cnpj', 'TEXT');
ensureColumn('clientes', 'ie', 'TEXT');
ensureColumn('clientes', 'cep', 'TEXT');
ensureColumn('clientes', 'logradouro', 'TEXT');
ensureColumn('clientes', 'numero', 'TEXT');
ensureColumn('clientes', 'complemento', 'TEXT');
ensureColumn('clientes', 'bairro', 'TEXT');
ensureColumn('clientes', 'municipio', 'TEXT');
ensureColumn('clientes', 'codigo_municipio', 'TEXT');
ensureColumn('clientes', 'uf', 'TEXT');

// Rastreamento da NF-e emitida a partir da Venda.
ensureColumn('vendas', 'nfe_ref', 'TEXT');
ensureColumn('vendas', 'nfe_status', 'TEXT');
ensureColumn('vendas', 'nfe_chave', 'TEXT');
ensureColumn('vendas', 'nfe_numero', 'TEXT');
ensureColumn('vendas', 'nfe_serie', 'TEXT');
ensureColumn('vendas', 'nfe_danfe_url', 'TEXT');
ensureColumn('vendas', 'nfe_xml_url', 'TEXT');
ensureColumn('vendas', 'nfe_mensagem', 'TEXT');
ensureColumn('vendas', 'nfe_ambiente', 'TEXT');
ensureColumn('vendas', 'nfe_emitida_em', 'TEXT');

// migra status antigo para o novo fluxo orcamento -> execucao -> concluida
db.exec("UPDATE ordens_servico SET status = 'orcamento' WHERE status = 'aberta'");
db.exec("UPDATE ordens_servico SET status = 'execucao' WHERE status = 'em_andamento'");

// garante que exista ao menos uma loja e que toda peça já cadastrada
// (de versões anteriores ao multi-lojas) fique associada a ela
function ensureDefaultLoja() {
  const count = db.prepare('SELECT COUNT(*) as c FROM lojas').get().c;
  let defaultLojaId;
  if (count === 0) {
    const info = db.prepare('INSERT INTO lojas (nome, endereco, telefone, ativo) VALUES (?, ?, ?, 1)').run('Loja Principal', '', '');
    defaultLojaId = info.lastInsertRowid;
    console.log('[seed] Loja "Loja Principal" criada automaticamente.');
  } else {
    defaultLojaId = db.prepare('SELECT id FROM lojas ORDER BY id ASC LIMIT 1').get().id;
  }
  db.prepare('UPDATE pecas SET loja_id = ? WHERE loja_id IS NULL').run(defaultLojaId);
  return defaultLojaId;
}
const DEFAULT_LOJA_ID = ensureDefaultLoja();

// --- níveis de permissão customizáveis (substituem os 4 papéis fixos antigos) ---
// Módulos padrão liberados para cada nível seed (mantém o comportamento de
// acesso que já existia antes: Direção/Gerência = tudo; Vendedor/Mecânico =
// tudo, menos Configurações).
const MODULOS_OPERACIONAIS = ['painel', 'clientes', 'bicicletas', 'os', 'vendas', 'estoque', 'financeiro'];
const MODULOS_TODOS = [...MODULOS_OPERACIONAIS, 'configuracoes'];
const NIVEIS_PADRAO = [
  { nome: 'Direção', roleAntigo: 'direcao', modulos: MODULOS_TODOS },
  { nome: 'Gerência', roleAntigo: 'gerencia', modulos: MODULOS_TODOS },
  { nome: 'Vendedor', roleAntigo: 'vendedor', modulos: MODULOS_OPERACIONAIS },
  { nome: 'Mecânico', roleAntigo: 'mecanico', modulos: MODULOS_OPERACIONAIS },
];

function ensureNiveisPermissao() {
  const count = db.prepare('SELECT COUNT(*) as c FROM niveis_permissao').get().c;
  if (count === 0) {
    const insNivel = db.prepare('INSERT INTO niveis_permissao (nome) VALUES (?)');
    const insPerm = db.prepare('INSERT INTO nivel_permissoes (nivel_id, modulo, pode_ver) VALUES (?, ?, 1)');
    for (const nivel of NIVEIS_PADRAO) {
      const info = insNivel.run(nivel.nome);
      const nivelId = info.lastInsertRowid;
      for (const modulo of nivel.modulos) insPerm.run(nivelId, modulo);
    }
    console.log('[seed] Níveis de permissão padrão criados: Direção, Gerência, Vendedor, Mecânico.');
  }

  // migra usuários de versões anteriores (que só tinham a coluna "role" fixa)
  // para o novo sistema de níveis customizáveis, preservando o acesso que já tinham
  const usuariosSemNivel = db.prepare('SELECT id, role FROM users WHERE nivel_id IS NULL').all();
  if (usuariosSemNivel.length) {
    const nivelIdPorRoleAntigo = {};
    for (const nivel of NIVEIS_PADRAO) {
      const row = db.prepare('SELECT id FROM niveis_permissao WHERE nome = ?').get(nivel.nome);
      if (row) nivelIdPorRoleAntigo[nivel.roleAntigo] = row.id;
    }
    const fallbackNivelId = db.prepare('SELECT id FROM niveis_permissao ORDER BY id ASC LIMIT 1').get().id;
    const upd = db.prepare('UPDATE users SET nivel_id = ? WHERE id = ?');
    for (const u of usuariosSemNivel) {
      upd.run(nivelIdPorRoleAntigo[u.role] || fallbackNivelId, u.id);
    }
    console.log(`[migração] ${usuariosSemNivel.length} usuário(s) migrado(s) para o novo sistema de níveis de permissão.`);
  }
}
ensureNiveisPermissao();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword('golden123', salt);
    const nivelDirecao = db.prepare("SELECT id FROM niveis_permissao WHERE nome = 'Direção'").get();
    db.prepare(
      'INSERT INTO users (name, email, password_hash, password_salt, role, nivel_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Administrador', 'admin@goldensaas.com', hash, salt, 'direcao', nivelDirecao ? nivelDirecao.id : null);
    console.log('[seed] Usuário admin criado: admin@goldensaas.com / senha: golden123');
  }

  const clienteCount = db.prepare('SELECT COUNT(*) as c FROM clientes').get().c;
  if (clienteCount === 0) {
    const insCliente = db.prepare(
      'INSERT INTO clientes (nome, telefone, email, endereco, observacoes) VALUES (?, ?, ?, ?, ?)'
    );
    const r1 = insCliente.run('João Delivery Ltda (Frota)', '(21) 99999-0001', 'joao@delivery.com', 'Rua das Entregas, 100 - Rio de Janeiro/RJ', 'Cliente frotista - 12 e-bikes em operação');
    const r2 = insCliente.run('Mariana Costa', '(21) 98888-0002', 'mariana@email.com', 'Av. Atlântica, 500 - Rio de Janeiro/RJ', '');

    const insBike = db.prepare(
      `INSERT INTO bicicletas (cliente_id, tipo_veiculo, marca, modelo, cor, motor_serial, controladora_serial, bateria_serial, bateria_soh_percent, bateria_ciclos_carga, km_estimado, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const b1 = insBike.run(r1.lastInsertRowid, 'bicicleta', 'Voltz', 'EB-100 Cargo', 'Preta', 'MOT-VZ-88231', 'CTRL-VZ-44120', 'BAT-VZ-99201', 87, 340, 4200, 'Uso intenso em delivery');
    const b2 = insBike.run(r2.lastInsertRowid, 'bicicleta', 'Caloi', 'E-Vibe Urban', 'Branca', 'MOT-CL-11029', 'CTRL-CL-22087', 'BAT-CL-55310', 96, 60, 850, '');

    const insOS = db.prepare(
      `INSERT INTO ordens_servico (numero, cliente_id, bicicleta_id, status, checklist_json, problema_relatado, diagnostico, servicos_realizados, valor_pecas, valor_mao_obra, valor_estimado, forma_pagamento, parcelas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const checklistExemplo = JSON.stringify([
      { item: 'Inspeção visual do quadro', status: 'ok', observacao: '' },
      { item: 'Motor (ruído / funcionamento)', status: 'atencao', observacao: 'Leve ruído em alta rotação' },
      { item: 'Fiação e conectores', status: 'ok', observacao: '' },
      { item: 'Display / computador de bordo', status: 'ok', observacao: '' },
      { item: 'Integridade física da bateria', status: 'ok', observacao: '' },
      { item: 'Freios', status: 'atencao', observacao: 'Pastilhas com 30% de vida útil' },
      { item: 'Pneus e câmaras', status: 'ok', observacao: '' },
      { item: 'Sistema de transmissão', status: 'ok', observacao: '' },
    ]);
    insOS.run(
      'OS-0001', r1.lastInsertRowid, b1.lastInsertRowid, 'execucao', checklistExemplo,
      'Cliente relata ruído estranho no motor durante a pedalada e autonomia menor que o normal.',
      'Motor com desgaste leve de rolamento. Recomenda-se revisão preventiva em 500km.', '',
      60.0, 120.0, 180.0, 'pix', null
    );
  }

  const pecaCount = db.prepare('SELECT COUNT(*) as c FROM pecas').get().c;
  if (pecaCount === 0) {
    const insPeca = db.prepare(
      `INSERT INTO pecas (nome, categoria, numero_serie, quantidade, estoque_minimo, custo_unitario, preco_venda, observacoes, loja_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insPeca.run('Pastilha de freio (par)', 'Freios', null, 12, 4, 15.0, 35.0, '', DEFAULT_LOJA_ID);
    insPeca.run('Câmara de ar aro 26', 'Pneus e câmaras', null, 8, 3, 12.0, 28.0, '', DEFAULT_LOJA_ID);
    insPeca.run('Bateria 48V 15Ah', 'Bateria', null, 2, 1, 850.0, 1450.0, 'Compatível com Voltz EB-100', DEFAULT_LOJA_ID);
    insPeca.run('Controladora 500W', 'Controladora', null, 1, 1, 180.0, 320.0, '', DEFAULT_LOJA_ID);
  }
}

seed();

module.exports = { db, hashPassword };

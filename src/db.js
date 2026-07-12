'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'golden-saas.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'direcao',
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  CREATE INDEX IF NOT EXISTS idx_bicicletas_cliente ON bicicletas(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_os_cliente ON ordens_servico(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_os_bicicleta ON ordens_servico(bicicleta_id);
  CREATE INDEX IF NOT EXISTS idx_os_status ON ordens_servico(status);
  CREATE INDEX IF NOT EXISTS idx_midias_os ON os_midias(ordem_servico_id);
  CREATE INDEX IF NOT EXISTS idx_midias_bicicleta ON bicicleta_midias(bicicleta_id);
  CREATE INDEX IF NOT EXISTS idx_os_pecas_os ON os_pecas(ordem_servico_id);
  CREATE INDEX IF NOT EXISTS idx_os_pecas_peca ON os_pecas(peca_id);
  CREATE INDEX IF NOT EXISTS idx_login_audit_created ON login_audit(created_at);
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
ensureColumn('users', 'ativo', 'INTEGER NOT NULL DEFAULT 1');
// migra status antigo para o novo fluxo orcamento -> execucao -> concluida
db.exec("UPDATE ordens_servico SET status = 'orcamento' WHERE status = 'aberta'");
db.exec("UPDATE ordens_servico SET status = 'execucao' WHERE status = 'em_andamento'");

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword('golden123', salt);
    db.prepare(
      'INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)'
    ).run('Administrador', 'admin@goldensaas.com', hash, salt);
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
      `INSERT INTO pecas (nome, categoria, numero_serie, quantidade, estoque_minimo, custo_unitario, preco_venda, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insPeca.run('Pastilha de freio (par)', 'Freios', null, 12, 4, 15.0, 35.0, '');
    insPeca.run('Câmara de ar aro 26', 'Pneus e câmaras', null, 8, 3, 12.0, 28.0, '');
    insPeca.run('Bateria 48V 15Ah', 'Bateria', null, 2, 1, 850.0, 1450.0, 'Compatível com Voltz EB-100');
    insPeca.run('Controladora 500W', 'Controladora', null, 1, 1, 180.0, 320.0, '');
  }
}

seed();

module.exports = { db, hashPassword };

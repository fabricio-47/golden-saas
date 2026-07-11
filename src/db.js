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
    status TEXT NOT NULL DEFAULT 'aberta',
    checklist_json TEXT,
    diagnostico TEXT,
    servicos_realizados TEXT,
    valor_estimado REAL,
    data_entrada TEXT NOT NULL DEFAULT (datetime('now')),
    data_conclusao TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bicicletas_cliente ON bicicletas(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_os_cliente ON ordens_servico(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_os_bicicleta ON ordens_servico(bicicleta_id);
  CREATE INDEX IF NOT EXISTS idx_os_status ON ordens_servico(status);
`);

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
      `INSERT INTO bicicletas (cliente_id, marca, modelo, cor, motor_serial, controladora_serial, bateria_serial, bateria_soh_percent, bateria_ciclos_carga, km_estimado, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const b1 = insBike.run(r1.lastInsertRowid, 'Voltz', 'EB-100 Cargo', 'Preta', 'MOT-VZ-88231', 'CTRL-VZ-44120', 'BAT-VZ-99201', 87, 340, 4200, 'Uso intenso em delivery');
    const b2 = insBike.run(r2.lastInsertRowid, 'Caloi', 'E-Vibe Urban', 'Branca', 'MOT-CL-11029', 'CTRL-CL-22087', 'BAT-CL-55310', 96, 60, 850, '');

    const insOS = db.prepare(
      `INSERT INTO ordens_servico (numero, cliente_id, bicicleta_id, status, checklist_json, diagnostico, servicos_realizados, valor_estimado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
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
    insOS.run('OS-0001', r1.lastInsertRowid, b1.lastInsertRowid, 'em_andamento', checklistExemplo, 'Motor com desgaste leve de rolamento. Recomenda-se revisão preventiva em 500km.', '', 180.0);
  }
}

seed();

module.exports = { db, hashPassword };

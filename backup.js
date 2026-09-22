'use strict';

// Backup automático e manual do banco de dados (e, no backup manual completo,
// também das fotos/vídeos enviados). Usa a função nativa `sqlite.backup()`
// (node:sqlite) para tirar uma cópia consistente do banco mesmo com o
// sistema em uso, e o escritor de zip próprio (src/zip.js) pra empacotar
// tudo sem depender de nenhum pacote externo.

const fs = require('node:fs');
const path = require('node:path');
const { backup: sqliteBackup } = require('node:sqlite');
const { buildZip } = require('./zip');
const { sendMail, isConfigured: emailConfigured } = require('./mailer');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STATE_PATH = path.join(DATA_DIR, 'backup-state.json');
const MAX_SNAPSHOTS = 14; // mantém os últimos 14 backups automáticos no disco, apaga os mais antigos

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (_e) {
    return {};
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (_e) {
    /* não é crítico se isso falhar */
  }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Cria uma cópia consistente do banco de dados em uso (funciona mesmo com o
// sistema em uso ao mesmo tempo — é a forma segura de "backup a quente" do
// SQLite, diferente de simplesmente copiar o arquivo .db).
async function snapshotDb(db) {
  const snapshotPath = path.join(BACKUPS_DIR, `golden-saas-${timestampForFile()}.db`);
  await sqliteBackup(db, snapshotPath);
  return snapshotPath;
}

function pruneOldSnapshots() {
  let files;
  try {
    files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.db'));
  } catch (_e) {
    return;
  }
  const withStats = files
    .map((f) => {
      const full = path.join(BACKUPS_DIR, f);
      try {
        return { full, mtime: fs.statSync(full).mtimeMs };
      } catch (_e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  for (const f of withStats.slice(MAX_SNAPSHOTS)) {
    try {
      fs.unlinkSync(f.full);
    } catch (_e) {
      /* ignore */
    }
  }
}

function listFilesRecursive(dir, base) {
  base = base || dir;
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(listFilesRecursive(full, base));
    } else if (entry.isFile()) {
      results.push({ full, rel: path.relative(base, full) });
    }
  }
  return results;
}

// Backup automático diário: só o banco de dados (pra caber tranquilo num
// e-mail). Salva uma cópia local em disco (rotacionando as últimas 14) e,
// se o envio de e-mail estiver configurado, manda por e-mail pros
// destinatários informados.
async function runAutoBackup(db, { recipients } = {}) {
  pruneOldSnapshots();
  const snapshotPath = await snapshotDb(db);
  const dbData = fs.readFileSync(snapshotPath);

  const state = readState();
  const result = {
    at: new Date().toISOString(),
    sizeBytes: dbData.length,
    emailed: false,
    emailError: null,
  };

  if (emailConfigured() && recipients && recipients.length) {
    try {
      const zip = buildZip([{ name: `golden-saas-${todayStr()}.db`, data: dbData, method: 'deflate' }]);
      for (const to of recipients) {
        await sendMail({
          to,
          subject: `Backup automático — Golden SaaS (${todayStr()})`,
          html: `<p>Segue em anexo o backup automático do banco de dados do Golden SaaS referente a hoje (${todayStr()}).</p><p>Esse backup contém todos os cadastros (clientes, veículos, O.S., estoque, financeiro etc.), mas não inclui fotos e vídeos — pra isso, use o botão "Baixar backup completo" dentro do sistema, em Configurações → Backup.</p>`,
          text: `Segue em anexo o backup automático do banco de dados do Golden SaaS referente a hoje (${todayStr()}). Esse backup contém todos os cadastros, mas não inclui fotos e vídeos — pra isso, use o botão "Baixar backup completo" dentro do sistema, em Configurações → Backup.`,
          attachments: [{ name: `golden-saas-backup-${todayStr()}.zip`, content: zip }],
        });
      }
      result.emailed = true;
    } catch (err) {
      result.emailError = err && err.message ? err.message : String(err);
    }
  }

  state.lastAutoBackupAt = result.at;
  state.lastAutoBackupDate = todayStr();
  state.lastAutoBackupSizeBytes = result.sizeBytes;
  state.lastAutoBackupEmailed = result.emailed;
  state.lastAutoBackupEmailError = result.emailError;
  writeState(state);

  return result;
}

// Backup manual completo: banco de dados + todas as fotos/vídeos enviados,
// compactados num único .zip pra download direto (não envolve e-mail, então
// não tem limite prático de tamanho).
async function buildFullBackupZip(db) {
  // Usa um snapshot consistente só como passo intermediário — não é uma das
  // cópias rotativas do backup automático, então é apagado assim que os
  // dados já estiverem lidos em memória (o conteúdo real fica dentro do zip).
  const snapshotPath = await snapshotDb(db);
  const dbData = fs.readFileSync(snapshotPath);
  try {
    fs.unlinkSync(snapshotPath);
  } catch (_e) {
    /* ignore */
  }
  const entries = [{ name: 'golden-saas.db', data: dbData, method: 'deflate' }];
  for (const f of listFilesRecursive(UPLOADS_DIR)) {
    entries.push({ name: path.posix.join('uploads', f.rel.split(path.sep).join('/')), data: fs.readFileSync(f.full), method: 'store' });
  }
  const zip = buildZip(entries);

  const state = readState();
  state.lastManualBackupAt = new Date().toISOString();
  writeState(state);

  return zip;
}

module.exports = { runAutoBackup, buildFullBackupZip, readState, todayStr };

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Mesma lógica do db.js: em produção com disco persistente, DATA_DIR aponta
// pro disco montado (ex: /var/data), então os arquivos enviados (fotos/vídeos)
// também sobrevivem a reinicializações, junto com o banco de dados.
const DATA_ROOT = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_ROOT, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB por arquivo (fotos e vídeos curtos)
const MAX_REQUEST_BYTES = 80 * 1024 * 1024; // 80MB por requisição (vários arquivos juntos)

const ALLOWED_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

function extFor(contentType, originalName) {
  if (ALLOWED_EXT[contentType]) return ALLOWED_EXT[contentType];
  const ext = path.extname(originalName || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.heic', '.mp4', '.mov', '.webm'].includes(ext)) return ext;
  return null;
}

function isImage(contentType) {
  return contentType && contentType.startsWith('image/');
}
function isVideo(contentType) {
  return contentType && contentType.startsWith('video/');
}

// Salva um arquivo enviado (buffer) numa pasta própria (namespace-id) e retorna
// metadados para gravar no banco. namespace evita colisão entre ids de tabelas
// diferentes (ex: "os-5" vs "bicicleta-5").
function saveUploadedFile(namespace, entityId, file) {
  const ext = extFor(file.contentType, file.filename);
  if (!ext) return null; // tipo não suportado, ignora silenciosamente
  if (!isImage(file.contentType) && !isVideo(file.contentType)) return null;
  if (file.data.length === 0 || file.data.length > MAX_FILE_BYTES) return null;

  const folder = `${namespace}-${entityId}`;
  const dir = path.join(UPLOADS_DIR, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const fullPath = path.join(dir, safeName);
  fs.writeFileSync(fullPath, file.data);

  return {
    nome_arquivo: file.filename,
    caminho_arquivo: `${folder}/${safeName}`,
    tipo_arquivo: isVideo(file.contentType) ? 'video' : 'imagem',
  };
}

function deleteUploadedFile(relativePath) {
  const fullPath = resolveUploadPath(relativePath);
  if (fullPath && fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
    } catch (_) {
      /* ignore */
    }
  }
}

function resolveUploadPath(relativePath) {
  // relativePath vem como "<osId>/<arquivo>" - impede path traversal
  const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(UPLOADS_DIR, normalized);
  if (!fullPath.startsWith(UPLOADS_DIR)) return null;
  return fullPath;
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function mimeForPath(p) {
  return MIME_BY_EXT[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  UPLOADS_DIR,
  MAX_FILE_BYTES,
  MAX_REQUEST_BYTES,
  saveUploadedFile,
  deleteUploadedFile,
  resolveUploadPath,
  mimeForPath,
};

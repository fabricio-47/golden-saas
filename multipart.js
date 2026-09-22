'use strict';

// Parser mínimo de multipart/form-data, sem dependências externas.
// Suficiente para formulários com campos de texto + upload de arquivos (fotos/vídeos).

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('ARQUIVO_MUITO_GRANDE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getBoundary(contentType) {
  if (!contentType) return null;
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return null;
  return (match[1] || match[2]).trim();
}

// Retorna { fields: {name: value}, files: [{fieldName, filename, contentType, data: Buffer}] }
function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);

  let start = buffer.indexOf(boundaryBuf);
  if (start === -1) return { fields, files };
  start += boundaryBuf.length;

  while (true) {
    const marker = buffer.slice(start, start + 2).toString('latin1');
    if (marker === '--') break; // fim do multipart

    let partStart = start;
    if (marker === '\r\n') partStart = start + 2;

    const nextBoundaryIdx = buffer.indexOf(boundaryBuf, partStart);
    if (nextBoundaryIdx === -1) break;

    let partEnd = nextBoundaryIdx;
    if (buffer.slice(partEnd - 2, partEnd).toString('latin1') === '\r\n') partEnd -= 2;

    const partBuf = buffer.slice(partStart, partEnd);
    const headerEndIdx = partBuf.indexOf('\r\n\r\n');
    if (headerEndIdx !== -1) {
      const headerStr = partBuf.slice(0, headerEndIdx).toString('utf8');
      const body = partBuf.slice(headerEndIdx + 4);

      const nameMatch = headerStr.match(/name="([^"]*)"/i);
      const filenameMatch = headerStr.match(/filename="([^"]*)"/i);

      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (filenameMatch && filenameMatch[1]) {
          const contentTypeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
          const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';
          files.push({ fieldName, filename: filenameMatch[1], contentType, data: body });
        } else {
          if (fields[fieldName] !== undefined) {
            if (Array.isArray(fields[fieldName])) fields[fieldName].push(body.toString('utf8'));
            else fields[fieldName] = [fields[fieldName], body.toString('utf8')];
          } else {
            fields[fieldName] = body.toString('utf8');
          }
        }
      }
    }

    start = nextBoundaryIdx + boundaryBuf.length;
  }

  return { fields, files };
}

module.exports = { readRawBody, getBoundary, parseMultipart };

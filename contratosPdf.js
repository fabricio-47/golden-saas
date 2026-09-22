'use strict';

// Gera a versão "assinada" do contrato: pega o PDF original enviado e anexa
// uma página extra de certificado, com os dados de quem assinou (nome,
// documento, data/hora, IP, navegador) e a imagem da assinatura desenhada
// na tela. Isso NÃO é uma assinatura digital com certificado ICP-Brasil —
// é uma assinatura eletrônica simples (clickwrap), do tipo usada por
// diversos sistemas de aceite online. Tem validade como evidência de
// aceite, mas não o mesmo peso jurídico de uma assinatura com certificado.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function gerarPdfAssinado({ originalBuffer, contrato, clienteNome, assinaturaPngBuffer }) {
  const pdfDoc = await PDFDocument.load(originalBuffer, { ignoreEncryption: true });
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  let y = height - 70;

  page.drawText('Certificado de Assinatura Eletrônica', {
    x: 50,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 14;
  page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 28;

  const dataHora = contrato.assinado_em
    ? new Date(contrato.assinado_em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '-';

  const linhas = [
    ['Documento', contrato.titulo],
    ['Cliente cadastrado no sistema', clienteNome],
    ['Nome informado na assinatura', contrato.assinante_nome || '-'],
    ['CPF/CNPJ informado', contrato.assinante_documento || 'não informado'],
    ['Data e hora da assinatura (horário de Brasília)', dataHora],
    ['Endereço IP', contrato.assinante_ip || '-'],
    ['Navegador (user-agent)', contrato.assinante_user_agent || 'não informado'],
    ['Hash SHA-256 do documento original', contrato.hash_original || '-'],
  ];

  for (const [label, valor] of linhas) {
    page.drawText(label + ':', { x: 50, y, size: 10, font: fontBold, color: rgb(0.25, 0.25, 0.25) });
    y -= 14;
    const linhasQuebradas = quebrarLinha(String(valor || '-'), 95);
    for (const parte of linhasQuebradas) {
      page.drawText(parte, { x: 50, y, size: 10, font: fontRegular, color: rgb(0.1, 0.1, 0.1) });
      y -= 14;
    }
    y -= 6;
  }

  if (assinaturaPngBuffer) {
    y -= 10;
    page.drawText('Assinatura (desenhada pelo signatário):', { x: 50, y, size: 10, font: fontBold, color: rgb(0.25, 0.25, 0.25) });
    y -= 12;
    try {
      const pngImage = await pdfDoc.embedPng(assinaturaPngBuffer);
      const maxWidth = 260;
      const scale = Math.min(1, maxWidth / pngImage.width);
      const w = pngImage.width * scale;
      const h = pngImage.height * scale;
      y -= h;
      page.drawRectangle({ x: 48, y: y - 4, width: w + 4, height: h + 8, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
      page.drawImage(pngImage, { x: 50, y, width: w, height: h });
      y -= 20;
    } catch (err) {
      page.drawText('(não foi possível anexar a imagem da assinatura)', { x: 50, y, size: 9, font: fontRegular, color: rgb(0.6, 0.2, 0.2) });
      y -= 20;
    }
  }

  y -= 10;
  const aviso =
    'Esta é uma assinatura eletrônica simples (clickwrap), coletada por aceite online com registro de IP, ' +
    'data/hora e navegador. Não utiliza certificado digital ICP-Brasil e não tem o mesmo valor jurídico de uma ' +
    'assinatura com certificado digital, mas serve como evidência de aceite entre as partes.';
  for (const parte of quebrarLinha(aviso, 105)) {
    page.drawText(parte, { x: 50, y, size: 8, font: fontRegular, color: rgb(0.45, 0.45, 0.45) });
    y -= 11;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

function quebrarLinha(texto, maxChars) {
  const palavras = String(texto).split(/\s+/);
  const linhas = [];
  let atual = '';
  for (const palavra of palavras) {
    if ((atual + ' ' + palavra).trim().length > maxChars) {
      if (atual) linhas.push(atual.trim());
      atual = palavra;
    } else {
      atual = (atual + ' ' + palavra).trim();
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

module.exports = { gerarPdfAssinado };

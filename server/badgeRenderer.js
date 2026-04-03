const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const QRCode = require('qrcode');

const MM_TO_PT = 2.8346;
const mm = v => parseFloat(v) * MM_TO_PT;

// ── Font mapping ──────────────────────────────────────────────
async function embedFont(pdfDoc, family, bold, italic) {
  const f = (family || '').toLowerCase();
  if (f.includes('courier')) {
    if (bold)   return pdfDoc.embedFont(StandardFonts.CourierBold);
    if (italic) return pdfDoc.embedFont(StandardFonts.CourierOblique);
    return pdfDoc.embedFont(StandardFonts.Courier);
  }
  if (f.includes('times')) {
    if (bold && italic) return pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
    if (bold)   return pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    if (italic) return pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
    return pdfDoc.embedFont(StandardFonts.TimesRoman);
  }
  // Default: Helvetica
  if (bold && italic) return pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
  if (bold)   return pdfDoc.embedFont(StandardFonts.HelveticaBold);
  if (italic) return pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  return pdfDoc.embedFont(StandardFonts.Helvetica);
}

// ── Color parsing ─────────────────────────────────────────────
function parseColor(color) {
  if (!Array.isArray(color) || color.length < 3) return rgb(0, 0, 0);
  return rgb(color[0] / 255, color[1] / 255, color[2] / 255);
}

// ── Dynamic content resolution ────────────────────────────────
function resolveContent(el, values) {
  const c = el.content;
  if (c === 'other')      return el.text || '';
  if (c === 'other_i18n') {
    const t = el.text_i18n || {};
    return t.it || t.en || Object.values(t)[0] || '';
  }
  return values[c] !== undefined ? String(values[c]) : '';
}

// ── Word wrap ─────────────────────────────────────────────────
function wrapText(text, font, fontSize, maxWidthPt) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidthPt && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

// ── Text element renderer ─────────────────────────────────────
async function renderText(pdfDoc, page, el, values) {
  const text = resolveContent(el, values);
  if (!text) return;

  const font      = await embedFont(pdfDoc, el.fontfamily, el.bold, el.italic);
  let   fontSize  = parseFloat(el.fontsize) || 12;
  const color     = parseColor(el.color);
  const leftPt    = mm(el.left);
  const bottomPt  = mm(el.bottom);
  const widthPt   = el.width  ? mm(el.width)  : undefined;
  const heightPt  = el.height ? mm(el.height) : undefined;
  const align     = el.align         || 'left';
  const valign    = el.verticalalign || 'top';
  const lineH     = parseFloat(el.lineheight) || 1.2;
  const rot       = parseFloat(el.rotation)   || 0;
  const downward  = el.downward === true;
  const { height: pageH } = page.getSize();

  // Auto-resize to fit width
  if (el.autoresize && widthPt) {
    while (fontSize > 4 && font.widthOfTextAtSize(text, fontSize) > widthPt) {
      fontSize -= 0.5;
    }
  }

  const lineHeightPt = fontSize * lineH;
  const lines = widthPt ? wrapText(text, font, fontSize, widthPt) : [text];
  const totalH = lines.length * lineHeightPt;

  // Determine Y start (pdf-lib: bottom-left origin, y = baseline)
  let startY;
  if (heightPt !== undefined) {
    // textcontainer — align within box
    if (valign === 'top')    startY = bottomPt + heightPt - fontSize;
    else if (valign === 'middle') startY = bottomPt + (heightPt + totalH) / 2 - lineHeightPt;
    else                     startY = bottomPt + totalH - lineHeightPt; // bottom
  } else if (downward) {
    // textarea downward: bottom field = distance from page top
    startY = pageH - bottomPt - fontSize;
  } else {
    startY = bottomPt;
  }

  for (const line of lines) {
    const tw = font.widthOfTextAtSize(line, fontSize);
    let x = leftPt;
    if (align === 'center' && widthPt) x = leftPt + (widthPt - tw) / 2;
    if (align === 'right'  && widthPt) x = leftPt + widthPt - tw;

    page.drawText(line, { x, y: startY, size: fontSize, font, color, rotate: degrees(rot) });
    startY -= downward ? lineHeightPt : lineHeightPt;
  }
}

// ── Barcode element renderer ──────────────────────────────────
async function renderBarcode(pdfDoc, page, el, values) {
  const content = resolveContent(el, values);
  if (!content) return;

  const sizePt = mm(parseFloat(el.size) || 20);
  const x = mm(el.left);
  const y = mm(el.bottom);

  const png = await QRCode.toBuffer(content, {
    type:   'png',
    width:  300,
    margin: el.nowhitespace ? 0 : 1,
    color: {
      dark:  el.color ? `#${el.color.slice(0,3).map(v => v.toString(16).padStart(2,'0')).join('')}` : '#000000',
      light: '#FFFFFF'
    }
  });

  const img = await pdfDoc.embedPng(png);
  page.drawImage(img, { x, y, width: sizePt, height: sizePt });
}

// ── Main render entry point ───────────────────────────────────
async function renderBadge(layoutElements, backgroundPdfBytes, values) {
  let pdfDoc;
  let page;

  if (backgroundPdfBytes && backgroundPdfBytes.length > 0) {
    const bgDoc = await PDFDocument.load(backgroundPdfBytes);
    pdfDoc = await PDFDocument.create();
    const [bgPage] = await pdfDoc.copyPages(bgDoc, [0]);
    pdfDoc.addPage(bgPage);
    page = pdfDoc.getPage(0);
  } else {
    pdfDoc = await PDFDocument.create();
    // Default badge size: 90 × 55 mm (landscape)
    page = pdfDoc.addPage([mm(90), mm(55)]);
  }

  for (const el of (layoutElements || [])) {
    try {
      if (el.type === 'textcontainer' || el.type === 'textarea') {
        await renderText(pdfDoc, page, el, values);
      } else if (el.type === 'barcodearea') {
        await renderBarcode(pdfDoc, page, el, values);
      }
      // imagearea and poweredby not supported
    } catch (err) {
      console.error(`Badge render — elemento ${el.type} ignorato:`, err.message);
    }
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { renderBadge };

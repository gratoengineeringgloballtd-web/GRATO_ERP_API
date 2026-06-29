// ═══════════════════════════════════════════════════════════════════════════
// FILE: services/pdfSigningService.js
//
// Uses pdf-lib (not PDFKit) because we are EDITING an existing uploaded PDF
// rather than generating one from scratch — pdf-lib loads arbitrary PDFs
// and draws on top of existing pages, which PDFKit cannot do.
//
// Coordinate conversion: fields are stored as normalized fractions (0-1) of
// page width/height (see SignableDocument.js header note). PDF coordinate
// origin is bottom-left, so y must be flipped: pdfY = pageHeight - (y * pageHeight) - boxHeightPts.
// ═══════════════════════════════════════════════════════════════════════════

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');

/**
 * Render a single field's value onto a pdf-lib page.
 */
const renderField = async (pdfDoc, page, field, font) => {
  const { width: pageW, height: pageH } = page.getSize();

  const boxX = field.x * pageW;
  const boxW = field.width * pageW;
  const boxH = field.height * pageH;
  // Flip Y: stored fraction is from the TOP of the page (matches how browsers
  // render PDF.js canvases), PDF native origin is bottom-left.
  const boxY = pageH - (field.y * pageH) - boxH;

  if (field.type === 'signature' || field.type === 'initials') {
    if (!field.value) return; // unfilled — leave blank (shouldn't happen post-validation)

    // field.value is expected to be a data URL: "data:image/png;base64,...."
    const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(field.value);
    if (!match) {
      console.warn(`Skipping field on page ${field.page}: value is not a recognized image data URL`);
      return;
    }
    const [, imgType, base64Data] = match;
    const imgBytes = Buffer.from(base64Data, 'base64');
    const image = imgType === 'png'
      ? await pdfDoc.embedPng(imgBytes)
      : await pdfDoc.embedJpg(imgBytes);

    // Fit the image inside the box, preserving aspect ratio, centered.
    const scale = Math.min(boxW / image.width, boxH / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const drawX = boxX + (boxW - drawW) / 2;
    const drawY = boxY + (boxH - drawH) / 2;

    page.drawImage(image, { x: drawX, y: drawY, width: drawW, height: drawH });

  } else if (field.type === 'date' || field.type === 'text') {
    const text = String(field.value || '');
    const fontSize = Math.min(boxH * 0.6, 12);
    page.drawText(text, {
      x: boxX + 2,
      y: boxY + (boxH - fontSize) / 2,
      size: fontSize,
      font,
      color: rgb(0, 0, 0)
    });
  }
};

/**
 * Optionally draw a thin border + label on UNFILLED fields — useful when
 * generating a "preview" PDF for the uploader before sending, not used on
 * the final flattened document.
 */
const renderFieldPlaceholder = (page, field) => {
  const { width: pageW, height: pageH } = page.getSize();
  const boxX = field.x * pageW;
  const boxW = field.width * pageW;
  const boxH = field.height * pageH;
  const boxY = pageH - (field.y * pageH) - boxH;

  page.drawRectangle({
    x: boxX, y: boxY, width: boxW, height: boxH,
    borderColor: rgb(0.2, 0.4, 0.9),
    borderWidth: 1,
    color: rgb(0.2, 0.4, 0.9),
    opacity: 0.08,
    borderOpacity: 0.6
  });
};

/**
 * Load the original PDF bytes from disk or a remote (Cloudinary) URL.
 * NOTE: uses native `fetch`, available in Node 18+. If running on an older
 * Node version, swap this for `node-fetch` or `https.get`.
 */
const loadOriginalBytes = async (originalFile) => {
  if (originalFile.storageType === 'cloudinary' || originalFile.path?.startsWith('http')) {
    const res = await fetch(originalFile.path);
    if (!res.ok) throw new Error(`Failed to fetch original PDF: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (!fs.existsSync(originalFile.path)) {
    throw new Error(`Original PDF not found on disk: ${originalFile.path}`);
  }
  return fs.readFileSync(originalFile.path);
};

/**
 * Burn ALL filled fields into the original PDF and return the flattened
 * bytes. Called once, after the final signer completes the chain.
 *
 * @param {SignableDocument} signableDocument - mongoose doc, fully populated fields/signers
 * @returns {Promise<Buffer>}
 */
const flattenSignedPDF = async (signableDocument) => {
  const originalBytes = await loadOriginalBytes(signableDocument.originalFile);
  const pdfDoc = await PDFDocument.load(originalBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pages = pdfDoc.getPages();

  for (const field of signableDocument.fields) {
    const pageIndex = field.page - 1; // fields are 1-indexed
    if (pageIndex < 0 || pageIndex >= pages.length) {
      console.warn(`Field references page ${field.page} but PDF only has ${pages.length} pages — skipping`);
      continue;
    }
    await renderField(pdfDoc, pages[pageIndex], field, font);
  }

  // Stamp a small footer on the last page noting completion, for visual audit
  const lastPage = pages[pages.length - 1];
  const { width } = lastPage.getSize();
  lastPage.drawText(
    `Digitally signed via internal e-signature portal — completed ${new Date().toISOString()}`,
    { x: 20, y: 12, size: 6, font, color: rgb(0.5, 0.5, 0.5) }
  );

  return Buffer.from(await pdfDoc.save());
};

/**
 * Generate a preview PDF with placeholder boxes drawn (no signatures yet) —
 * useful for the uploader to confirm field placement before submitting,
 * or for a signer to see where they'll sign before opening the live field.
 */
const generatePreviewPDF = async (signableDocument) => {
  const originalBytes = await loadOriginalBytes(signableDocument.originalFile);
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();

  for (const field of signableDocument.fields) {
    const pageIndex = field.page - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    renderFieldPlaceholder(pages[pageIndex], field);
  }

  return Buffer.from(await pdfDoc.save());
};

/**
 * Get page count + dimensions of an uploaded PDF — used right after upload
 * to validate it's a real PDF and to drive the placement canvas sizing.
 */
const getPdfMetadata = async (fileBytes) => {
  const pdfDoc = await PDFDocument.load(fileBytes);
  const pages = pdfDoc.getPages();
  return {
    pageCount: pages.length,
    pages: pages.map(p => {
      const { width, height } = p.getSize();
      return { width, height };
    })
  };
};

module.exports = {
  flattenSignedPDF,
  generatePreviewPDF,
  getPdfMetadata
};
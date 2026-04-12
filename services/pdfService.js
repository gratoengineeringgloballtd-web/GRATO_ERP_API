const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { resolveSignaturePath } = require('../utils/signatureResolver');



class PDFService {
    // Draws the payment terms section and returns updated y position
    drawPaymentTerms(doc, yPos, poData) {
      const startY = yPos + 10;
      doc.fontSize(10).font(this.boldFont).text('Payment Terms:', 40, startY);
      doc.fontSize(9).font(this.defaultFont).text(poData.paymentTerms || 'N/A', 40, startY + 15);
      return { yPos: startY + 35 };
    }
  constructor() {
    this.defaultFont = 'Helvetica';
    this.boldFont = 'Helvetica-Bold';
    this.logoPath = path.join(__dirname, '../public/images/company-logo.jpg');
    this.pageMargins = { top: 50, bottom: 80, left: 40, right: 40 };
  }


    /**
   * Generate IT Material Discharge & Acknowledgment PDF
   * @param {Object} request - ITSupportRequest document (populated)
   * @param {string} outputPath - Optional file path to save PDF
   * @returns {Promise<{success: boolean, buffer: Buffer, filename: string}>}
   */
  async generateITDischargePDF(request, outputPath) {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: this.pageMargins,
          bufferPages: true,
          info: {
            Title: `IT Material Discharge - ${request.ticketNumber}`,
            Author: 'GRATO ENGINEERING GLOBAL LTD',
            Subject: 'IT Material Discharge & Acknowledgment',
            Creator: 'ERP System'
          }
        });
        if (outputPath) {
          doc.pipe(fs.createWriteStream(outputPath));
        }
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          resolve({
            success: true,
            buffer: pdfBuffer,
            filename: `IT_Discharge_${request.ticketNumber}_${Date.now()}.pdf`
          });
        });

        // Header
        let yPos = 50;
        this.drawITDischargeHeader(doc, yPos, request);
        yPos += 80;

        // Discharged Items Table
        yPos = this.drawDischargedItemsTable(doc, yPos, request);
        yPos += 20;

        // Signatures Section
        yPos = this.drawITDischargeSignatures(doc, yPos, request);

        // Footer
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
          doc.switchToPage(i);
          this.drawFooter(doc, request, i + 1, range.count);
        }

        doc.end();
      } catch (error) {
        reject({ success: false, error: error.message });
      }
    });
  }

  async generateTenderApprovalFormPDF(tender) {
    return new Promise((resolve, reject) => {
      try {
        const PDFDocument = require('pdfkit');
        const fs          = require('fs');
        const path        = require('path');
        const { resolveSignaturePath } = require('../utils/signatureResolver');
  
        console.log('=== GENERATING TENDER APPROVAL FORM PDF ===');
        console.log('Tender:', tender.tenderNumber, '|', tender.title);
  
        const doc = new PDFDocument({
          size:        'A4',
          margins:     this.pageMargins,
          bufferPages: true,
          info: {
            Title:   `Tender Approval Form - ${tender.tenderNumber}`,
            Author:  'GRATO ENGINEERING GLOBAL LTD',
            Subject: 'Tender Approval Form',
            Creator: 'Procurement System'
          }
        });
  
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve({
          success:  true,
          buffer:   Buffer.concat(chunks),
          filename: `Tender_${tender.tenderNumber}_${Date.now()}.pdf`
        }));
  
        // ── helpers ────────────────────────────────────────────────────────────
        const fmt     = (n) => (Number(n) || 0).toLocaleString('en', { minimumFractionDigits: 0 });
        const fmtDate = (d) => {
          if (!d) return '';
          const dt = new Date(d);
          if (isNaN(dt.getTime())) return '';
          const day = String(dt.getDate()).padStart(2, '0');
          const mon = dt.toLocaleString('en-GB', { month: 'short' });
          return `${day}-${mon}-${String(dt.getFullYear()).slice(2)}`;
        };
  
        const suppliers = Array.isArray(tender.supplierQuotes) ? tender.supplierQuotes : [];
  
        // Collect all unique item descriptions (in insertion order)
        const allDescriptions = [];
        suppliers.forEach(sq =>
          (sq.items || []).forEach(item => {
            if (item.description && !allDescriptions.includes(item.description))
              allDescriptions.push(item.description);
          })
        );
  
        // quantity reference (first supplier with that item)
        const getQty = (desc) => {
          for (const sq of suppliers) {
            const found = (sq.items || []).find(i => i.description === desc);
            if (found) return found.quantity;
          }
          return '';
        };
  
        const pageW      = doc.page.width;  // 595.28
        const marginL    = this.pageMargins.left;   // 40
        const marginR    = this.pageMargins.right;  // 40
        const contentW   = pageW - marginL - marginR; // 515
  
        const PAGE_BOTTOM = doc.page.height - this.pageMargins.bottom - 80; // leave footer space
  
        let y = 50;
  
        // ──────────────────────────────────────────────────────────────────────
        // 1. HEADER — logo left, company name right
        // ──────────────────────────────────────────────────────────────────────
        try {
          if (fs.existsSync(this.logoPath)) {
            doc.image(this.logoPath, marginL, y, { width: 70, height: 66 });
          } else {
            doc.rect(marginL, y, 70, 66).strokeColor('#E63946').lineWidth(2).stroke();
            doc.fontSize(8).fillColor('#E63946').font(this.boldFont)
              .text('GRATO', marginL + 8, y + 20)
              .text('ENGINEERING', marginL + 4, y + 32).fillColor('#000000');
          }
        } catch { /* silently skip */ }
  
        doc.fontSize(10).font(this.boldFont).fillColor('#000000')
          .text('GRATO ENGINEERING GLOBAL LTD', marginL + 80, y);
        doc.fontSize(8).font(this.defaultFont)
          .text('Bonaberi, Douala — Cameroon', marginL + 80, y + 15)
          .text('682952153 | info@gratoengineering.com', marginL + 80, y + 27);
  
        y += 80;
  
        // ──────────────────────────────────────────────────────────────────────
        // 2. TITLE
        // ──────────────────────────────────────────────────────────────────────
        doc.fontSize(14).font(this.boldFont).fillColor('#000000')
          .text('TENDER APPROVAL FORM', marginL, y, { align: 'center', width: contentW });
        y += 20;
        doc.strokeColor('#333333').lineWidth(1.5)
          .moveTo(marginL, y).lineTo(marginL + contentW, y).stroke();
        y += 8;
  
        // ──────────────────────────────────────────────────────────────────────
        // 3. NUMBER / DATE / TITLE row
        // ──────────────────────────────────────────────────────────────────────
        const cellH = 18;
        // Row: NUMBER | value | (gap) | DATE | value
        this._tafCell(doc, marginL,        y, 75,  cellH, 'NUMBER:', true);
        this._tafCell(doc, marginL + 75,   y, 160, cellH, tender.tenderNumber || '');
        this._tafCell(doc, marginL + 235,  y, 55,  cellH, '');
        this._tafCell(doc, marginL + 290,  y, 50,  cellH, 'DATE', true);
        this._tafCell(doc, marginL + 340,  y, 175, cellH, fmtDate(tender.date));
        y += cellH;
  
        // Title row
        this._tafCell(doc, marginL,        y, 75,  cellH, 'TITLE', true);
        this._tafCell(doc, marginL + 75,   y, 440, cellH, (tender.title || '').toUpperCase(), false, true);
        y += cellH + 4;
  
        // ──────────────────────────────────────────────────────────────────────
        // 4. REQUESTER DETAILS (left) | SUPPLIER(S) ENGAGED (right)
        // ──────────────────────────────────────────────────────────────────────
        const halfW = contentW / 2;
        // Section headers
        this._tafCell(doc, marginL,         y, halfW, cellH, 'REQUESTER DETAILS',   true, true, '#d8d8d8');
        this._tafCell(doc, marginL + halfW, y, halfW, cellH, 'SUPPLIER(S) ENGAGED', true, true, '#d8d8d8');
        y += cellH;
  
        const reqRows = [
          ['REQUESTER NAME',  tender.requesterName       || ''],
          ['DEPARTMENT',      tender.requesterDepartment || ''],
          ['ITEM CATEGORY',   tender.itemCategory        || ''],
          ['REQUIRED DATE:',  fmtDate(tender.requiredDate)],
          ['COMMERCIAL TERMS',tender.commercialTerms     || '']
        ];
        const suppNames = suppliers.map(sq => sq.supplierName).filter(Boolean);
  
        const rowsCount = Math.max(reqRows.length, suppNames.length);
        for (let i = 0; i < rowsCount; i++) {
          const [label, val] = reqRows[i] || ['', ''];
          // left: label cell + value cell
          this._tafCell(doc, marginL,             y, 120, cellH, label, true, false, '#ececec');
          this._tafCell(doc, marginL + 120,       y, halfW - 120, cellH, val, false, false, '#ffffff', true);
          // right: supplier name
          const suppName = suppNames[i] || '';
          this._tafCell(doc, marginL + halfW,     y, halfW, cellH, suppName, false, false, '#ffffff', false, suppName === tender.awardedSupplierName);
          y += cellH;
        }
        y += 6;
  
        // ──────────────────────────────────────────────────────────────────────
        // 5. SUPPLIER COMPARISON TABLE
        // ──────────────────────────────────────────────────────────────────────
        // Column layout:
        //   Description (fixed) | Qty (fixed) | [Supplier A: UnitPrice | Total | NegTotal] | [Supplier B: …]
        const COL_DESC = 160;
        const COL_QTY  = 45;
        const remaining = contentW - COL_DESC - COL_QTY;
        const perSupplierW = suppliers.length > 0 ? Math.floor(remaining / suppliers.length) : remaining;
        const SUB_W = Math.floor(perSupplierW / 3);
  
        // Check page
        const tableHeaderH = cellH * 2;
        const tableBodyH   = allDescriptions.length * cellH + cellH; // + total row
        if (y + tableHeaderH + tableBodyH > PAGE_BOTTOM) {
          doc.addPage(); y = 50;
        }
  
        // Row 1: merged supplier name headers
        let cx = marginL + COL_DESC + COL_QTY;
        this._tafCell(doc, marginL,          y, COL_DESC, cellH, 'DESCRIPTION', true, true, '#d8d8d8');
        this._tafCell(doc, marginL + COL_DESC,y,COL_QTY,  cellH, 'QTY',         true, true, '#d8d8d8');
        suppliers.forEach(sq => {
          const isAwarded = sq.supplierName === tender.awardedSupplierName;
          this._tafCell(doc, cx, y, SUB_W * 3, cellH, sq.supplierName, true, true, isAwarded ? '#fff0b3' : '#e8e8e8');
          cx += SUB_W * 3;
        });
        y += cellH;
  
        // Row 2: sub-headers
        cx = marginL + COL_DESC + COL_QTY;
        this._tafCell(doc, marginL,          y, COL_DESC, cellH, '', false, false, '#f0f0f0');
        this._tafCell(doc, marginL + COL_DESC,y, COL_QTY, cellH, '', false, false, '#f0f0f0');
        suppliers.forEach(() => {
          ['UNIT PRICE','TOTAL AMOUNT','NEGOTIATED TOTAL'].forEach(h => {
            this._tafCell(doc, cx, y, SUB_W, cellH, h, true, true, '#f5f5f5', false, false, 7);
            cx += SUB_W;
          });
        });
        y += cellH;
  
        // Data rows
        allDescriptions.forEach(desc => {
          if (y + cellH > PAGE_BOTTOM) { doc.addPage(); y = 50; }
          cx = marginL + COL_DESC + COL_QTY;
          this._tafCell(doc, marginL,           y, COL_DESC, cellH, desc, false, false, '#ffffff', false, false, 8);
          this._tafCell(doc, marginL + COL_DESC,y, COL_QTY,  cellH, String(getQty(desc)), false, true);
          suppliers.forEach(sq => {
            const item = (sq.items || []).find(i => i.description === desc) || {};
            this._tafCell(doc, cx,         y, SUB_W, cellH, fmt(item.unitPrice),      false, true);
            this._tafCell(doc, cx + SUB_W, y, SUB_W, cellH, fmt(item.totalAmount),    false, true);
            this._tafCell(doc, cx+2*SUB_W, y, SUB_W, cellH, fmt(item.negotiatedTotal),true, true);
            cx += SUB_W * 3;
          });
          y += cellH;
        });
  
        // TOTAL row
        if (y + cellH > PAGE_BOTTOM) { doc.addPage(); y = 50; }
        cx = marginL + COL_DESC + COL_QTY;
        this._tafCell(doc, marginL,           y, COL_DESC, cellH, 'TOTAL', true, true, '#fff8dc');
        this._tafCell(doc, marginL + COL_DESC,y, COL_QTY,  cellH, '',      false, false, '#fff8dc');
        suppliers.forEach(sq => {
          this._tafCell(doc, cx,         y, SUB_W, cellH, '',               false, true, '#fff8dc');
          this._tafCell(doc, cx + SUB_W, y, SUB_W, cellH, fmt(sq.grandTotal),         true, true, '#fff8dc');
          this._tafCell(doc, cx+2*SUB_W, y, SUB_W, cellH, fmt(sq.negotiatedGrandTotal),true,true,'#fffacc');
          cx += SUB_W * 3;
        });
        y += cellH + 6;
  
        // ──────────────────────────────────────────────────────────────────────
        // 6. SUMMARY ROWS
        // ──────────────────────────────────────────────────────────────────────
        const summaryLabelW = 140;
        const summaryValW   = contentW - summaryLabelW;
        const summaryRows   = [
          ['DELIVERY TERMS', tender.deliveryTerms || ''],
          ['PAYMENT TERMS',  tender.paymentTerms  || ''],
          ['WARRANTY',       tender.warranty      || ''],
          ['AWARD',          tender.awardedSupplierName || ''],
          ['BUDGET',         tender.budget   ? `${fmt(tender.budget)} XAF` : ''],
          ['COST SAVINGS',   tender.costSavings ? `${fmt(tender.costSavings)} XAF` : ''],
          ['COST AVOIDANCE', tender.costAvoidance ? `${fmt(tender.costAvoidance)} XAF` : '']
        ];
  
        summaryRows.forEach(([label, val]) => {
          if (y + cellH > PAGE_BOTTOM) { doc.addPage(); y = 50; }
          const isAward = label === 'AWARD';
          this._tafCell(doc, marginL,                 y, summaryLabelW, cellH, label, true, false, '#ececec');
          this._tafCell(doc, marginL + summaryLabelW, y, summaryValW,   cellH, val,   isAward, false, isAward ? '#fffacc' : '#ffffff');
          y += cellH;
        });
        y += 6;
  
        // ──────────────────────────────────────────────────────────────────────
        // 7. TECHNICAL RECOMMENDATION
        // ──────────────────────────────────────────────────────────────────────
        const recText1 = tender.technicalRecommendation || '';
        const recH1    = Math.max(60, doc.heightOfString(recText1, { width: contentW - 10 }) + 14);
        if (y + cellH + recH1 > PAGE_BOTTOM) { doc.addPage(); y = 50; }
        this._tafCell(doc, marginL, y, contentW, cellH, 'TECHNICAL RECOMMENDATION', true, true, '#d8d8d8');
        y += cellH;
        this._tafCell(doc, marginL, y, contentW, recH1, recText1, false, false, '#ffffff', false, false, 8);
        y += recH1 + 4;
  
        // ──────────────────────────────────────────────────────────────────────
        // 8. PROCUREMENT RECOMMENDATION
        // ──────────────────────────────────────────────────────────────────────
        const recText2 = tender.procurementRecommendation || '';
        const recH2    = Math.max(60, doc.heightOfString(recText2, { width: contentW - 10 }) + 14);
        if (y + cellH + recH2 > PAGE_BOTTOM) { doc.addPage(); y = 50; }
        this._tafCell(doc, marginL, y, contentW, cellH, 'PROCUREMENT RECOMMENDATION', true, true, '#d8d8d8');
        y += cellH;
        this._tafCell(doc, marginL, y, contentW, recH2, recText2, false, false, '#ffffff', false, false, 8);
        y += recH2 + 8;
  
        // ──────────────────────────────────────────────────────────────────────
        // 9. APPROVAL SIGNATURE TABLE
        //    Columns: DEPARTMENT | NAME | SIGNATURE & DATE | REMARK
        //    One row per approval step in the chain (3 levels).
        //    Auto-filled if step.status === 'approved'.
        // ──────────────────────────────────────────────────────────────────────
        const approvalChain  = Array.isArray(tender.approvalChain) ? tender.approvalChain : [];
        const SIG_TABLE_ROWS = approvalChain.length || 3; // fallback: 3 empty rows
        const SIG_ROW_H      = 52; // height per row — enough for a signature image
        const totalSigH      = cellH + SIG_TABLE_ROWS * SIG_ROW_H;
  
        if (y + totalSigH > PAGE_BOTTOM) { doc.addPage(); y = 50; }
  
        // Column widths
        const CS = [95, 130, 190, 100]; // DEPT | NAME | SIG+DATE | REMARK
        const CH = ['DEPARTMENT', 'NAME', 'SIGNATURE & DATE', 'REMARK'];
        let hx = marginL;
        CH.forEach((h, i) => {
          this._tafCell(doc, hx, y, CS[i], cellH, h, true, true, '#d8d8d8');
          hx += CS[i];
        });
        y += cellH;
  
        // ── Approval rows ───────────────────────────────────────────────────────
        const fallbackRows = [
          { dept: 'Supply Chain',    role: 'Supply Chain Coordinator' },
          { dept: 'Head of Business',role: 'Head of Business'          },
          { dept: 'Finance',         role: 'Finance Officer'           }
        ];
  
        for (let i = 0; i < SIG_TABLE_ROWS; i++) {
          const step      = approvalChain[i];
          const isApproved= step && step.status === 'approved';
          const fb        = fallbackRows[i] || {};
          const dept      = step ? (step.approver.department || step.approver.role || fb.dept || '') : (fb.dept || '');
          const name      = step ? step.approver.name : '';
          const remark    = step ? (step.comments || '') : '';
          const signedDate= isApproved && step.actionDate ? fmtDate(step.actionDate) : '';
          const rowBg     = isApproved ? '#f6ffed' : '#ffffff';
  
          let rx = marginL;
  
          // DEPARTMENT cell
          this._tafCell(doc, rx, y, CS[0], SIG_ROW_H, dept, false, false, rowBg, false, false, 8);
          rx += CS[0];
  
          // NAME cell
          this._tafCell(doc, rx, y, CS[1], SIG_ROW_H, name, false, false, rowBg, false, false, 8);
          rx += CS[1];
  
          // SIGNATURE & DATE cell — render signature image if approved
          doc.rect(rx, y, CS[2], SIG_ROW_H).strokeColor('#cccccc').lineWidth(0.5).stroke();
          if (rowBg !== '#ffffff') doc.rect(rx, y, CS[2], SIG_ROW_H).fill(rowBg).stroke();
  
          if (isApproved) {
            // Try to render signature image
            const sigPath = resolveSignaturePath(step.signaturePath || step.decidedBy?.signature);
            if (sigPath) {
              try {
                const imgX = rx + 4;
                const imgY = y + 4;
                const imgW = CS[2] - 60;
                const imgH = SIG_ROW_H - 12;
                doc.save();
                doc.rect(imgX, imgY, imgW, imgH).fill('#ffffff');
                doc.restore();
                doc.image(sigPath, imgX, imgY, { width: imgW, height: imgH, fit: [imgW, imgH] });
              } catch (sigErr) {
                console.warn('Signature image error:', sigErr.message);
              }
            }
  
            // Date — bottom-right of the cell
            if (signedDate) {
              doc.fontSize(7).font(this.defaultFont).fillColor('#555555')
                .text(signedDate, rx + CS[2] - 58, y + SIG_ROW_H - 14, { width: 54, align: 'right' });
            }
  
            // Green checkmark indicator
            doc.fontSize(9).font(this.boldFont).fillColor('#52c41a')
              .text('✓', rx + CS[2] - 12, y + 4);
          }
          doc.fillColor('#000000');
          rx += CS[2];
  
          // REMARK cell
          this._tafCell(doc, rx, y, CS[3], SIG_ROW_H, remark, false, false, rowBg, false, false, 7);
  
          y += SIG_ROW_H;
        }
  
        y += 10;
  
        // ──────────────────────────────────────────────────────────────────────
        // 10. FOOTER — on every page
        // ──────────────────────────────────────────────────────────────────────
        const range = doc.bufferedPageRange();
        for (let p = 0; p < range.count; p++) {
          doc.switchToPage(p);
          this.drawFooter(doc, tender, p + 1, range.count);
        }
  
        doc.end();
        console.log('=== TENDER PDF GENERATION COMPLETE ===');
      } catch (err) {
        console.error('generateTenderApprovalFormPDF error:', err);
        reject({ success: false, error: err.message });
      }
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: draw a single table cell with optional bold / centered / coloured text
  // _tafCell(doc, x, y, w, h, text, bold, center, bgColour, italic, highlighted, fontSize)
  // ─────────────────────────────────────────────────────────────────────────────
  _tafCell(doc, x, y, w, h, text, bold = false, center = false, bg = '#ffffff',
          italic = false, highlighted = false, fontSize = 8) {
    // Background
    if (bg && bg !== '#ffffff') {
      doc.rect(x, y, w, h).fill(bg);
    }
    // Border
    doc.rect(x, y, w, h).strokeColor('#cccccc').lineWidth(0.5).stroke();
  
    if (!text && text !== 0) return;
  
    const str = String(text);
    doc.fontSize(fontSize)
      .font(bold ? this.boldFont : (italic ? 'Helvetica-Oblique' : this.defaultFont))
      .fillColor(highlighted ? '#7c5800' : '#000000');
  
    const padX = 4;
    const padY = (h - fontSize) / 2;  // vertical centre
  
    doc.text(str, x + padX, y + padY, {
      width:    w - padX * 2,
      height:   h,
      align:    center ? 'center' : 'left',
      ellipsis: true,
      lineBreak:str.length > 40   // allow wrap only for longer text
    });
  
    doc.fillColor('#000000');
  }

  drawITDischargeHeader(doc, yPos, request) {
    // Logo (if available)
    try {
      if (fs.existsSync(this.logoPath)) {
        doc.image(this.logoPath, 40, yPos, { width: 80 });
      }
    } catch {}
    doc.font(this.boldFont).fontSize(16).text('IT Material Discharge & Acknowledgment', 140, yPos, { align: 'left' });
    doc.font(this.defaultFont).fontSize(10).text(`Ticket: ${request.ticketNumber}`, 140, yPos + 22);
    doc.fontSize(10).text(`Employee: ${request.employee?.fullName || ''}`, 140, yPos + 38);
    doc.fontSize(10).text(`Department: ${request.employee?.department || ''}`, 140, yPos + 54);
    doc.fontSize(10).text(`Date: ${this.formatDateExact(new Date())}`, 140, yPos + 70);
  }

  drawDischargedItemsTable(doc, yPos, request) {
    doc.font(this.boldFont).fontSize(12).text('Discharged Items', 40, yPos);
    yPos += 18;
    // Table header
    doc.font(this.boldFont).fontSize(10);
    doc.text('Item', 40, yPos);
    doc.text('Qty', 220, yPos);
    doc.text('Asset Tag', 270, yPos);
    doc.text('Serial No.', 370, yPos);
    doc.text('Discharge Date', 470, yPos);
    yPos += 16;
    doc.font(this.defaultFont).fontSize(10);
    (request.dischargedItems || []).forEach(item => {
      doc.text(item.item || '', 40, yPos);
      doc.text(String(item.quantity || ''), 220, yPos);
      doc.text(item.assetTag || '', 270, yPos);
      doc.text(item.serialNumber || '', 370, yPos);
      doc.text(item.dischargeDate ? this.formatDateExact(item.dischargeDate) : '', 470, yPos);
      yPos += 14;
    });
    return yPos;
  }

  drawITDischargeSignatures(doc, yPos, request) {
    yPos += 20;
    doc.font(this.boldFont).fontSize(11).text('Signatures', 40, yPos);
    yPos += 18;
    // IT Staff Signature
    doc.font(this.defaultFont).fontSize(10).text('IT Staff:', 40, yPos);
    if (request.dischargeSignature?.imageUrl && fs.existsSync(request.dischargeSignature.imageUrl)) {
      doc.image(request.dischargeSignature.imageUrl, 100, yPos - 4, { width: 80, height: 40 });
    }
    doc.text(request.dischargeSignature?.name || '', 100, yPos + 40);
    doc.text(request.dischargeSignature?.signedAt ? this.formatDateExact(request.dischargeSignature.signedAt) : '', 100, yPos + 54);

    // Requester Signature
    doc.font(this.defaultFont).fontSize(10).text('Requester:', 320, yPos);
    if (request.acknowledgmentSignature?.imageUrl && fs.existsSync(request.acknowledgmentSignature.imageUrl)) {
      doc.image(request.acknowledgmentSignature.imageUrl, 400, yPos - 4, { width: 80, height: 40 });
    }
    doc.text(request.acknowledgmentSignature?.name || '', 400, yPos + 40);
    doc.text(request.acknowledgmentSignature?.signedAt ? this.formatDateExact(request.acknowledgmentSignature.signedAt) : '', 400, yPos + 54);
    return yPos + 70;
  }


  async generatePurchaseOrderPDF(poData, outputPath) {
    return new Promise((resolve, reject) => {
      try {
        console.log('=== STARTING PDF GENERATION ===');
        console.log('PO Data received:', JSON.stringify(poData, null, 2));

        const doc = new PDFDocument({ 
          size: 'A4', 
          margins: this.pageMargins,
          bufferPages: true,
          info: {
            Title: `Purchase Order - ${poData.poNumber}`,
            Author: 'GRATO ENGINEERING GLOBAL LTD',
            Subject: 'Purchase Order',
            Creator: 'Purchase Order System'
          }
        });

        if (outputPath) {
          doc.pipe(fs.createWriteStream(outputPath));
        }

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          console.log('=== PDF GENERATION COMPLETED ===');
          resolve({
            success: true,
            buffer: pdfBuffer,
            filename: `PO_${poData.poNumber}_${Date.now()}.pdf`
          });
        });

        this.generateExactPOContent(doc, poData);
        doc.end();
      } catch (error) {
        console.error('PDF generation error:', error);
        reject({
          success: false,
          error: error.message
        });
      }
    });
  }

  generateExactPOContent(doc, poData) {
    let yPos = 50;
    let currentPage = 1;

    // Header with logo and company info
    this.drawHeader(doc, yPos, poData);
    yPos += 90;

    // Two-column section: Shipping address (left) and Supplier (right)
    this.drawAddressSection(doc, yPos, poData);
    yPos += 90; 

    // Purchase Order Title Bar
    this.drawPOTitleBar(doc, yPos, poData);
    yPos += 50;

    // Items Table - This handles pagination internally
    const tableResult = this.drawItemsTable(doc, yPos, poData, currentPage);
    yPos = tableResult.yPos;
    currentPage = tableResult.currentPage;

    // Check if we need a new page for remaining content
    if (yPos > 650) {
      doc.addPage();
      currentPage++;
      yPos = 50;
    }

    // Payment Terms (signature should follow immediately after)
    const termsResult = this.drawPaymentTerms(doc, yPos, poData);
    yPos = termsResult.yPos;

    // Check if we need a new page for signature
    const signatureSpace = this.getPOSignatureSectionHeight(poData);
    const pageHeight = doc.page.height;
    const footerBlockHeight = 60;
    const footerY = pageHeight - this.pageMargins.bottom - footerBlockHeight;
    const contentBottomLimit = footerY - 10;

    if (yPos + signatureSpace > contentBottomLimit) {
      doc.addPage();
      currentPage++;
      yPos = 50;
    }

    // Signature Section (immediately after payment terms)
    this.drawSignatureSection(doc, yPos, poData);

    // Special Instructions (rendered after signatures)
    yPos = this.drawSpecialInstructions(doc, yPos + signatureSpace, poData);

    // ✅ FIXED: Draw footer on all pages with correct indexing
    const range = doc.bufferedPageRange();
    console.log('Page range:', range); // Debug log
    
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i); // ✅ Use 0-based index
      this.drawFooter(doc, poData, i + 1, range.count); // Pass 1-based page number for display
    }
  }

  // ============================================
  // INVOICE PDF
  // ============================================
  async generateInvoicePDF(invoiceData, outputPath) {
    return new Promise((resolve, reject) => {
      try {
        console.log('=== STARTING INVOICE PDF GENERATION ===');
        console.log('Invoice Data received:', JSON.stringify(invoiceData, null, 2));

        const doc = new PDFDocument({
          size: 'A4',
          margins: this.pageMargins,
          bufferPages: true,
          info: {
            Title: `Invoice - ${invoiceData.invoiceNumber}`,
            Author: 'GRATO ENGINEERING GLOBAL LTD',
            Subject: 'Invoice',
            Creator: 'Invoice System'
          }
        });

        if (outputPath) {
          doc.pipe(fs.createWriteStream(outputPath));
        }

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          console.log('=== INVOICE PDF GENERATION COMPLETED ===');
          resolve({
            success: true,
            buffer: pdfBuffer,
            filename: `INV_${invoiceData.invoiceNumber}_${Date.now()}.pdf`
          });
        });

        this.generateInvoiceContent(doc, invoiceData);
        doc.end();
      } catch (error) {
        console.error('Invoice PDF generation error:', error);
        reject({ success: false, error: error.message });
      }
    });
  }

  generateInvoiceContent(doc, data) {
    let yPos = 50;
    let currentPage = 1;

    // Header
    this.drawHeader(doc, yPos, data);
    yPos += 90;

    // Address Section (Bill To / Company)
    this.drawInvoiceAddressSection(doc, yPos, data);
    yPos += 90;

    // Invoice Title Bar
    this.drawInvoiceTitleBar(doc, yPos, data);
    yPos += 50;

    // Items Table
    const tableResult = this.drawInvoiceItemsTable(doc, yPos, data, currentPage);
    yPos = tableResult.yPos;
    currentPage = tableResult.currentPage;

    // Page break before terms/breakdown if needed
    if (yPos > 650) {
      doc.addPage();
      currentPage++;
      yPos = 50;
    }

    // Payment Terms
    yPos = this.drawInvoicePaymentTerms(doc, yPos, data);

    // Payment Breakdown (if any)
    yPos = this.drawInvoicePaymentBreakdown(doc, yPos, data);

    // Footer on all pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      this.drawFooter(doc, data, i + 1, range.count);
    }
  }

  drawInvoiceAddressSection(doc, yPos, data) {
    // LEFT: Bill To (Customer)
    const customer = data.customerDetails || {};
    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Bill To', 40, yPos);

    doc.font(this.defaultFont)
      .fontSize(9)
      .text(this.safeString(customer.name, 'Customer Name'), 40, yPos + 15)
      .text(this.safeString(customer.address, 'Address'), 40, yPos + 28)
      .text(this.safeString(customer.email, 'Email'), 40, yPos + 41);

    if (customer.phone) {
      doc.text(`${customer.phone}`, 40, yPos + 54);
    }

    // RIGHT: Company info (GRATO)
    doc.fontSize(9)
      .font(this.boldFont)
      .text('Issued By', 320, yPos);

    doc.font(this.defaultFont)
      .fontSize(9)
      .text('GRATO ENGINEERING GLOBAL LTD', 320, yPos + 15)
      .text('Bonaberi, Douala', 320, yPos + 28)
      .text('Cameroon', 320, yPos + 41)
      .text('682952153', 320, yPos + 54);
  }

  drawInvoiceTitleBar(doc, yPos, data) {
    doc.fillColor('#C5504B')
      .fontSize(14)
      .font(this.boldFont)
      .text(`Invoice #${this.safeString(data.invoiceNumber, 'INV-000001')}`, 40, yPos);

    const detailsY = yPos + 25;

    doc.fillColor('#888888')
      .fontSize(8)
      .font(this.defaultFont)
      .text('Invoice Date:', 40, detailsY);
    doc.fillColor('#000000')
      .fontSize(9)
      .text(this.formatDateExact(data.invoiceDate), 40, detailsY + 12);

    doc.fillColor('#888888')
      .fontSize(8)
      .text('Due Date:', 220, detailsY);
    doc.fillColor('#000000')
      .fontSize(9)
      .text(this.formatDateExact(data.dueDate), 220, detailsY + 12);

    doc.fillColor('#888888')
      .fontSize(8)
      .text('PO Reference:', 400, detailsY);
    doc.fillColor('#000000')
      .fontSize(9)
      .text(this.safeString(data.poReference || data.poNumber, 'N/A'), 400, detailsY + 12);
  }

  drawInvoiceItemsTable(doc, yPos, data, currentPage) {
    const tableWidth = 515;
    const colX = {
      desc: 40,
      qty: 280,
      unitPrice: 325,
      tax: 400,
      amount: 470
    };

    let currentY = yPos;
    const pageBottomLimit = 720;

    const drawTableHeader = (y) => {
      doc.fillColor('#F5F5F5')
        .rect(40, y, tableWidth, 20)
        .fill();

      doc.strokeColor('#CCCCCC')
        .lineWidth(0.5)
        .rect(40, y, tableWidth, 20)
        .stroke();

      doc.fillColor('#000000')
        .fontSize(9)
        .font(this.boldFont);

      doc.text('Description', colX.desc + 5, y + 6);
      doc.text('Qty', colX.qty, y + 6);
      doc.text('Unit Price', colX.unitPrice, y + 6);
      doc.text('Tax %', colX.tax, y + 6);
      doc.text('Amount', colX.amount, y + 6);

      [colX.qty, colX.unitPrice, colX.tax, colX.amount].forEach(x => {
        doc.moveTo(x, y).lineTo(x, y + 20).stroke();
      });

      return y + 20;
    };

    currentY = drawTableHeader(currentY);

    let subtotal = 0;
    let taxTotal = 0;
    let total = 0;

    const items = Array.isArray(data.items) ? data.items : [];

    items.forEach((item) => {
      const quantity = this.safeNumber(item.quantity, 0);
      const unitPrice = this.safeNumber(item.unitPrice, 0);
      const taxRate = this.safeNumber(item.taxRate, 0);
      const lineSubtotal = quantity * unitPrice;
      const lineTax = lineSubtotal * (taxRate / 100);
      const lineTotal = lineSubtotal + lineTax;

      subtotal += lineSubtotal;
      taxTotal += lineTax;
      total += lineTotal;

      const description = this.safeString(item.description, 'No description');
      const descWidth = 230;
      doc.fontSize(8).font(this.defaultFont);
      const descHeight = doc.heightOfString(description, { width: descWidth, lineGap: 1 });
      const rowHeight = Math.max(25, descHeight + 12);

      if (currentY + rowHeight > pageBottomLimit) {
        doc.addPage();
        currentPage++;
        currentY = 50;
        currentY = drawTableHeader(currentY);
      }

      doc.strokeColor('#CCCCCC')
        .rect(40, currentY, tableWidth, rowHeight)
        .stroke();

      doc.fillColor('#000000')
        .fontSize(8)
        .font(this.defaultFont);

      doc.text(description, colX.desc + 5, currentY + 6, {
        width: descWidth,
        align: 'left',
        lineGap: 1
      });

      const textY = currentY + (rowHeight / 2) - 4;
      doc.text(quantity.toFixed(2), colX.qty, textY);
      doc.text(this.formatCurrency(unitPrice), colX.unitPrice, textY);
      doc.text(`${taxRate.toFixed(2)}%`, colX.tax, textY);
      doc.text(`${this.formatCurrency(lineTotal)} FCFA`, colX.amount, textY);

      [colX.qty, colX.unitPrice, colX.tax, colX.amount].forEach(x => {
        doc.moveTo(x, currentY).lineTo(x, currentY + rowHeight).stroke();
      });

      currentY += rowHeight;
    });

    if (items.length === 0) {
      doc.fillColor('#F9F9F9')
        .rect(40, currentY, tableWidth, 22)
        .fill();

      doc.strokeColor('#CCCCCC')
        .rect(40, currentY, tableWidth, 22)
        .stroke();

      doc.fillColor('#666666')
        .text('No items found', colX.desc + 5, currentY + 6);

      currentY += 22;
    }

    if (currentY + 90 > pageBottomLimit) {
      doc.addPage();
      currentPage++;
      currentY = 50;
    }

    const summaryTotals = {
      subtotal: data.netAmount ?? subtotal,
      taxTotal: data.taxAmount ?? taxTotal,
      total: data.totalAmount ?? total
    };

    this.drawInvoiceSummary(doc, currentY, summaryTotals);
    currentY += 80;

    return { yPos: currentY, currentPage };
  }

  drawInvoiceSummary(doc, yPos, totals) {
    const summaryX = 380;
    const summaryWidth = 175;
    const labelX = summaryX + 10;

    doc.strokeColor('#CCCCCC')
      .lineWidth(0.5)
      .rect(summaryX, yPos, summaryWidth, 60)
      .stroke();

    doc.fontSize(9)
      .font(this.defaultFont)
      .fillColor('#000000');

    doc.text('Untaxed Amount', labelX, yPos + 8);
    doc.text(`${this.formatCurrency(totals.subtotal)} FCFA`, labelX, yPos + 8, {
      width: summaryWidth - 20,
      align: 'right'
    });

    doc.text('Tax Amount', labelX, yPos + 24);
    doc.text(`${this.formatCurrency(totals.taxTotal)} FCFA`, labelX, yPos + 24, {
      width: summaryWidth - 20,
      align: 'right'
    });

    doc.fillColor('#E8E8E8')
      .rect(summaryX, yPos + 40, summaryWidth, 20)
      .fill();

    doc.strokeColor('#CCCCCC')
      .rect(summaryX, yPos + 40, summaryWidth, 20)
      .stroke();

    doc.fillColor('#000000')
      .font(this.boldFont)
      .text('Total', labelX, yPos + 46);
    doc.text(`${this.formatCurrency(totals.total)} FCFA`, labelX, yPos + 46, {
      width: summaryWidth - 20,
      align: 'right'
    });
  }

  drawInvoicePaymentTerms(doc, yPos, data) {
    let currentY = yPos;
    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Payment Terms:', 40, currentY);

    currentY += 16;

    doc.font(this.defaultFont)
      .fontSize(8)
      .text(this.safeString(data.paymentTerms, 'Net 30 days'), 40, currentY);

    return currentY + 14;
  }

  drawInvoicePaymentBreakdown(doc, yPos, data) {
    const breakdown = Array.isArray(data.paymentTermsBreakdown) ? data.paymentTermsBreakdown : [];
    if (breakdown.length === 0) return yPos;

    let currentY = yPos + 8;

    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Payment Breakdown:', 40, currentY);

    currentY += 14;

    breakdown.forEach(term => {
      const timeframe = term.customTimeframe || term.timeframe || '';
      const line = `${term.description || 'Term'} - ${this.safeNumber(term.percentage, 0)}% (${this.formatCurrency(term.amount)} FCFA)`;
      doc.fontSize(8)
        .font(this.defaultFont)
        .fillColor('#000000')
        .text(timeframe ? `${line} | ${timeframe}` : line, 40, currentY, { width: 500 });
      currentY += 12;
    });

    return currentY + 6;
  }

  drawHeader(doc, yPos, poData) {
    // Company Logo (left side)
    try {
      if (fs.existsSync(this.logoPath)) {
        doc.image(this.logoPath, 40, yPos, { width: 60, height: 56 });
      } else {
        // Placeholder logo - red box with text
        doc.rect(40, yPos, 60, 60)
           .strokeColor('#E63946')
           .lineWidth(2)
           .stroke();
        
        doc.fontSize(8)
           .fillColor('#E63946')
           .font(this.boldFont)
           .text('GRATO', 48, yPos + 20)
           .text('ENGINEERING', 43, yPos + 32)
           .fillColor('#000000');
      }
    } catch (error) {
      console.log('Logo loading error:', error.message);
      // Draw placeholder
      doc.rect(40, yPos, 60, 60)
         .strokeColor('#E63946')
         .lineWidth(2)
         .stroke();
      
      doc.fontSize(8)
         .fillColor('#E63946')
         .font(this.boldFont)
         .text('GRATO', 48, yPos + 20)
         .text('ENGINEERING', 43, yPos + 32)
         .fillColor('#000000');
    }

    // Company name and address (left, under logo)
    doc.fontSize(11)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('GRATO ENGINEERING GLOBAL LTD', 110, yPos);

    doc.fontSize(9)
       .font(this.defaultFont)
       .text('Bonaberi', 110, yPos + 15)
       .text('Douala Cameroon', 110, yPos + 28);
  }

  drawAddressSection(doc, yPos, poData) {
    // Left column: Shipping address
    doc.fontSize(9)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Shipping address', 40, yPos);

    doc.font(this.defaultFont)
       .fontSize(9)
       .text('GRATO ENGINEERING GLOBAL LTD', 40, yPos + 15)
       .text('Bonaberi', 40, yPos + 28)
       .text('Douala', 40, yPos + 41)
       .text('Cameroon', 40, yPos + 54);

    doc.text('682952153', 40, yPos + 67);

    // Right column: Supplier information (dynamic based on PO data)
    const supplier = poData.supplierDetails || {};
    
    doc.font(this.defaultFont)
       .fontSize(9)
       .text(this.safeString(supplier.name, 'Supplier Name Not Available'), 320, yPos)
       .text(this.safeString(supplier.address, 'Address Not Available'), 320, yPos + 13)
       .text(this.safeString(supplier.email, 'Email Not Available'), 320, yPos + 26);

    if (supplier.phone) {
      doc.text(`${supplier.phone}`, 320, yPos + 39);
    }
    
    if (supplier.taxId || supplier.registrationNumber) {
      doc.fontSize(8)
         .text(`VAT: ${supplier.taxId || supplier.registrationNumber || 'N/A'}`, 320, yPos + 52);
    }
  }

  drawPOTitleBar(doc, yPos, poData) {
    // Purchase Order title - just colored text, no background bar
    doc.fillColor('#C5504B') 
       .fontSize(14)
       .font(this.boldFont)
       .text(`Purchase Order #${this.safeString(poData.poNumber, 'P00004')}`, 40, yPos);

    // Three-column info below title
    const detailsY = yPos + 25;
    
    // Buyer column
    doc.fillColor('#888888')
       .fontSize(8)
       .font(this.defaultFont)
       .text('Buyer:', 40, detailsY);
    
    doc.fillColor('#000000')
       .fontSize(9)
       .font(this.defaultFont)
       .text('GRATO ENGINEERING', 40, detailsY + 12);

    // Order Date column  
    doc.fillColor('#888888')
       .fontSize(8)
       .text('Order Date:', 220, detailsY);
    
    doc.fillColor('#000000')
       .fontSize(9)
       .text(this.formatDateExact(poData.creationDate), 220, detailsY + 12);

    // Expected Arrival column
    doc.fillColor('#888888')
       .fontSize(8)
       .text('Expected Arrival:', 400, detailsY);
    
    doc.fillColor('#000000')
       .fontSize(9)
       .text(this.formatDateExact(poData.expectedDeliveryDate), 400, detailsY + 12);
  }

  drawItemsTable(doc, yPos, poData, currentPage) {
    console.log('=== DRAWING ITEMS TABLE ===');
    console.log('Items data:', poData.items);
    
    const tableWidth = 515;
    const colX = {
      desc: 40,
      qty: 280,
      unitPrice: 325,
      disc: 400,
      taxes: 445,
      amount: 490
    };
    
    let currentY = yPos;
    const pageBottomLimit = 720; // Leave space for footer

    // Draw table header
    const drawTableHeader = (y) => {
      // Table header with gray background
      doc.fillColor('#F5F5F5')
         .rect(40, y, tableWidth, 20)
         .fill();

      doc.strokeColor('#CCCCCC')
         .lineWidth(0.5)
         .rect(40, y, tableWidth, 20)
         .stroke();

      doc.fillColor('#000000')
         .fontSize(9)
         .font(this.boldFont);

      // Column headers
      doc.text('Description', colX.desc + 5, y + 6);
      doc.text('Qty', colX.qty, y + 6);
      doc.text('Unit Price', colX.unitPrice, y + 6);
      doc.text('Disc.', colX.disc, y + 6);
      doc.text('Taxes', colX.taxes, y + 6);
      doc.text('Amount', colX.amount, y + 6);

      // Vertical lines for header
      [colX.qty, colX.unitPrice, colX.disc, colX.taxes, colX.amount].forEach(x => {
        doc.moveTo(x, y).lineTo(x, y + 20).stroke();
      });

      return y + 20;
    };

    currentY = drawTableHeader(currentY);

    // Determine tax rate
    let taxRate = 0;
    if (poData.taxApplicable) {
      taxRate = typeof poData.taxRate === 'number' ? poData.taxRate : 0.1925;
      console.log(`Tax is applicable, using ${taxRate * 100}%`);
    }
    
    let grandTotal = 0;

    // Table rows
    const items = Array.isArray(poData.items) ? poData.items : [];
    console.log(`Processing ${items.length} items`);

    items.forEach((item, index) => {
      console.log(`=== Processing item ${index} ===`, item);
      
      const quantity = this.safeNumber(item.quantity, 0);
      const unitPrice = this.safeNumber(item.unitPrice, 0);
      const discount = this.safeNumber(item.discount, 0);
      
      // Calculate amounts
      const itemSubtotal = quantity * unitPrice;
      const discountAmount = itemSubtotal * (discount / 100);
      const afterDiscount = itemSubtotal - discountAmount;
      const taxAmount = afterDiscount * taxRate;
      const itemTotal = afterDiscount + taxAmount;
      
      console.log('Calculated:', { itemSubtotal, discountAmount, afterDiscount, taxAmount, itemTotal });
      
      grandTotal += itemTotal;
      
      // Get full description
      const description = this.safeString(item.description, 'No description');
      
      // Calculate dynamic row height based on description length
      const descWidth = 230; // Width available for description column
      doc.fontSize(8).font(this.defaultFont);
      const descHeight = doc.heightOfString(description, { width: descWidth, lineGap: 1 });
      const rowHeight = Math.max(25, descHeight + 12); // Minimum 25px, or description height + padding
      
      // ✅ FIXED: Check if row will fit on current page
      if (currentY + rowHeight > pageBottomLimit) {
        // Add new page
        doc.addPage();
        currentPage++;
        currentY = 50;
        
        // Redraw header on new page
        currentY = drawTableHeader(currentY);
      }

      // Row border
      doc.strokeColor('#CCCCCC')
         .rect(40, currentY, tableWidth, rowHeight)
         .stroke();

      doc.fillColor('#000000')
         .fontSize(8)
         .font(this.defaultFont);

      // Description - full text with word wrap
      doc.text(description, colX.desc + 5, currentY + 6, {
        width: descWidth,
        align: 'left',
        lineGap: 1
      });
      
      // Other columns - vertically centered
      const textY = currentY + (rowHeight / 2) - 4;
      
      doc.text(quantity.toFixed(2), colX.qty, textY);
      doc.text(this.formatCurrency(unitPrice), colX.unitPrice, textY);
      doc.text(discount > 0 ? `${discount.toFixed(2)}%` : '0.00%', colX.disc, textY);
      doc.text(taxRate > 0 ? `${(taxRate * 100).toFixed(2)}% G` : '0%', colX.taxes, textY);
      doc.text(`${this.formatCurrency(itemTotal)} FCFA`, colX.amount, textY);

      // Vertical lines for row
      [colX.qty, colX.unitPrice, colX.disc, colX.taxes, colX.amount].forEach(x => {
        doc.moveTo(x, currentY).lineTo(x, currentY + rowHeight).stroke();
      });

      currentY += rowHeight;
    });

    // If no items
    if (items.length === 0) {
      doc.fillColor('#F9F9F9')
         .rect(40, currentY, tableWidth, 22)
         .fill();

      doc.strokeColor('#CCCCCC')
         .rect(40, currentY, tableWidth, 22)
         .stroke();

      doc.fillColor('#666666')
         .text('No items found', colX.desc + 5, currentY + 6);
      
      currentY += 22;
    }

    // Check if summary will fit on current page
    if (currentY + 100 > pageBottomLimit) {
      doc.addPage();
      currentPage++;
      currentY = 50;
    }

    // Draw summary box
    this.drawOrderSummary(doc, currentY, grandTotal, taxRate);
    currentY += 90;

    return { yPos: currentY, currentPage };
  }

  drawOrderSummary(doc, yPos, grandTotal, taxRate) {
    console.log('=== DRAWING ORDER SUMMARY ===');
    console.log('Grand Total:', grandTotal, 'Tax Rate:', taxRate);
    
    const summaryX = 380;
    const summaryWidth = 175;
    const labelX = summaryX + 10;
    
    yPos += 10;

    // Calculate breakdown
    let untaxedAmount = grandTotal;
    let vatAmount = 0;
    
    if (taxRate > 0) {
      untaxedAmount = grandTotal / (1 + taxRate);
      vatAmount = grandTotal - untaxedAmount;
    }

    // Summary box border
    doc.strokeColor('#CCCCCC')
       .lineWidth(0.5)
       .rect(summaryX, yPos, summaryWidth, 68)
       .stroke();

    doc.fontSize(9)
       .font(this.defaultFont)
       .fillColor('#000000');

    // Untaxed Amount
    doc.text('Untaxed Amount', labelX, yPos + 10);
    doc.text(`${this.formatCurrency(untaxedAmount)} FCFA`, labelX, yPos + 10, {
      width: summaryWidth - 20,
      align: 'right'
    });

    // VAT line
    doc.text(`VAT ${(taxRate * 100).toFixed(2)}%`, labelX, yPos + 28);
    doc.text(`${this.formatCurrency(vatAmount)} FCFA`, labelX, yPos + 28, {
      width: summaryWidth - 20,
      align: 'right'
    });

    // Total row with gray background
    doc.fillColor('#E8E8E8')
       .rect(summaryX, yPos + 46, summaryWidth, 22)
       .fill();

    doc.strokeColor('#CCCCCC')
       .rect(summaryX, yPos + 46, summaryWidth, 22)
       .stroke();

    doc.fillColor('#000000')
       .font(this.boldFont)
       .text('Total', labelX, yPos + 53);
    
    doc.text(`${this.formatCurrency(grandTotal)} FCFA`, labelX, yPos + 53, {
      width: summaryWidth - 20,
      align: 'right'
    });
  }


drawSignatureSection(doc, yPos, poData) {
  const defaultSignatures = [
    { label: 'Supply Chain' },
    { label: 'Finance' },
    { label: 'Head of Business' }
  ];

  const allowedLabels = ['supply chain', 'finance', 'head of business'];

  const rawSignatures = Array.isArray(poData?.signatures) && poData.signatures.length
    ? poData.signatures
    : defaultSignatures;

  const filtered = rawSignatures.filter(sig =>
    allowedLabels.includes((sig?.label || '').toLowerCase())
  );

  const order = ['supply chain', 'finance', 'head of business'];
  const signatures = (filtered.length > 0 ? filtered : defaultSignatures).sort((a, b) =>
    order.indexOf((a?.label || '').toLowerCase()) - order.indexOf((b?.label || '').toLowerCase())
  );

  const columnCount = 3;
  const blockWidth = 160;
  const columnGap = 17;
  const rowHeight = 60;
  const baseY = yPos + 10;

  signatures.forEach((signature, index) => {
    const row = Math.floor(index / columnCount);
    const col = index % columnCount;
    const xPos = 40 + col * (blockWidth + columnGap);
    const lineY = baseY + row * rowHeight + 24;

    doc.moveTo(xPos, lineY)
      .lineTo(xPos + blockWidth, lineY)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    // ✅ PATCHED: use resolveSignaturePath instead of fs.existsSync
    const resolvedSigPath = resolveSignaturePath(signature?.signaturePath || signature);
    if (resolvedSigPath) {
      try {
        const imgWidth = 62;
        const imgX = xPos + (blockWidth - imgWidth) / 2;
        const imgY = lineY - 32 - 4;
        doc.save();
        doc.rect(imgX, imgY, imgWidth, 28).fill('#FFFFFF');
        doc.restore();
        doc.image(resolvedSigPath, imgX, imgY, { width: imgWidth });
      } catch (error) {
        console.error('Signature image render error:', error.message);
      }
    }

    const signedAtText = signature?.signedAt
      ? this.formatDateExact(signature.signedAt)
      : '';

    if (signedAtText) {
      doc.fontSize(7)
        .font(this.defaultFont)
        .fillColor('#000000')
        .text(signedAtText, xPos + blockWidth - 80, lineY - 16, {
          width: 80,
          align: 'right'
        });
    }

    doc.fontSize(7)
      .font(this.boldFont)
      .fillColor('#000000')
      .text(signature?.label || 'Signature', xPos, lineY + 6);
  });
}


  getPOSignatureSectionHeight(poData) {
    // Match the filtering logic from drawSignatureSection
    const defaultSignatures = [
      { label: 'Supply Chain' },
      { label: 'Finance' },
      { label: 'Head of Business' }
    ];
    const allowedLabels = ['supply chain', 'finance', 'head of business'];
    const rawSignatures = Array.isArray(poData?.signatures) && poData.signatures.length
      ? poData.signatures
      : defaultSignatures;
    const filtered = rawSignatures.filter(sig =>
      allowedLabels.includes((sig?.label || '').toLowerCase())
    );
    // For now, just return a fixed height (could be dynamic based on filtered.length)
    return 80;
  }

  drawSpecialInstructions(doc, yPos, poData) {
    if (!poData.specialInstructions) return yPos;

    let currentY = yPos;
    const pageHeight = doc.page.height;
    const footerBlockHeight = 60;
    const footerY = pageHeight - this.pageMargins.bottom - footerBlockHeight;
    const contentBottomLimit = footerY - 10;

    const decodedInstructions = this.decodeHTMLEntities(poData.specialInstructions);
    const textOptions = {
      width: 500,
      lineGap: 4,
      align: 'left'
    };

    const textHeight = doc.heightOfString(decodedInstructions, textOptions);
    const headingHeight = 18;
    const spacingHeight = 8;
    const totalHeight = headingHeight + textHeight + spacingHeight;

    if (currentY + totalHeight > contentBottomLimit) {
      doc.addPage();
      currentY = 50;
    }

    doc.font(this.boldFont)
       .fontSize(9)
       .text('Special Instructions:', 40, currentY);

    currentY += headingHeight;

    doc.font(this.defaultFont)
       .fontSize(8)
       .text(decodedInstructions, 40, currentY, textOptions);

    currentY += textHeight + spacingHeight;

    return currentY;
  }


  drawFooter(doc, poData, pageNum, totalPages) {
    doc.save(); // Save state before drawing footer
    
    const footerBlockHeight = 60;
    const footerY = doc.page.height - this.pageMargins.bottom - footerBlockHeight;
    
    // Horizontal line
    doc.strokeColor('#CCCCCC')
      .lineWidth(0.5)
      .moveTo(40, footerY)
      .lineTo(555, footerY)
      .stroke();

    // Footer content
    doc.fontSize(7)
      .font(this.defaultFont)
      .fillColor('#666666');

    // Registration and page number
    doc.text('RC/DLA/2014/B/2690 NIU: M061421030521 Access Bank Cameroon PLC 10041000010010130003616', 40, footerY + 8, {
      width: 470,
      height: 10,
      lineBreak: false,
      ellipsis: true,
      continued: false
    });
    
    doc.text(`Page ${pageNum} / ${totalPages}`, 520, footerY + 8, {
      width: 35,
      height: 10,
      align: 'right',
      continued: false
    });

    // Contact information
    doc.text('679586444 info@gratoengineering.com www.gratoengineering.com', 40, footerY + 20, {
      width: 515,
      height: 10,
      lineBreak: false,
      ellipsis: true,
      continued: false
    });
    
    doc.text('Location: Bonaberi-Douala, beside Santa', 40, footerY + 32, {
      width: 515,
      height: 10,
      lineBreak: false,
      ellipsis: true,
      continued: false
    });
    
    doc.text('Lucia Telecommunications, Civil, Electrical and Mechanical Engineering Services.', 40, footerY + 44, {
      width: 515,
      height: 10,
      lineBreak: false,
      ellipsis: true,
      continued: false
    });
    
    doc.restore(); // Restore state after drawing footer
  }

  drawHeader(doc, yPos, poData) {
    // Company Logo (left side)
    try {
      if (fs.existsSync(this.logoPath)) {
        doc.image(this.logoPath, 40, yPos, { width: 60, height: 56 });
      } else {
        // Placeholder logo - red box with text
        doc.rect(40, yPos, 60, 60)
           .strokeColor('#E63946')
           .lineWidth(2)
           .stroke();
        
        doc.fontSize(8)
           .fillColor('#E63946')
           .font(this.boldFont)
           .text('GRATO', 48, yPos + 20)
           .text('ENGINEERING', 43, yPos + 32)
           .fillColor('#000000');
      }
    } catch (error) {
      console.log('Logo loading error:', error.message);
      // Draw placeholder
      doc.rect(40, yPos, 60, 60)
         .strokeColor('#E63946')
         .lineWidth(2)
         .stroke();
      
      doc.fontSize(8)
         .fillColor('#E63946')
         .font(this.boldFont)
         .text('GRATO', 48, yPos + 20)
         .text('ENGINEERING', 43, yPos + 32)
         .fillColor('#000000');
    }

    // Company name and address (left, under logo)
    doc.fontSize(11)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('GRATO ENGINEERING GLOBAL LTD', 110, yPos);

    doc.fontSize(9)
       .font(this.defaultFont)
       .text('Bonaberi', 110, yPos + 15)
       .text('Douala Cameroon', 110, yPos + 28);
  }

  drawAddressSection(doc, yPos, poData) {
    // Left column: Shipping address
    doc.fontSize(9)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Shipping address', 40, yPos);

    doc.font(this.defaultFont)
       .fontSize(9)
       .text('GRATO ENGINEERING GLOBAL LTD', 40, yPos + 15)
       .text('Bonaberi', 40, yPos + 28)
       .text('Douala', 40, yPos + 41)
       .text('Cameroon', 40, yPos + 54);

    doc.text('682952153', 40, yPos + 67);

    // Right column: Supplier information (dynamic based on PO data)
    const supplier = poData.supplierDetails || {};
    
    doc.font(this.defaultFont)
       .fontSize(9)
       .text(this.safeString(supplier.name, 'Supplier Name Not Available'), 320, yPos)
       .text(this.safeString(supplier.address, 'Address Not Available'), 320, yPos + 13)
       .text(this.safeString(supplier.email, 'Email Not Available'), 320, yPos + 26);

    if (supplier.phone) {
      doc.text(`${supplier.phone}`, 320, yPos + 39);
    }
    
    if (supplier.taxId || supplier.registrationNumber) {
      doc.fontSize(8)
         .text(`VAT: ${supplier.taxId || supplier.registrationNumber || 'N/A'}`, 320, yPos + 52);
    }
  }

  drawPOTitleBar(doc, yPos, poData) {
    // Purchase Order title - just colored text, no background bar
    doc.fillColor('#C5504B') 
       .fontSize(14)
       .font(this.boldFont)
       .text(`Purchase Order #${this.safeString(poData.poNumber, 'P00004')}`, 40, yPos);

    // Three-column info below title
    const detailsY = yPos + 25;
    
    // Buyer column
    doc.fillColor('#888888')
       .fontSize(8)
       .font(this.defaultFont)
       .text('Buyer:', 40, detailsY);
    
    doc.fillColor('#000000')
       .fontSize(9)
       .font(this.defaultFont)
       .text('GRATO ENGINEERING', 40, detailsY + 12);

    // Order Date column  
    doc.fillColor('#888888')
       .fontSize(8)
       .text('Order Date:', 220, detailsY);
    
    doc.fillColor('#000000')
       .fontSize(9)
       .text(this.formatDateExact(poData.creationDate), 220, detailsY + 12);

    // Expected Arrival column
    doc.fillColor('#888888')
       .fontSize(8)
       .text('Expected Arrival:', 400, detailsY);
    
    doc.fillColor('#000000')
       .fontSize(9)
       .text(this.formatDateExact(poData.expectedDeliveryDate), 400, detailsY + 12);
  }

  drawItemsTable(doc, yPos, poData, currentPage) {
    console.log('=== DRAWING ITEMS TABLE ===');
    console.log('Items data:', poData.items);
    
    const tableWidth = 515;
    const colX = {
      desc: 40,
      qty: 280,
      unitPrice: 325,
      disc: 400,
      taxes: 445,
      amount: 490
    };
    
    let currentY = yPos;
    const pageBottomLimit = 720; // Leave space for footer

    // Draw table header
    const drawTableHeader = (y) => {
      // Table header with gray background
      doc.fillColor('#F5F5F5')
         .rect(40, y, tableWidth, 20)
         .fill();

      doc.strokeColor('#CCCCCC')
         .lineWidth(0.5)
         .rect(40, y, tableWidth, 20)
         .stroke();

      doc.fillColor('#000000')
         .fontSize(9)
         .font(this.boldFont);

      // Column headers
      doc.text('Description', colX.desc + 5, y + 6);
      doc.text('Qty', colX.qty, y + 6);
      doc.text('Unit Price', colX.unitPrice, y + 6);
      doc.text('Disc.', colX.disc, y + 6);
      doc.text('Taxes', colX.taxes, y + 6);
      doc.text('Amount', colX.amount, y + 6);

      // Vertical lines for header
      [colX.qty, colX.unitPrice, colX.disc, colX.taxes, colX.amount].forEach(x => {
        doc.moveTo(x, y).lineTo(x, y + 20).stroke();
      });

      return y + 20;
    };

    currentY = drawTableHeader(currentY);

    // Determine tax rate
    let taxRate = 0;
    if (poData.taxApplicable) {
      taxRate = 0.1925; // 19.25%
      console.log('Tax is applicable, using 19.25%');
    }
    
    let grandTotal = 0;

    // Table rows
    const items = Array.isArray(poData.items) ? poData.items : [];
    console.log(`Processing ${items.length} items`);

    items.forEach((item, index) => {
      console.log(`=== Processing item ${index} ===`, item);
      
      const quantity = this.safeNumber(item.quantity, 0);
      const unitPrice = this.safeNumber(item.unitPrice, 0);
      const discount = this.safeNumber(item.discount, 0);
      
      // Calculate amounts
      const itemSubtotal = quantity * unitPrice;
      const discountAmount = itemSubtotal * (discount / 100);
      const afterDiscount = itemSubtotal - discountAmount;
      const taxAmount = afterDiscount * taxRate;
      const itemTotal = afterDiscount + taxAmount;
      
      console.log('Calculated:', { itemSubtotal, discountAmount, afterDiscount, taxAmount, itemTotal });
      
      grandTotal += itemTotal;
      
      // Get full description
      const description = this.safeString(item.description, 'No description');
      
      // Calculate dynamic row height based on description length
      const descWidth = 230; // Width available for description column
      doc.fontSize(8).font(this.defaultFont);
      const descHeight = doc.heightOfString(description, { width: descWidth, lineGap: 1 });
      const rowHeight = Math.max(25, descHeight + 12); // Minimum 25px, or description height + padding
      
      // Check if row will fit on current page
      if (currentY + rowHeight > pageBottomLimit) {
        // Add new page
        doc.addPage();
        currentPage++;
        currentY = 50;
        
        // Redraw header on new page
        currentY = drawTableHeader(currentY);
      }

      // Row border
      doc.strokeColor('#CCCCCC')
         .rect(40, currentY, tableWidth, rowHeight)
         .stroke();

      doc.fillColor('#000000')
         .fontSize(8)
         .font(this.defaultFont);

      // Description - full text with word wrap
      doc.text(description, colX.desc + 5, currentY + 6, {
        width: descWidth,
        align: 'left',
        lineGap: 1
      });
      
      // Other columns - vertically centered
      const textY = currentY + (rowHeight / 2) - 4;
      
      doc.text(quantity.toFixed(2), colX.qty, textY);
      doc.text(this.formatCurrency(unitPrice), colX.unitPrice, textY);
      doc.text(discount > 0 ? `${discount.toFixed(2)}%` : '0.00%', colX.disc, textY);
      doc.text(taxRate > 0 ? '19.25% G' : '0%', colX.taxes, textY);
      doc.text(`${this.formatCurrency(itemTotal)} FCFA`, colX.amount, textY);

      // Vertical lines for row
      [colX.qty, colX.unitPrice, colX.disc, colX.taxes, colX.amount].forEach(x => {
        doc.moveTo(x, currentY).lineTo(x, currentY + rowHeight).stroke();
      });

      currentY += rowHeight;
    });

    // If no items
    if (items.length === 0) {
      doc.fillColor('#F9F9F9')
         .rect(40, currentY, tableWidth, 22)
         .fill();

      doc.strokeColor('#CCCCCC')
         .rect(40, currentY, tableWidth, 22)
         .stroke();

      doc.fillColor('#666666')
         .text('No items found', colX.desc + 5, currentY + 6);
      
      currentY += 22;
    }

    // Check if summary will fit on current page
    if (currentY + 100 > pageBottomLimit) {
      doc.addPage();
      currentPage++;
      currentY = 50;
    }

    // Draw summary box
    this.drawOrderSummary(doc, currentY, grandTotal, taxRate);
    currentY += 90;

    return { yPos: currentY, currentPage };
  }

  // ============================================
  // QUOTATION PDF
  // ============================================
  async generateQuotationPDF(quoteData, outputPath) {
    return new Promise((resolve, reject) => {
      try {
        console.log('=== GENERATING QUOTATION PDF ===');
        console.log('Quote Number:', quoteData.quoteNumber);

        const doc = new PDFDocument({ 
          size: 'A4', 
          margins: this.pageMargins,
          bufferPages: true,
          info: {
            Title: `Quotation - ${quoteData.quoteNumber}`,
            Author: 'GRATO ENGINEERING GLOBAL LTD',
            Subject: 'Supplier Quotation',
            Creator: 'Quotation System'
          }
        });

        if (outputPath) {
          doc.pipe(fs.createWriteStream(outputPath));
        }

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          resolve({
            success: true,
            buffer: Buffer.concat(chunks),
            filename: `Quotation_${quoteData.quoteNumber}_${Date.now()}.pdf`
          });
        });

        this.generateQuotationContent(doc, quoteData);
        doc.end();
      } catch (error) {
        console.error('Quotation PDF error:', error);
        reject({ success: false, error: error.message });
      }
    });
  }

  generateQuotationContent(doc, data) {
    let yPos = 50;
    let currentPage = 1;

    // Header (same as PO)
    this.drawHeader(doc, yPos, data);
    yPos += 90;

    // Supplier Details (Left) & Company Details (Right) - SWAPPED
    this.drawQuotationAddressSection(doc, yPos, data);
    yPos += 90;

    // QUOTATION Title Bar
    this.drawQuotationTitleBar(doc, yPos, data);
    yPos += 50;

    // Items Table
    const tableResult = this.drawQuotationItemsTable(doc, yPos, data, currentPage);
    yPos = tableResult.yPos;
    currentPage = tableResult.currentPage;

    // Check page break
    if (yPos > 650) {
      doc.addPage();
      currentPage++;
      yPos = 50;
    }

    // Terms & Conditions
    this.drawQuotationTerms(doc, yPos, data);
    yPos += 80;

    // Check page break for signature
    if (yPos > 680) {
      doc.addPage();
      currentPage++;
      yPos = 50;
    }

    // Supplier Signature Section
    this.drawSupplierSignatureSection(doc, yPos, data);

    // Footer on all pages
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      this.drawFooter(doc, data, i + 1, range.count);
    }
  }

  drawQuotationAddressSection(doc, yPos, data) {
    // LEFT: Supplier Information (WHO IS PROVIDING THE QUOTE)
    const supplier = data.supplierDetails || {};
    
    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Supplier Information', 40, yPos);

    doc.font(this.defaultFont)
      .fontSize(9)
      .text(this.safeString(supplier.name, 'Supplier Name'), 40, yPos + 15)
      .text(this.safeString(supplier.address, 'Address'), 40, yPos + 28)
      .text(this.safeString(supplier.email, 'Email'), 40, yPos + 41)
      .text(this.safeString(supplier.phone, 'Phone'), 40, yPos + 54);

    // RIGHT: Billing To (GRATO ENGINEERING)
    doc.fontSize(9)
      .font(this.boldFont)
      .text('Quotation For:', 320, yPos);

    doc.font(this.defaultFont)
      .fontSize(9)
      .text('GRATO ENGINEERING GLOBAL LTD', 320, yPos + 15)
      .text('Bonaberi, Douala', 320, yPos + 28)
      .text('Cameroon', 320, yPos + 41)
      .text('682952153', 320, yPos + 54);
  }

  drawQuotationTitleBar(doc, yPos, data) {
    // QUOTATION title
    doc.fillColor('#C5504B')
      .fontSize(14)
      .font(this.boldFont)
      .text(`QUOTATION #${this.safeString(data.quoteNumber, 'QUO-000001')}`, 40, yPos);

    const detailsY = yPos + 25;
    
    // Supplier
    doc.fillColor('#888888')
      .fontSize(8)
      .font(this.defaultFont)
      .text('Supplier:', 40, detailsY);
    
    doc.fillColor('#000000')
      .fontSize(9)
      .text(this.safeString(data.supplierDetails?.name, 'N/A'), 40, detailsY + 12);

    // Submission Date
    doc.fillColor('#888888')
      .fontSize(8)
      .text('Submission Date:', 220, detailsY);
    
    doc.fillColor('#000000')
      .fontSize(9)
      .text(this.formatDateExact(data.submissionDate), 220, detailsY + 12);

    // Valid Until (PROMINENT)
    doc.fillColor('#f5222d')
      .fontSize(8)
      .font(this.boldFont)
      .text('Valid Until:', 400, detailsY);
    
    doc.fillColor('#f5222d')
      .fontSize(10)
      .font(this.boldFont)
      .text(this.formatDateExact(data.validUntil), 400, detailsY + 12);
  }

  drawQuotationItemsTable(doc, yPos, data, currentPage) {
    // Same structure as PO items table
    const tableWidth = 515;
    const colX = {
      desc: 40,
      qty: 280,
      unitPrice: 350,
      amount: 450
    };
    
    let currentY = yPos;
    const pageBottomLimit = 720;

    // Draw header
    const drawTableHeader = (y) => {
      doc.fillColor('#F5F5F5')
        .rect(40, y, tableWidth, 20)
        .fill();

      doc.strokeColor('#CCCCCC')
        .rect(40, y, tableWidth, 20)
        .stroke();

      doc.fillColor('#000000')
        .fontSize(9)
        .font(this.boldFont)
        .text('Description', colX.desc + 5, y + 6)
        .text('Qty', colX.qty, y + 6)
        .text('Unit Price', colX.unitPrice, y + 6)
        .text('Amount', colX.amount, y + 6);

      [colX.qty, colX.unitPrice, colX.amount].forEach(x => {
        doc.moveTo(x, y).lineTo(x, y + 20).stroke();
      });

      return y + 20;
    };

    currentY = drawTableHeader(currentY);

    // Tax rate
    const taxRate = data.taxApplicable ? 0.1925 : 0;
    let grandTotal = 0;

    // Items
    const items = Array.isArray(data.items) ? data.items : [];
    
    items.forEach((item, index) => {
      const quantity = this.safeNumber(item.quantity, 0);
      const unitPrice = this.safeNumber(item.unitPrice, 0);
      const itemSubtotal = quantity * unitPrice;
      const taxAmount = itemSubtotal * taxRate;
      const itemTotal = itemSubtotal + taxAmount;
      
      grandTotal += itemTotal;
      
      const description = this.safeString(item.description, 'No description');
      const descWidth = 230;
      doc.fontSize(8).font(this.defaultFont);
      const descHeight = doc.heightOfString(description, { width: descWidth });
      const rowHeight = Math.max(25, descHeight + 12);
      
      // Check page break
      if (currentY + rowHeight > pageBottomLimit) {
        doc.addPage();
        currentPage++;
        currentY = 50;
        currentY = drawTableHeader(currentY);
      }

      // Row
      doc.strokeColor('#CCCCCC')
        .rect(40, currentY, tableWidth, rowHeight)
        .stroke();

      doc.fillColor('#000000')
        .fontSize(8)
        .font(this.defaultFont)
        .text(description, colX.desc + 5, currentY + 6, {
          width: descWidth,
          align: 'left'
        });
      
      const textY = currentY + (rowHeight / 2) - 4;
      doc.text(quantity.toFixed(2), colX.qty, textY)
        .text(this.formatCurrency(unitPrice), colX.unitPrice, textY)
        .text(`${this.formatCurrency(itemTotal)} ${data.currency || 'XAF'}`, colX.amount, textY);

      [colX.qty, colX.unitPrice, colX.amount].forEach(x => {
        doc.moveTo(x, currentY).lineTo(x, currentY + rowHeight).stroke();
      });

      currentY += rowHeight;
    });

    // Summary
    if (currentY + 100 > pageBottomLimit) {
      doc.addPage();
      currentPage++;
      currentY = 50;
    }

    this.drawOrderSummary(doc, currentY, grandTotal, taxRate);
    currentY += 90;

    return { yPos: currentY, currentPage };
  }

  drawQuotationTerms(doc, yPos, data) {
    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Payment Terms:', 40, yPos);

    doc.font(this.defaultFont)
      .fontSize(8)
      .text(this.safeString(data.paymentTerms, 'Net 30 days'), 40, yPos + 15);

    doc.font(this.boldFont)
      .fontSize(9)
      .text('Delivery Terms:', 40, yPos + 35);

    doc.font(this.defaultFont)
      .fontSize(8)
      .text(this.safeString(data.deliveryTerms, 'Standard delivery'), 40, yPos + 50);

    if (data.deliveryTime) {
      doc.text(`Delivery Time: ${data.deliveryTime.value} ${data.deliveryTime.unit}`, 40, yPos + 65);
    }
  }

  drawSupplierSignatureSection(doc, yPos, data) {
    yPos += 20;
    
    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Supplier Authorization', 40, yPos);

    yPos += 25;
    
    // Single signature line for supplier
    doc.moveTo(40, yPos + 30)
      .lineTo(200, yPos + 30)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    doc.fontSize(7)
      .font(this.defaultFont)
      .fillColor('#666666')
      .text('Authorized Signature', 40, yPos + 35);
  }

  // ============================================
  // DEBIT NOTE PDF
  // ============================================
  async generateDebitNotePDF(debitNoteData, outputPath) {
    return new Promise((resolve, reject) => {
      try {
        console.log('=== GENERATING DEBIT NOTE PDF ===');
        console.log('Debit Note Number:', debitNoteData.debitNoteNumber);

        const doc = new PDFDocument({ 
          size: 'A4', 
          margins: this.pageMargins,
          bufferPages: true,
          info: {
            Title: `Debit Note - ${debitNoteData.debitNoteNumber}`,
            Author: 'GRATO ENGINEERING GLOBAL LTD',
            Subject: 'Debit Note',
            Creator: 'Debit Note System'
          }
        });

        if (outputPath) {
          doc.pipe(fs.createWriteStream(outputPath));
        }

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          resolve({
            success: true,
            buffer: Buffer.concat(chunks),
            filename: `Debit_Note_${debitNoteData.debitNoteNumber}_${Date.now()}.pdf`
          });
        });

        this.generateDebitNoteContent(doc, debitNoteData);
        doc.end();
      } catch (error) {
        console.error('Debit Note PDF error:', error);
        reject({ success: false, error: error.message });
      }
    });
  }

  generateDebitNoteContent(doc, data) {
    let yPos = 50;
    let currentPage = 1;

    // Header
    this.drawHeader(doc, yPos, data);
    yPos += 90;

    // Address Section (Company Left, Supplier Right)
    this.drawDebitNoteAddressSection(doc, yPos, data);
    yPos += 90;

    // DEBIT NOTE Title Bar
    this.drawDebitNoteTitleBar(doc, yPos, data);
    yPos += 60;

    // Reference to PO
    this.drawPOReference(doc, yPos, data);
    yPos += 50;

    // Debit Details Box
    this.drawDebitDetailsBox(doc, yPos, data);
    yPos += 100;

    // Check page break
    if (yPos > 650) {
      doc.addPage();
      currentPage++;
      yPos = 50;
    }

    // Approval Chain
    if (data.approvalChain && data.approvalChain.length > 0) {
      yPos = this.drawDebitNoteApprovalChain(doc, yPos, data, currentPage);
    }

    // Check page break for signature
    if (yPos > 680) {
      doc.addPage();
      currentPage++;
      yPos = 50;
    }

    // Supplier Acknowledgment Section
    this.drawSupplierAcknowledgmentSection(doc, yPos, data);

    // Footer
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      this.drawFooter(doc, data, i + 1, range.count);
    }
  }

  drawDebitNoteAddressSection(doc, yPos, data) {
    // LEFT: Company (Issuer)
    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Issued By:', 40, yPos);

    doc.font(this.defaultFont)
      .fontSize(9)
      .text('GRATO ENGINEERING GLOBAL LTD', 40, yPos + 15)
      .text('Bonaberi, Douala', 40, yPos + 28)
      .text('Cameroon', 40, yPos + 41)
      .text('682952153', 40, yPos + 54);

    // RIGHT: Supplier
    const supplier = data.supplierDetails || {};
    
    doc.fontSize(9)
      .font(this.boldFont)
      .text('Supplier:', 320, yPos);

    doc.font(this.defaultFont)
      .fontSize(9)
      .text(this.safeString(supplier.name, 'Supplier Name'), 320, yPos + 15)
      .text(this.safeString(supplier.address, 'Address'), 320, yPos + 28)
      .text(this.safeString(supplier.email, 'Email'), 320, yPos + 41);
  }

  drawDebitNoteTitleBar(doc, yPos, data) {
    // DEBIT NOTE title
    doc.fillColor('#f5222d')
      .fontSize(14)
      .font(this.boldFont)
      .text(`DEBIT NOTE #${this.safeString(data.debitNoteNumber, 'DN-000001')}`, 40, yPos);

    const detailsY = yPos + 25;
    
    // Status
    doc.fillColor('#888888')
      .fontSize(8)
      .font(this.defaultFont)
      .text('Status:', 40, detailsY);
    
    doc.fillColor('#000000')
      .fontSize(9)
      .font(this.boldFont)
      .text(this.formatStatus(data.status), 40, detailsY + 12);

    // Issue Date
    doc.fillColor('#888888')
      .fontSize(8)
      .text('Issue Date:', 220, detailsY);
    
    doc.fillColor('#000000')
      .fontSize(9)
      .text(this.formatDateExact(data.createdAt), 220, detailsY + 12);

    // Reason
    doc.fillColor('#888888')
      .fontSize(8)
      .text('Reason:', 400, detailsY);
    
    doc.fillColor('#f5222d')
      .fontSize(9)
      .font(this.boldFont)
      .text(this.formatReason(data.reason), 400, detailsY + 12);
  }

  drawPOReference(doc, yPos, data) {
    doc.fillColor('#fff7e6')
      .rect(40, yPos, 515, 35)
      .fill();

    doc.strokeColor('#faad14')
      .rect(40, yPos, 515, 35)
      .stroke();

    doc.fillColor('#000000')
      .fontSize(9)
      .font(this.boldFont)
      .text('Reference Purchase Order:', 50, yPos + 8);

    doc.font(this.defaultFont)
      .fontSize(10)
      .text(data.poNumber || 'N/A', 50, yPos + 20);
  }

  drawDebitDetailsBox(doc, yPos, data) {
    const boxHeight = 85;
    
    doc.rect(40, yPos, 515, boxHeight)
      .fillAndStroke('#fff2f0', '#f5222d');

    yPos += 12;

    // Description
    doc.fillColor('#000000')
      .fontSize(9)
      .font(this.boldFont)
      .text('Debit Description:', 50, yPos);

    doc.font(this.defaultFont)
      .fontSize(8)
      .text(this.safeString(data.description, 'N/A'), 50, yPos + 15, { width: 500 });

    yPos += 40;

    // Financial comparison
    doc.fontSize(8)
      .font(this.boldFont)
      .text('Original Amount:', 50, yPos);
    
    doc.text(`${data.currency || 'XAF'} ${this.formatCurrency(data.originalAmount)}`, 380, yPos, {
      width: 165,
      align: 'right'
    });

    yPos += 18;

    doc.fillColor('#f5222d')
      .fontSize(9)
      .font(this.boldFont)
      .text('Debit Amount:', 50, yPos);
    
    doc.text(`${data.currency || 'XAF'} ${this.formatCurrency(data.debitAmount)}`, 380, yPos, {
      width: 165,
      align: 'right'
    });
  }

  drawDebitNoteApprovalChain(doc, yPos, data, currentPage) {
    doc.fontSize(11)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Approval Chain', 40, yPos);
    
    yPos += 20;

    data.approvalChain.forEach((step, index) => {
      if (yPos > 680) {
        doc.addPage();
        currentPage++;
        yPos = 50;
      }

      if (index > 0) {
        doc.moveTo(55, yPos - 10).lineTo(55, yPos).strokeColor('#CCCCCC').stroke();
      }

      const statusColor = step.status === 'approved' ? '#52c41a' : 
                        step.status === 'rejected' ? '#f5222d' : '#d9d9d9';
      
      doc.circle(55, yPos + 6, 5).fillAndStroke(statusColor, statusColor);

      doc.fontSize(8)
        .font(this.boldFont)
        .fillColor('#000000')
        .text(`Level ${step.level}: ${step.approver.name}`, 75, yPos);

      doc.fontSize(7)
        .font(this.defaultFont)
        .fillColor('#666666')
        .text(step.approver.role, 75, yPos + 10);

      if (step.status === 'approved') {
        doc.fillColor('#52c41a')
          .fontSize(7)
          .text('✓ APPROVED', 75, yPos + 20);
        
        if (step.actionDate) {
          doc.fillColor('#666666')
            .text(this.formatDateExact(step.actionDate), 75, yPos + 30);
        }
        yPos += 45;
      } else if (step.status === 'rejected') {
        doc.fillColor('#f5222d')
          .fontSize(7)
          .text('✗ REJECTED', 75, yPos + 20);
        yPos += 35;
      } else {
        doc.fillColor('#999999')
          .fontSize(7)
          .text('Pending', 75, yPos + 20);
        yPos += 35;
      }
    });

    return yPos + 10;
  }

  drawSupplierAcknowledgmentSection(doc, yPos, data) {
    yPos += 20;
    
    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Supplier Acknowledgment', 40, yPos);

    yPos += 25;
    
    doc.moveTo(40, yPos + 30)
      .lineTo(200, yPos + 30)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    doc.fontSize(7)
      .font(this.defaultFont)
      .fillColor('#666666')
      .text('Authorized Signature & Date', 40, yPos + 35);
  }

  formatReason(reason) {
    const map = {
      'shortage': 'Shortage',
      'damaged_goods': 'Damaged Goods',
      'pricing_error': 'Pricing Error',
      'quality_issue': 'Quality Issue',
      'other': 'Other'
    };
    return map[reason] || reason;
  }

  // ✅ KEEP THIS - It's the correct class method
async generatePettyCashFormPDF(formData, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      console.log('=== STARTING PETTY CASH FORM PDF GENERATION ===');
      console.log('Form Number:', formData.displayId);
      console.log('Requisition:', formData.requisitionNumber);

      const doc = new PDFDocument({ 
        size: 'A4', 
        margins: this.pageMargins,
        bufferPages: true,
        info: {
          Title: `Petty Cash Form - ${formData.displayId}`,
          Author: 'GRATO ENGINEERING GLOBAL LTD',
          Subject: 'Project Cash Form',
          Creator: 'Purchase Requisition System'
        }
      });

      if (outputPath) {
        doc.pipe(fs.createWriteStream(outputPath));
      }

      doc.on('pageAdded', () => {
        const range = doc.bufferedPageRange();
        console.log('🧾 Page added (petty cash). Buffered pages:', range.count);
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        console.log('=== PETTY CASH FORM PDF GENERATION COMPLETED ===');
        resolve({
          success: true,
          buffer: pdfBuffer,
          filename: `Petty_Cash_Form_${formData.displayId}_${Date.now()}.pdf`
        });
      });

      const totalPages = this.generateCashRequestContent(doc, formData);
      const preTrim = doc.bufferedPageRange();
      console.log('🧾 Pre-trim buffered pages (petty cash):', preTrim);
      this.trimBufferedPages(doc, totalPages);
      const postTrim = doc.bufferedPageRange();
      console.log('🧾 Post-trim buffered pages (petty cash):', postTrim);
      doc.end();
    } catch (error) {
      console.error('Petty Cash Form PDF generation error:', error);
      reject({
        success: false,
        error: error.message
      });
    }
  });
}

  // ============================================
  // CASH REQUEST PDF (Employee Format)
  // ============================================
  async generateCashRequestPDF(requestData, outputPath) {
    return new Promise((resolve, reject) => {
      try {
        console.log('=== STARTING CASH REQUEST PDF GENERATION ===');
        console.log('Request ID:', requestData._id);
        console.log('Employee:', requestData.employee?.fullName);

        const doc = new PDFDocument({ 
          size: 'A4', 
          margins: this.pageMargins,
          bufferPages: true,
          info: {
            Title: `Cash Request - ${requestData.displayId || requestData._id}`,
            Author: 'GRATO ENGINEERING GLOBAL LTD',
            Subject: 'Cash Request Document',
            Creator: 'Cash Request System'
          }
        });

        if (outputPath) {
          doc.pipe(fs.createWriteStream(outputPath));
        }

        doc.on('pageAdded', () => {
          const range = doc.bufferedPageRange();
          const stack = new Error().stack.split('\n')[2];
          console.log(`🧾 Page added (cash request). Buffered pages: ${range.count} | Source: ${stack?.trim()}`);
        });

        doc.on('pageBreak', (intentional) => {
          const range = doc.bufferedPageRange();
          console.log(`🛑 PageBreak event (intentional: ${intentional}). Buffered pages: ${range.count}`);
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          console.log('=== CASH REQUEST PDF GENERATION COMPLETED ===');
          resolve({
            success: true,
            buffer: pdfBuffer,
            filename: `Cash_Request_${requestData.displayId || requestData._id.toString().slice(-6).toUpperCase()}_${Date.now()}.pdf`
          });
        });

        const totalPages = this.generateCashRequestContent(doc, requestData);
        const preTrim = doc.bufferedPageRange();
        console.log('🧾 Pre-trim buffered pages (cash request):', preTrim);
        this.trimBufferedPages(doc, totalPages);
        const postTrim = doc.bufferedPageRange();
        console.log('🧾 Post-trim buffered pages (cash request):', postTrim);
        doc.end();
      } catch (error) {
        console.error('Cash Request PDF generation error:', error);
        reject({
          success: false,
          error: error.message
        });
      }
    });
  }


  generateCashRequestContent(doc, data) {
  let yPos = 50;
  let currentPage = 1;
  const addPageAndReset = (reason) => {
    doc.addPage();
    currentPage++;
    yPos = 50;
    console.log(`🧾 Manual page break: ${reason}. Now on page ${currentPage}`);
  };

  console.log('=== STARTING CASH REQUEST PDF GENERATION ===');
  console.log('Form Number:', data.displayId);
  console.log('Employee:', data.employee?.fullName);
  console.log('Has Items:', data.items?.length || 0);
  console.log('Has Disbursements:', data.disbursements?.length || 0);

  // Determine if this is petty cash (has items) or cash request (no items)
  const isPettyCash = data.items && data.items.length > 0;
  console.log('Is Petty Cash:', isPettyCash);

  // Header with logo and company info
  this.drawCashRequestHeader(doc, yPos, data);
  yPos += 90;

  // Request title bar
  this.drawCashRequestTitleBar(doc, yPos, data);
  yPos += 60;

  if (isPettyCash) {
    // Employee and Request Details (Basic Info Only)
    yPos = this.drawCashRequestBasicDetails(doc, yPos, data);

    // Check page break before items table
    if (yPos > 650) {
      addPageAndReset('before items table');
    }

    // ✅ FIXED: Items Table - ONLY if items exist (Petty Cash)
    const tableResult = this.drawPettyCashItemsTable(doc, yPos, data, currentPage);
    yPos = tableResult.yPos;
    currentPage = tableResult.currentPage;

    // Check page break before purpose
    if (yPos > 650) {
      addPageAndReset('before purpose');
    }

    // Purpose and Justification
    yPos = this.drawPettyCashPurpose(doc, yPos, data);

    // Check page break before approval chain
    if (yPos > 600) {
      addPageAndReset('before approval chain');
    }

    // Approval Chain Timeline
    yPos = this.drawApprovalChainTimeline(doc, yPos, data);

    // ✅ NEW: Disbursement History (if multiple disbursements exist)
    if (data.disbursements && data.disbursements.length > 0) {
      // Check page break before disbursement history
      if (yPos > 600) {
        addPageAndReset('before disbursement history');
      }
      
      yPos = this.drawDisbursementHistory(doc, yPos, data);
    }

    // Check page break before financial summary
    if (yPos > 650) {
      addPageAndReset('before financial summary');
    }

    // Financial Summary
    yPos = this.drawCashRequestFinancialSummary(doc, yPos, data);

    // Check page break before signature
    if (yPos > 680) {
      addPageAndReset('before signature');
    }

    // ✅ UPDATED: Buyer Acknowledgment Signature
    this.drawBuyerAcknowledgmentSignature(doc, yPos, data);
  } else {
    // Cash Request layout
    yPos = this.drawCashRequestRequesterDetails(doc, yPos, data);

    if (yPos > 650) {
      addPageAndReset('before purpose');
    }

    yPos = this.drawCashRequestPurpose(doc, yPos, data);

    if (yPos > 650) {
      addPageAndReset('before itemized breakdown');
    }

    const itemizedResult = this.drawCashRequestItemizedBreakdown(doc, yPos, data, currentPage);
    yPos = itemizedResult.yPos;
    currentPage = itemizedResult.currentPage;

    if (yPos > 650) {
      addPageAndReset('before approver signatures');
    }

    yPos = this.drawApproverSignatures(doc, yPos, data);

    if (yPos > 650) {
      addPageAndReset('before total disbursed');
    }

    yPos = this.drawTotalDisbursedSummary(doc, yPos, data);

    if (yPos > 680) {
      addPageAndReset('before requester signature');
    }

    this.drawRequesterAcknowledgmentSignature(doc, yPos, data);
  }

  // ✅ FIXED: Footer ONLY on the LAST page
  const range = doc.bufferedPageRange();
  console.log('📄 Drawing footer on last page only. Total pages:', range.count);
  console.log('📄 Current Y position before footer:', doc.y);
  console.log('📄 Page height:', doc.page.height);
  console.log('📄 Bottom margin:', this.pageMargins.bottom);

  try {
    // Stay on current page (which is the last page)
    const beforeFooterPages = doc.bufferedPageRange().count;
    console.log(`🔍 Pages before footer: ${beforeFooterPages}`);
    
    this.drawCashRequestFooter(doc, data, range.count, range.count);
    
    const afterFooterPages = doc.bufferedPageRange().count;
    console.log(`🔍 Pages after footer: ${afterFooterPages}`);
    console.log(`✅ Footer drawn on final page (${range.count})`);
  } catch (error) {
    console.error(`❌ Error drawing footer:`, error.message);
  }
  
  console.log('=== CASH REQUEST PDF CONTENT GENERATION COMPLETE ===');
  return currentPage;
}

  trimBufferedPages(doc, keepPages) {
    if (!doc || !doc.bufferedPageRange) return;

    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    if (!keepPages || keepPages >= totalPages) return;

    try {
      const pages = doc._root?.data?.Pages?.data;
      if (!pages || !Array.isArray(pages.Kids)) return;

      // Trim buffered pages and page tree to keep only the content pages
      doc._pageBuffer = doc._pageBuffer.slice(0, keepPages);
      pages.Kids = pages.Kids.slice(0, keepPages);
      pages.Count = pages.Kids.length;
    } catch (error) {
      console.error('Error trimming buffered pages:', error);
    }
  }

  drawPettyCashItemsTable(doc, yPos, data, currentPage) {
  console.log('=== DRAWING ITEMS TABLE ===');
  console.log('Items data:', data.items);
  
  // Section header
  doc.fontSize(11)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Requested Items', 40, yPos);
  
  yPos += 20;

  const tableWidth = 515;
  const colX = {
    no: 40,
    desc: 70,
    qty: 350,
    unit: 420,
    price: 485
  };
  
  let currentY = yPos;
  const pageBottomLimit = 720;

  // Draw table header
  const drawTableHeader = (y) => {
    // Table header with gray background
    doc.fillColor('#F5F5F5')
       .rect(40, y, tableWidth, 20)
       .fill();

    doc.strokeColor('#CCCCCC')
       .lineWidth(0.5)
       .rect(40, y, tableWidth, 20)
       .stroke();

    doc.fillColor('#000000')
       .fontSize(9)
       .font(this.boldFont);

    // Column headers
    doc.text('#', colX.no + 5, y + 6);
    doc.text('Description', colX.desc + 5, y + 6);
    doc.text('Quantity', colX.qty, y + 6);
    doc.text('Unit', colX.unit, y + 6);
    doc.text('Est. Price', colX.price, y + 6);

    // Vertical lines for header
    [colX.desc, colX.qty, colX.unit, colX.price].forEach(x => {
      doc.moveTo(x, y).lineTo(x, y + 20).stroke();
    });

    return y + 20;
  };

  currentY = drawTableHeader(currentY);

  // Table rows
  const items = Array.isArray(data.items) ? data.items : [];
  console.log(`Processing ${items.length} items`);

  if (items.length === 0) {
    // No items row
    doc.fillColor('#F9F9F9')
       .rect(40, currentY, tableWidth, 25)
       .fill();

    doc.strokeColor('#CCCCCC')
       .rect(40, currentY, tableWidth, 25)
       .stroke();

    doc.fillColor('#666666')
       .fontSize(8)
       .font(this.defaultFont)
       .text('No items found', colX.desc + 5, currentY + 8);
    
    currentY += 25;
  } else {
    items.forEach((item, index) => {
      console.log(`Processing item ${index + 1}:`, item);
      
      const description = this.safeString(item.description, 'No description');
      const quantity = this.safeNumber(item.quantity, 0);
      const unit = this.safeString(item.unit || item.measuringUnit, 'pcs');
      const estimatedPrice = this.safeNumber(item.estimatedPrice, 0);
      
      // Calculate dynamic row height based on description
      const descWidth = 270;
      doc.fontSize(8).font(this.defaultFont);
      const descHeight = doc.heightOfString(description, { width: descWidth, lineGap: 1 });
      const rowHeight = Math.max(25, descHeight + 12);
      
      // Check if row will fit on current page
      if (currentY + rowHeight > pageBottomLimit) {
        doc.addPage();
        currentPage++;
        currentY = 50;
        
        // Redraw section header
        doc.fontSize(11)
           .font(this.boldFont)
           .fillColor('#000000')
           .text('Requested Items (continued)', 40, currentY);
        currentY += 20;
        
        // Redraw table header
        currentY = drawTableHeader(currentY);
      }

      // Row border
      doc.strokeColor('#CCCCCC')
         .rect(40, currentY, tableWidth, rowHeight)
         .stroke();

      doc.fillColor('#000000')
         .fontSize(8)
         .font(this.defaultFont);

      // Item number
      const textY = currentY + (rowHeight / 2) - 4;
      doc.text(`${index + 1}`, colX.no + 5, textY);

      // Description - with word wrap
      doc.text(description, colX.desc + 5, currentY + 6, {
        width: descWidth,
        align: 'left',
        lineGap: 1
      });
      
      // Other columns - vertically centered
      doc.text(quantity.toFixed(2), colX.qty, textY);
      doc.text(unit, colX.unit, textY);
      doc.text(estimatedPrice > 0 ? this.formatCurrency(estimatedPrice) : 'TBD', colX.price, textY);

      // Vertical lines for row
      [colX.desc, colX.qty, colX.unit, colX.price].forEach(x => {
        doc.moveTo(x, currentY).lineTo(x, currentY + rowHeight).stroke();
      });

      currentY += rowHeight;
    });
  }

  currentY += 15;

  return { yPos: currentY, currentPage };
}

// ✅ NEW: Purpose Section (Separate from Basic Details)
drawPettyCashPurpose(doc, yPos, data) {
  yPos += 5;
  
  // Purpose
  doc.fontSize(11)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Purpose', 40, yPos);
  
  yPos += 15;

  const purposeText = this.safeString(data.purpose || data.title, 'N/A');
  doc.fontSize(9)
     .font(this.defaultFont)
     .fillColor('#333333')
     .text(purposeText, 40, yPos, {
       width: 515,
       height: 60,
       align: 'justify',
       lineGap: 3,
       ellipsis: true
     });

  const purposeHeight = doc.heightOfString(purposeText, { width: 515 });
  yPos += Math.min(purposeHeight, 60) + 15;

  // Business Justification
  doc.fontSize(11)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Business Justification', 40, yPos);
  
  yPos += 15;

  const justificationText = this.safeString(
    data.businessJustification || data.justification,
    'Standard business expense'
  );
  
  doc.fontSize(9)
     .font(this.defaultFont)
     .fillColor('#333333')
     .text(justificationText, 40, yPos, {
       width: 515,
       height: 70,
       align: 'justify',
       lineGap: 3,
       ellipsis: true
     });

  const justificationHeight = doc.heightOfString(justificationText, { width: 515 });
  yPos += Math.min(justificationHeight, 70) + 20;

  return yPos;
}

// ✅ NEW: Get acknowledgment info from latest acknowledged disbursement
getAcknowledgmentInfo(data) {
  const disbursements = Array.isArray(data?.disbursements) ? data.disbursements : [];
  const acknowledged = disbursements.filter(d => d?.acknowledged);

  if (acknowledged.length === 0) return null;

  const latest = acknowledged.sort((a, b) => {
    const aDate = new Date(a.acknowledgmentDate || a.date || 0).getTime();
    const bDate = new Date(b.acknowledgmentDate || b.date || 0).getTime();
    return bDate - aDate;
  })[0];

  const acknowledgedBy = latest?.acknowledgedBy;
  let name = '';

  if (acknowledgedBy) {
    if (typeof acknowledgedBy === 'string') {
      name = acknowledgedBy;
    } else {
      name = acknowledgedBy.fullName || acknowledgedBy.name || acknowledgedBy.email || '';
    }
  }

  const fallbackName = data?.employee?.fullName || data?.employee?.name || '';
  const isObjectIdLike = typeof name === 'string' && /^[0-9a-fA-F]{24}$/.test(name);

  const signatureData = acknowledgedBy?.signature || data?.employee?.signature || null;
  const signatureLocalPath = signatureData?.localPath || null;
  const signatureUrl = signatureData?.url || null;

  return {
    name: name && !isObjectIdLike ? name : fallbackName,
    date: latest?.acknowledgmentDate || latest?.date || null,
    notes: latest?.acknowledgmentNotes || '',
    signatureLocalPath,
    signatureUrl
  };
}

// ✅ NEW: Requester Acknowledgment Signature (for Cash Requests without items)
// drawRequesterAcknowledgmentSignature(doc, yPos, data) {
//   yPos += 20;
  
//   // Section title
//   doc.fontSize(11)
//      .font(this.boldFont)
//      .fillColor('#000000')
//      .text('Requester Acknowledgment', 40, yPos);
  
//   yPos += 25;

//   // Signature box with light blue background
//   const boxHeight = 100;
//   doc.rect(40, yPos, 515, boxHeight)
//      .fillAndStroke('#F0F8FF', '#1890FF');

//   yPos += 15;

//   const acknowledgment = this.getAcknowledgmentInfo(data);
//   const ackName = acknowledgment?.name || '';
//   const ackDate = acknowledgment?.date ? this.formatDateExact(acknowledgment.date) : '';
//   const signaturePath = acknowledgment?.signatureLocalPath;

//   // Instruction text
//   doc.fontSize(8)
//      .font(this.defaultFont)
//      .fillColor('#333333')
//      .text(
//        'I hereby acknowledge receipt of the cash amount specified above for the stated purpose and will provide proper justification with receipts.',
//        50, yPos, {
//          width: 495,
//          align: 'justify'
//        }
//      );

//   yPos += 30;

//     // Centered requester signature
//   const centerX = 180;
//   const lineWidth = 200;
//     const signatureDate = ackDate || '_______________________';

//     // Render signature image if available
//     if (signaturePath && fs.existsSync(signaturePath)) {
//       try {
//         doc.image(signaturePath, centerX + 10, yPos - 28, { width: 160, height: 36, fit: [160, 36] });
//       } catch (error) {
//         console.error('Signature image render error:', error.message);
//       }
//     }

//   // Requester Acknowledgment
//   doc.moveTo(centerX, yPos)
//      .lineTo(centerX + lineWidth, yPos)
//      .strokeColor('#000000')
//      .lineWidth(0.5)
//      .stroke();

//   doc.fontSize(8)
//      .font(this.boldFont)
//      .fillColor('#000000')
//      .text('Requester Signature', centerX, yPos + 5);

//                 doc.fontSize(7)
//                   .font(this.defaultFont)
//                   .fillColor('#000000')
//                   .text(signatureDate, centerX + 90, yPos - 16);
// }


drawRequesterAcknowledgmentSignature(doc, yPos, data) {
  yPos += 20;

  doc.fontSize(11)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Requester Acknowledgment', 40, yPos);

  yPos += 25;

  const boxHeight = 100;
  doc.rect(40, yPos, 515, boxHeight)
     .fillAndStroke('#F0F8FF', '#1890FF');

  yPos += 15;

  const acknowledgment  = this.getAcknowledgmentInfo(data);
  const ackDate         = acknowledgment?.date ? this.formatDateExact(acknowledgment.date) : '';
  const signatureDate   = ackDate || '_______________________';

  doc.fontSize(8)
     .font(this.defaultFont)
     .fillColor('#333333')
     .text(
       'I hereby acknowledge receipt of the cash amount specified above for the stated purpose and will provide proper justification with receipts.',
       50, yPos, { width: 495, align: 'justify' }
     );

  yPos += 30;

  const centerX   = 180;
  const lineWidth = 200;

  // ✅ PATCHED: use resolveSignaturePath instead of fs.existsSync
  const resolvedSigPath = resolveSignaturePath(acknowledgment?.signatureLocalPath);
  if (resolvedSigPath) {
    try {
      doc.image(resolvedSigPath, centerX + 10, yPos - 28, {
        width: 160,
        height: 36,
        fit: [160, 36]
      });
    } catch (error) {
      console.error('Signature image render error:', error.message);
    }
  }

  // Signature line
  doc.moveTo(centerX, yPos)
     .lineTo(centerX + lineWidth, yPos)
     .strokeColor('#000000')
     .lineWidth(0.5)
     .stroke();

  doc.fontSize(8)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Requester Signature', centerX, yPos + 5);

  doc.fontSize(7)
     .font(this.defaultFont)
     .fillColor('#000000')
     .text(signatureDate, centerX + 90, yPos - 16);
}

// ✅ NEW: Single Buyer Acknowledgment Signature Section
// drawBuyerAcknowledgmentSignature(doc, yPos, data) {
//   yPos += 20;
  
//   // Section title
//   doc.fontSize(11)
//      .font(this.boldFont)
//      .fillColor('#000000')
//      .text('Buyer Acknowledgment', 40, yPos);
  
//   yPos += 25;

//   // Signature box with light blue background
//   const boxHeight = 100;
//   doc.rect(40, yPos, 515, boxHeight)
//      .fillAndStroke('#F0F8FF', '#1890FF');

//   yPos += 15;

//   const acknowledgment = this.getAcknowledgmentInfo(data);
//   const ackName = acknowledgment?.name || '';
//   const ackDate = acknowledgment?.date ? this.formatDateExact(acknowledgment.date) : '';
//   const signaturePath = acknowledgment?.signatureLocalPath;

//   // Instruction text
//   doc.fontSize(8)
//      .font(this.defaultFont)
//      .fillColor('#333333')
//      .text(
//        'I hereby acknowledge receipt of the cash amount specified above for the stated purpose.',
//        50, yPos, {
//          width: 495,
//          align: 'justify'
//        }
//      );

//   yPos += 30;

//     // Centered buyer signature
//   const centerX = 180;
//   const lineWidth = 200;
//     const signatureDate = ackDate || '_______________________';

//     // Render signature image if available
//     if (signaturePath && fs.existsSync(signaturePath)) {
//       try {
//         doc.image(signaturePath, centerX + 10, yPos - 28, { width: 160, height: 36, fit: [160, 36] });
//       } catch (error) {
//         console.error('Signature image render error:', error.message);
//       }
//     }

//   // Buyer Acknowledgment
//   doc.moveTo(centerX, yPos)
//      .lineTo(centerX + lineWidth, yPos)
//      .strokeColor('#000000')
//      .lineWidth(0.5)
//      .stroke();

//   doc.fontSize(8)
//      .font(this.boldFont)
//      .fillColor('#000000')
//      .text('Buyer Signature', centerX, yPos + 5);

//                 doc.fontSize(7)
//                   .font(this.defaultFont)
//                   .fillColor('#000000')
//                   .text(signatureDate, centerX + 90, yPos - 16);
// }


drawBuyerAcknowledgmentSignature(doc, yPos, data) {
  yPos += 20;

  doc.fontSize(11)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Buyer Acknowledgment', 40, yPos);

  yPos += 25;

  const boxHeight = 100;
  doc.rect(40, yPos, 515, boxHeight)
     .fillAndStroke('#F0F8FF', '#1890FF');

  yPos += 15;

  const acknowledgment  = this.getAcknowledgmentInfo(data);
  const ackDate         = acknowledgment?.date ? this.formatDateExact(acknowledgment.date) : '';
  const signatureDate   = ackDate || '_______________________';

  doc.fontSize(8)
     .font(this.defaultFont)
     .fillColor('#333333')
     .text(
       'I hereby acknowledge receipt of the cash amount specified above for the stated purpose.',
       50, yPos, { width: 495, align: 'justify' }
     );

  yPos += 30;

  const centerX   = 180;
  const lineWidth = 200;

  // ✅ PATCHED: use resolveSignaturePath instead of fs.existsSync
  const resolvedSigPath = resolveSignaturePath(acknowledgment?.signatureLocalPath);
  if (resolvedSigPath) {
    try {
      doc.image(resolvedSigPath, centerX + 10, yPos - 28, {
        width: 160,
        height: 36,
        fit: [160, 36]
      });
    } catch (error) {
      console.error('Signature image render error:', error.message);
    }
  }

  // Signature line
  doc.moveTo(centerX, yPos)
     .lineTo(centerX + lineWidth, yPos)
     .strokeColor('#000000')
     .lineWidth(0.5)
     .stroke();

  doc.fontSize(8)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Buyer Signature', centerX, yPos + 5);

  doc.fontSize(7)
     .font(this.defaultFont)
     .fillColor('#000000')
     .text(signatureDate, centerX + 90, yPos - 16);
}




  // ✅ NEW: Requester Details (Cash Request)
  drawCashRequestRequesterDetails(doc, yPos, data) {
    yPos += 10;

    const boxHeight = 40;
    doc.rect(40, yPos, 515, boxHeight)
      .strokeColor('#CCCCCC')
      .lineWidth(0.5)
      .stroke();

    yPos += 12;

    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#000000')
      .text(`Requester: ${this.safeString(data.employee?.fullName, 'N/A')}`, 50, yPos + 6);

    return yPos + boxHeight + 10;
  }

  // ✅ NEW: Purpose (Cash Request only)
  drawCashRequestPurpose(doc, yPos, data) {
    yPos += 5;

    doc.fontSize(11)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Purpose', 40, yPos);

    yPos += 15;

    const purposeText = this.safeString(data.purpose || data.title, 'N/A');
    doc.fontSize(9)
      .font(this.defaultFont)
      .fillColor('#333333')
      .text(purposeText, 40, yPos, {
        width: 515,
        height: 70,
        align: 'justify',
        lineGap: 3,
        ellipsis: true
      });

    const purposeHeight = doc.heightOfString(purposeText, { width: 515 });
    yPos += Math.min(purposeHeight, 70) + 15;

    return yPos;
  }

  // ✅ NEW: Itemized Breakdown (Cash Request)
  drawCashRequestItemizedBreakdown(doc, yPos, data, currentPage) {
    yPos += 5;

    doc.fontSize(11)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Itemized Breakdown', 40, yPos);

    yPos += 20;

    const items = Array.isArray(data.itemizedBreakdown) ? data.itemizedBreakdown : [];

    // Table header
    doc.rect(40, yPos, 515, 18)
      .fillAndStroke('#F5F5F5', '#CCCCCC');

    doc.fontSize(8)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('#', 50, yPos + 5)
      .text('Description', 80, yPos + 5)
      .text('Category', 280, yPos + 5)
      .text('Amount', 470, yPos + 5);

    yPos += 18;

    if (items.length === 0) {
      doc.rect(40, yPos, 515, 20)
        .stroke('#CCCCCC');

      doc.fontSize(8)
        .font(this.defaultFont)
        .fillColor('#666666')
        .text('No itemized breakdown provided', 50, yPos + 6);

      yPos += 30;
      return { yPos, currentPage };
    }

    items.forEach((item, index) => {
      if (yPos > 720) {
        doc.addPage();
        currentPage++;
        yPos = 50;

        doc.fontSize(11)
          .font(this.boldFont)
          .fillColor('#000000')
          .text('Itemized Breakdown (continued)', 40, yPos);
        yPos += 20;

        doc.rect(40, yPos, 515, 18)
          .fillAndStroke('#F5F5F5', '#CCCCCC');

        doc.fontSize(8)
          .font(this.boldFont)
          .fillColor('#000000')
          .text('#', 50, yPos + 5)
          .text('Description', 80, yPos + 5)
          .text('Category', 280, yPos + 5)
          .text('Amount', 470, yPos + 5);

        yPos += 18;
      }

      if (index % 2 === 0) {
        doc.rect(40, yPos, 515, 20)
          .fillAndStroke('#FAFAFA', '#CCCCCC');
      } else {
        doc.rect(40, yPos, 515, 20)
          .stroke('#CCCCCC');
      }

      doc.fontSize(8)
        .font(this.defaultFont)
        .fillColor('#000000')
        .text(`${index + 1}`, 50, yPos + 6)
        .text(this.safeString(item.description, 'N/A').substring(0, 40), 80, yPos + 6)
        .text(this.safeString(item.category, 'N/A').substring(0, 20), 280, yPos + 6)
        .text(`XAF ${this.formatCurrency(item.amount || 0)}`, 450, yPos + 6, { width: 90, align: 'right' });

      yPos += 20;
    });

    yPos += 10;
    return { yPos, currentPage };
  }

  drawApproverSignatures(doc, yPos, data) {
  yPos += 5;

  doc.fontSize(11)
    .font(this.boldFont)
    .fillColor('#000000')
    .text('Approver Signatures', 40, yPos);

  yPos += 25;

  const steps = Array.isArray(data.approvalChain) ? data.approvalChain : [];

  const findStep = (predicate) => steps.find(predicate);

  const hobStep = findStep(step => {
    const role = (step.approver?.role || '').toLowerCase();
    const email = (step.approver?.email || '').toLowerCase();
    return role.includes('head of business') || email === 'kelvin.eyong@gratoglobal.com';
  });

  const financeStep = findStep(step => {
    const role = (step.approver?.role || '').toLowerCase();
    return role.includes('finance');
  });

  const signatureBlocks = [
    { label: 'Head of Business', step: hobStep },
    { label: 'Finance',          step: financeStep }
  ];

  const startX    = 40;
  const colWidth  = 170;
  const lineWidth = 140;
  const lineY     = yPos + 30;

  signatureBlocks.forEach((block, index) => {
    const x             = startX + (index * colWidth);
    const signatureDate = block.step?.actionDate
      ? this.formatDateExact(block.step.actionDate)
      : '';

    // ✅ PATCHED: use resolveSignaturePath instead of fs.existsSync
    const resolvedSigPath = resolveSignaturePath(block.step?.decidedBy?.signature);
    if (resolvedSigPath) {
      try {
        doc.image(resolvedSigPath, x + 10, lineY - 24, {
          width: 110,
          height: 36,
          fit: [110, 36]
        });
      } catch (error) {
        console.error('Approver signature render error:', error.message);
      }
    }

    // Signature line
    doc.moveTo(x + 10, lineY)
      .lineTo(x + 10 + lineWidth, lineY)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke();

    // Date inline with signature
    if (signatureDate) {
      doc.fontSize(7)
        .font(this.defaultFont)
        .fillColor('#000000')
        .text(signatureDate, x + 85, lineY - 14);
    }

    // Label under line
    doc.fontSize(8)
      .font(this.boldFont)
      .fillColor('#000000')
      .text(block.label, x + 10, lineY + 6);
  });

  return lineY + 30;
}


  // ✅ NEW: Total Disbursed Summary (Cash Request)
  drawTotalDisbursedSummary(doc, yPos, data) {
    yPos += 5;

    doc.fontSize(11)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Total Disbursed', 40, yPos);

    yPos += 18;

    const boxHeight = 30;
    doc.rect(40, yPos, 515, boxHeight)
      .fillAndStroke('#F5F5F5', '#CCCCCC');

    doc.fontSize(9)
      .font(this.boldFont)
      .fillColor('#1890ff')
      .text(`XAF ${this.formatCurrency(data.totalDisbursed || 0)}`, 40, yPos + 8, {
        width: 515,
        align: 'center'
      });

    return yPos + boxHeight + 10;
  }


  // ✅ NEW: Basic Details (Employee Info Only)
  drawCashRequestBasicDetails(doc, yPos, data) {
    yPos += 10;
    
    // Section header
    doc.fontSize(11)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Employee Details', 40, yPos);
    
    yPos += 20;

    // Compact details box
    const boxHeight = 80;
    
    doc.rect(40, yPos, 515, boxHeight)
      .strokeColor('#CCCCCC')
      .lineWidth(0.5)
      .stroke();

    yPos += 12;

    // Left Column - Employee Info
    doc.fontSize(8)
      .font(this.boldFont)
      .fillColor('#000000')
      .text('Employee Name:', 50, yPos);
    
    doc.font(this.defaultFont)
      .fontSize(9)
      .text(data.employee?.fullName || 'N/A', 50, yPos + 12);
    
    doc.fontSize(8)
      .fillColor('#666666')
      .text(`Department: ${data.employee?.department || 'N/A'}`, 50, yPos + 25);

    doc.text(`Email: ${data.employee?.email || 'N/A'}`, 50, yPos + 38);

    // Right Column - Request Info
    doc.fillColor('#000000')
      .fontSize(8)
      .font(this.boldFont)
      .text('Request Type:', 300, yPos);
    
    doc.font(this.defaultFont)
      .fontSize(9)
      .text('Petty Cash', 300, yPos + 12);

    doc.font(this.boldFont)
      .fontSize(8)
      .text('Urgency:', 300, yPos + 25);
    
    doc.font(this.defaultFont)
      .fontSize(9)
      .text(this.formatUrgency(data.urgency), 300, yPos + 37);

    yPos += boxHeight + 15;

    return yPos;
  }

  drawCashRequestHeader(doc, yPos, data) {
    // Company Logo
    try {
      if (fs.existsSync(this.logoPath)) {
        doc.image(this.logoPath, 40, yPos, { width: 60, height: 56 });
      } else {
        doc.rect(40, yPos, 60, 60)
           .strokeColor('#E63946')
           .lineWidth(2)
           .stroke();
        
        doc.fontSize(8)
           .fillColor('#E63946')
           .font(this.boldFont)
           .text('GRATO', 48, yPos + 20)
           .text('ENGINEERING', 43, yPos + 32)
           .fillColor('#000000');
      }
    } catch (error) {
      console.log('Logo loading error:', error.message);
      doc.rect(40, yPos, 60, 60)
         .strokeColor('#E63946')
         .lineWidth(2)
         .stroke();
    }

    // Company name and address
    doc.fontSize(11)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('GRATO ENGINEERING GLOBAL LTD', 110, yPos);

    doc.fontSize(9)
       .font(this.defaultFont)
       .text('Bonaberi', 110, yPos + 15)
       .text('Douala Cameroon', 110, yPos + 28)
       .text('682952153', 110, yPos + 41);
  }

  drawCashRequestTitleBar(doc, yPos, data) {
  // Title
  doc.fillColor('#C5504B') 
     .fontSize(14)
     .font(this.boldFont)
     .text(`CASH REQUEST #${data.displayId || data._id.toString().slice(-6).toUpperCase()}`, 40, yPos);

  const detailsY = yPos + 25;
  
  // Three columns
  doc.fillColor('#888888')
     .fontSize(8)
     .font(this.defaultFont)
     .text('Status:', 40, detailsY);
  
  doc.fillColor('#000000')
     .fontSize(9)
     .font(this.boldFont)
     .text(this.formatStatus(data.status), 40, detailsY + 12);

  doc.fillColor('#888888')
     .fontSize(8)
     .text('Request Date:', 220, detailsY);
  
  doc.fillColor('#000000')
     .fontSize(9)
     .text(this.formatDateExact(data.createdAt), 220, detailsY + 12);

  // ✅ FIXED: Show disbursement status properly
  doc.fillColor('#888888')
     .fontSize(8);
  
  if (data.disbursements && data.disbursements.length > 0) {
    // Show latest disbursement date
    const latestDisbursement = data.disbursements[data.disbursements.length - 1];
    
    if (data.disbursements.length === 1) {
      doc.text('Disbursed On:', 400, detailsY);
    } else {
      doc.text('Latest Payment:', 400, detailsY);
    }
    
    doc.fillColor('#000000')
       .fontSize(9)
       .text(this.formatDateExact(latestDisbursement.date), 400, detailsY + 12);
  } else if (data.disbursementDetails?.date) {
    // Fallback to old single disbursement field
    doc.text('Disbursed On:', 400, detailsY);
    
    doc.fillColor('#000000')
       .fontSize(9)
       .text(this.formatDateExact(data.disbursementDetails.date), 400, detailsY + 12);
  } else {
    // Not yet disbursed
    doc.text('Disbursement:', 400, detailsY);
    
    doc.fillColor('#faad14')
       .fontSize(9)
       .text('Pending', 400, detailsY + 12);
  }
}

  drawCashRequestDetails(doc, yPos, data) {
    yPos += 10;
    
    // Section header
    doc.fontSize(11)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Request Details', 40, yPos);
    
    yPos += 20;

    // Compact details box
    const boxStartY = yPos;
    const boxHeight = 100;
    
    doc.rect(40, yPos, 515, boxHeight)
       .strokeColor('#CCCCCC')
       .lineWidth(0.5)
       .stroke();

    yPos += 10;

    // Left Column - Employee Info
    doc.fontSize(8)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Requested By:', 50, yPos);
    
    doc.font(this.defaultFont)
       .fontSize(9)
       .text(data.employee?.fullName || 'N/A', 50, yPos + 12);
    
    doc.fontSize(8)
       .fillColor('#666666')
       .text(`${data.employee?.department || 'N/A'}`, 50, yPos + 25);

    // Right Column - Request Info
    doc.fillColor('#000000')
       .fontSize(8)
       .font(this.boldFont)
       .text('Request Type:', 280, yPos);
    
    doc.font(this.defaultFont)
       .fontSize(9)
       .text(this.formatRequestType(data.requestType), 280, yPos + 12);

    doc.font(this.boldFont)
       .fontSize(8)
       .text('Urgency:', 280, yPos + 30);
    
    doc.font(this.defaultFont)
       .fontSize(9)
       .text(this.formatUrgency(data.urgency), 280, yPos + 42);

    if (data.projectId) {
      doc.font(this.boldFont)
         .fontSize(8)
         .text('Project:', 280, yPos + 60);
      
      doc.font(this.defaultFont)
         .fontSize(8)
         .text((data.projectId.name || 'N/A').substring(0, 30), 280, yPos + 72);
    }

    yPos = boxStartY + boxHeight + 15;

    // Purpose - Compact
    doc.fontSize(8)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Purpose:', 40, yPos);
    
    yPos += 12;

    const purposeText = (data.purpose || 'N/A').substring(0, 200);
    doc.fontSize(8)
       .font(this.defaultFont)
       .fillColor('#333333')
       .text(purposeText, 40, yPos, {
         width: 515,
         align: 'justify',
         lineGap: 2
       });

    const purposeHeight = Math.min(doc.heightOfString(purposeText, { width: 515 }), 40);
    yPos += purposeHeight + 10;

    // Business Justification - Compact
    doc.fontSize(8)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Business Justification:', 40, yPos);
    
    yPos += 12;

    const justificationText = (data.businessJustification || 'N/A').substring(0, 250);
    doc.fontSize(8)
       .font(this.defaultFont)
       .fillColor('#333333')
       .text(justificationText, 40, yPos, {
         width: 515,
         align: 'justify',
         lineGap: 2
       });

    const justificationHeight = Math.min(doc.heightOfString(justificationText, { width: 515 }), 50);
    yPos += justificationHeight + 15;

    return yPos;
  }

  drawDisbursementHistory(doc, yPos, data) {
  yPos += 5;
  
  // Section header
  doc.fontSize(11)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Disbursement History', 40, yPos);
  
  yPos += 20;

  const totalDisbursed = data.totalDisbursed || 0;
  const remainingBalance = data.remainingBalance || 0;
  const amountApproved = data.amountApproved || data.amountRequested;

  const progress = amountApproved > 0 ? Math.round((totalDisbursed / amountApproved) * 100) : 0;

  // Progress summary box
  const boxHeight = 50;
  doc.rect(40, yPos, 515, boxHeight)
     .fillAndStroke('#E6F7FF', '#1890FF');

  yPos += 10;

  // Progress info
  doc.fontSize(8)
     .font(this.boldFont)
     .fillColor('#000000')
     .text('Disbursement Progress:', 50, yPos);
  
  doc.text(`${progress}%`, 480, yPos, { width: 65, align: 'right' });

  yPos += 15;

  doc.fontSize(8)
     .font(this.defaultFont)
     .text(`Total Disbursed: XAF ${this.formatCurrency(totalDisbursed)}`, 50, yPos);
  
  if (remainingBalance > 0) {
    doc.text(`Remaining: XAF ${this.formatCurrency(remainingBalance)}`, 300, yPos);
  } else {
    doc.fillColor('#52c41a')
       .text('✓ Fully Disbursed', 300, yPos)
       .fillColor('#000000');
  }

  yPos += 30;

  // Individual disbursements
  if (data.disbursements && data.disbursements.length > 0) {
    doc.fontSize(9)
       .font(this.boldFont)
       .fillColor('#000000')
       .text(`Payment History (${data.disbursements.length} payment${data.disbursements.length > 1 ? 's' : ''}):`, 40, yPos);
    
    yPos += 15;

    // ✅ FIXED: Check page break before table header
    if (yPos > 700) {
      doc.addPage();
      yPos = 50;
      
      doc.fontSize(11)
         .font(this.boldFont)
         .fillColor('#000000')
         .text('Disbursement History (continued)', 40, yPos);
      yPos += 20;
    }

    // Table header
    doc.rect(40, yPos, 515, 18)
       .fillAndStroke('#F5F5F5', '#CCCCCC');

    doc.fontSize(8)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('#', 50, yPos + 5)
       .text('Date', 100, yPos + 5)
       .text('Amount', 250, yPos + 5)
       .text('Notes', 370, yPos + 5);

    yPos += 18;

    // Disbursement rows
    data.disbursements.forEach((disb, index) => {
      // ✅ FIXED: Check page break for each row
      if (yPos > 720) {
        doc.addPage();
        yPos = 50;
        
        // Redraw section header on new page
        doc.fontSize(11)
           .font(this.boldFont)
           .fillColor('#000000')
           .text('Disbursement History (continued)', 40, yPos);
        yPos += 20;
        
        // Redraw table header
        doc.rect(40, yPos, 515, 18)
           .fillAndStroke('#F5F5F5', '#CCCCCC');

        doc.fontSize(8)
           .font(this.boldFont)
           .fillColor('#000000')
           .text('#', 50, yPos + 5)
           .text('Date', 100, yPos + 5)
           .text('Amount', 250, yPos + 5)
           .text('Notes', 370, yPos + 5);

        yPos += 18;
      }

      // Alternate row colors
      if (index % 2 === 0) {
        doc.rect(40, yPos, 515, 20)
           .fillAndStroke('#FAFAFA', '#CCCCCC');
      } else {
        doc.rect(40, yPos, 515, 20)
           .stroke('#CCCCCC');
      }

      doc.fontSize(8)
         .font(this.defaultFont)
         .fillColor('#000000')
         .text(`${disb.disbursementNumber || index + 1}`, 50, yPos + 6)
         .text(this.formatDateExact(disb.date), 100, yPos + 6)
         .text(`XAF ${this.formatCurrency(disb.amount)}`, 250, yPos + 6);

      if (disb.notes) {
        const truncatedNotes = disb.notes.length > 30 
          ? `${disb.notes.substring(0, 30)}...` 
          : disb.notes;
        doc.text(truncatedNotes, 370, yPos + 6);
      }

      yPos += 20;
    });

    yPos += 10;
  }

  return yPos;
}

  drawApprovalChainTimeline(doc, yPos, data) {
    // Section header
    doc.fontSize(11)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Approval Chain', 40, yPos);
    
    yPos += 20;

    if (!data.approvalChain || data.approvalChain.length === 0) {
      doc.fontSize(9)
         .font(this.defaultFont)
         .fillColor('#999999')
         .text('No approval chain data', 40, yPos);
      return yPos + 20;
    }

    // Draw each approval step - COMPACT VERSION
    data.approvalChain.forEach((step, index) => {
      // Check if we need a new page (leave room for footer)
      if (yPos > 680) {
        doc.addPage();
        yPos = 50;
        
        // Redraw section header on new page
        doc.fontSize(11)
           .font(this.boldFont)
           .fillColor('#000000')
           .text('Approval Chain (continued)', 40, yPos);
        yPos += 20;
      }

      // Draw timeline connector line (if not first)
      if (index > 0) {
        doc.moveTo(55, yPos - 10)
           .lineTo(55, yPos)
           .strokeColor('#CCCCCC')
           .lineWidth(2)
           .stroke();
      }

      // Draw status circle
      const statusColor = step.status === 'approved' ? '#52c41a' : 
                         step.status === 'rejected' ? '#f5222d' : '#d9d9d9';
      
      doc.circle(55, yPos + 6, 5)
         .fillAndStroke(statusColor, statusColor);

      // Step details - COMPACT
      doc.fontSize(8)
         .font(this.boldFont)
         .fillColor('#000000')
         .text(`Level ${step.level}: ${step.approver.name}`, 75, yPos);

      doc.fontSize(7)
         .font(this.defaultFont)
         .fillColor('#666666')
         .text(`${step.approver.role}`, 75, yPos + 10);

      // Status and date - COMPACT
      if (step.status === 'approved') {
        doc.fillColor('#52c41a')
           .fontSize(7)
           .font(this.boldFont)
           .text('✓ APPROVED', 75, yPos + 20);
        
        doc.fillColor('#666666')
           .font(this.defaultFont)
           .fontSize(7)
           .text(`${this.formatDateExact(step.actionDate)} ${step.actionTime || ''}`, 75, yPos + 30);

        if (step.comments) {
          const shortComment = step.comments.substring(0, 80);
          doc.fillColor('#333333')
             .fontSize(7)
             .text(`"${shortComment}${step.comments.length > 80 ? '...' : ''}"`, 75, yPos + 40, {
               width: 450,
               height: 18,
               ellipsis: true
             });
          yPos += 55;
        } else {
          yPos += 45;
        }
      } else if (step.status === 'rejected') {
        doc.fillColor('#f5222d')
           .fontSize(7)
           .font(this.boldFont)
           .text('✗ REJECTED', 75, yPos + 20);
        
        doc.fillColor('#666666')
           .font(this.defaultFont)
           .fontSize(7)
           .text(`${this.formatDateExact(step.actionDate)} ${step.actionTime || ''}`, 75, yPos + 30);

        if (step.comments) {
          const shortComment = step.comments.substring(0, 80);
          doc.fillColor('#f5222d')
             .fontSize(7)
             .text(`"${shortComment}${step.comments.length > 80 ? '...' : ''}"`, 75, yPos + 40, {
               width: 450,
               height: 18,
               ellipsis: true
             });
          yPos += 55;
        } else {
          yPos += 45;
        }
      } else {
        doc.fillColor('#999999')
           .fontSize(7)
           .font(this.defaultFont)
           .text('Pending', 75, yPos + 20);
        yPos += 35;
      }
    });

    return yPos + 10;
  }

  drawCashRequestFinancialSummary(doc, yPos, data) {
    yPos += 5;
    
    // Section header
    doc.fontSize(11)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Financial Summary', 40, yPos);
    
    yPos += 20;

    // Show all financial metrics
    const boxHeight = ['partially_disbursed', 'fully_disbursed'].includes(data.status) ? 88 : 70;
    doc.rect(40, yPos, 515, boxHeight)
       .fillAndStroke('#F5F5F5', '#CCCCCC');

    yPos += 12;

    // Amount Requested
    doc.fontSize(8)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Amount Requested:', 50, yPos);
    
    doc.text(`XAF ${this.formatCurrency(data.amountRequested)}`, 380, yPos, {
      width: 165,
      align: 'right'
    });

    yPos += 18;

    // Amount Approved
    doc.text('Amount Approved:', 50, yPos);
    
    doc.fillColor(data.amountApproved ? '#52c41a' : '#000000')
       .text(`XAF ${this.formatCurrency(data.amountApproved || data.amountRequested)}`, 380, yPos, {
         width: 165,
         align: 'right'
       });

    yPos += 18;

    // Total Disbursed (if partial/full disbursement)
    if (['partially_disbursed', 'fully_disbursed'].includes(data.status)) {
      doc.fillColor('#000000')
         .text('Total Disbursed:', 50, yPos);
      
      doc.fillColor('#1890ff')
         .font(this.boldFont)
         .fontSize(9)
         .text(`XAF ${this.formatCurrency(data.totalDisbursed || 0)}`, 380, yPos, {
           width: 165,
           align: 'right'
         });

      yPos += 18;

      // Remaining Balance
      doc.fillColor('#000000')
         .font(this.boldFont)
         .fontSize(8)
         .text('Remaining Balance:', 50, yPos);
      
      const remainingColor = data.remainingBalance > 0 ? '#faad14' : '#52c41a';
      doc.fillColor(remainingColor)
         .font(this.boldFont)
         .fontSize(9)
         .text(`XAF ${this.formatCurrency(data.remainingBalance || 0)}`, 380, yPos, {
           width: 165,
           align: 'right'
         });
    } else {
      // Original: Single disbursement amount
      doc.fillColor('#000000')
         .text('Amount Disbursed:', 50, yPos);
      
      const disbursedAmount = data.disbursementDetails?.amount || data.totalDisbursed || data.amountApproved || data.amountRequested;
      
      doc.fillColor('#1890ff')
         .font(this.boldFont)
         .fontSize(9)
         .text(`XAF ${this.formatCurrency(disbursedAmount)}`, 380, yPos, {
           width: 165,
           align: 'right'
         });
    }

    return yPos + 25;
  }

  drawBudgetAllocation(doc, yPos, data) {
    const budget = data.budgetAllocation;
    
    yPos += 5;
    
    // Section header
    doc.fontSize(11)
       .font(this.boldFont)
       .fillColor('#000000')
       .text('Budget Allocation', 40, yPos);
    
    yPos += 20;

    // Compact budget box
    const boxHeight = 75;
    doc.rect(40, yPos, 515, boxHeight)
       .strokeColor('#CCCCCC')
       .lineWidth(0.5)
       .stroke();

    yPos += 12;

    // Budget Code
    doc.fontSize(8)
       .font(this.boldFont)
       .text('Budget Code:', 50, yPos);
    
    doc.font(this.defaultFont)
       .text(budget.budgetCode || 'N/A', 200, yPos);

    yPos += 15;

    // Budget Name
    if (budget.budgetCodeId?.name) {
      doc.font(this.boldFont)
         .text('Budget Name:', 50, yPos);
      
      doc.font(this.defaultFont)
         .text((budget.budgetCodeId.name || '').substring(0, 50), 200, yPos, { width: 300 });
      
      yPos += 15;
    }

    // Allocated Amount
    doc.font(this.boldFont)
       .text('Allocated Amount:', 50, yPos);
    
    doc.font(this.defaultFont)
       .text(`XAF ${this.formatCurrency(budget.allocatedAmount)}`, 200, yPos);

    yPos += 15;

    // Status
    doc.font(this.boldFont)
       .text('Status:', 50, yPos);
    
    doc.font(this.defaultFont)
       .text(this.formatAllocationStatus(budget.allocationStatus), 200, yPos);

    return yPos + 20;
  }

  drawCashRequestSignatureSection(doc, yPos, data) {
    yPos += 15;
    
    const signatureY = yPos;
    const lineWidth = 120;
    const lineSpacing = 160;
    
    // Three signature lines
    for (let i = 0; i < 3; i++) {
      const xPos = 40 + (i * lineSpacing);
      
      doc.moveTo(xPos, signatureY + 25)
         .lineTo(xPos + lineWidth, signatureY + 25)
         .strokeColor('#000000')
         .lineWidth(0.5)
         .stroke();
    }
  }

  drawCashRequestFooter(doc, data, pageNum, totalPages) {
  // Suppress auto-pagination during footer rendering
  const originalContinueOnNewPage = doc.continueOnNewPage;
  doc.continueOnNewPage = false;
  
  // Position footer with explicit bounds to prevent overflow
  const footerY = doc.page.height - 75; // Positioned to fit within content area
  const footerLineHeight = 11; // Fixed line height
  
  // Horizontal line
  doc.strokeColor('#CCCCCC')
     .lineWidth(0.5)
     .moveTo(40, footerY)
     .lineTo(555, footerY)
     .stroke();

  // Footer content
  doc.fontSize(7)
     .font(this.defaultFont)
     .fillColor('#666666');

  // ✅ FIXED: All text with explicit height constraints to prevent auto-pagination
  let currentY = footerY + 6;

  // Line 1: Registration and page number
  doc.text('RC/DLA/2014/B/2690 NIU: M061421030521', 40, currentY, {
    width: 420,
    height: 9,
    lineBreak: false,
    ellipsis: true,
    continued: false
  });
  
  doc.text(`Page ${pageNum} / ${totalPages}`, 480, currentY, {
    width: 75,
    height: 9,
    align: 'right',
    continued: false
  });

  currentY += footerLineHeight;

  // Line 2: Generation timestamp
  doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, 40, currentY, {
    width: 515,
    height: 9,
    lineBreak: false,
    ellipsis: true,
    continued: false
  });

  currentY += footerLineHeight;

  // Line 3: Contact
  doc.text('679586444 | info@gratoengineering.com | www.gratoengineering.com', 40, currentY, {
    width: 515,
    height: 9,
    lineBreak: false,
    ellipsis: true,
    continued: false
  });

  currentY += footerLineHeight;

  // Line 4: Location
  doc.text('Location: Bonaberi-Douala, beside Santa Lucia Telecommunications', 40, currentY, {
    width: 515,
    height: 9,
    lineBreak: false,
    ellipsis: true,
    continued: false
  });

  currentY += footerLineHeight;

  // Line 5: Services
  doc.text('Civil, Electrical and Mechanical Engineering Services', 40, currentY, {
    width: 515,
    height: 9,
    lineBreak: false,
    ellipsis: true,
    continued: false
  });
  
  // Restore original setting
  doc.continueOnNewPage = originalContinueOnNewPage;
}

  // ============================================
  // HELPER METHODS
  // ============================================
  safeNumber(value, defaultValue = 0) {
    if (value === null || value === undefined || value === '') {
      return defaultValue;
    }
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  safeString(value, defaultValue = '') {
    if (value === null || value === undefined) {
      return defaultValue;
    }
    const str = String(value);
    if (str.includes('NaN') || str === 'NaN') {
      return defaultValue || '0';
    }
    return str;
  }

  decodeHTMLEntities(text) {
    if (!text) return '';
    const htmlEntities = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
      '&#39;': "'",
      '&nbsp;': ' ',
      '&ndash;': '–',
      '&mdash;': '—'
    };
    
    let decoded = String(text);
    Object.entries(htmlEntities).forEach(([entity, char]) => {
      decoded = decoded.replace(new RegExp(entity, 'g'), char);
    });
    return decoded;
  }

  formatDateExact(date) {
    if (!date) return '';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return '';
      
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      
      return `${month}/${day}/${year}`;
    } catch (error) {
      console.error('Date formatting error:', error);
      return '';
    }
  }

  formatCurrency(number) {
    const safeNum = this.safeNumber(number, 0);
    if (isNaN(safeNum)) return '0.00';
    
    try {
      return safeNum.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    } catch (error) {
      console.error('Number formatting error:', error);
      return '0.00';
    }
  }

  truncateText(text, maxLength) {
    const safeText = this.safeString(text, '');
    if (safeText.length <= maxLength) return safeText;
    return safeText.substring(0, maxLength - 3) + '...';
  }

  formatStatus(status) {
    return (status || 'Unknown').replace(/_/g, ' ').toUpperCase();
  }

  formatRequestType(type) {
    return (type || 'N/A').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  formatUrgency(urgency) {
    const map = {
      'urgent': 'URGENT',
      'high': 'HIGH',
      'medium': 'MEDIUM',
      'low': 'LOW'
    };
    return map[urgency] || (urgency || 'N/A').toUpperCase();
  }

  formatAllocationStatus(status) {
    return (status || 'N/A').replace(/_/g, ' ').toUpperCase();
  }
}



module.exports = new PDFService();


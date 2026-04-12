// controllers/quotationController.js

const Quote = require('../models/Quote');
const pdfService = require('../services/pdfService');

// Download quotation PDF
exports.downloadQuotationPDF = async (req, res) => {
  try {
    const { quoteId } = req.params;

    const quote = await Quote.findById(quoteId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('items.itemId', 'code description');

    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }

    // Prepare data for PDF
    const pdfData = {
      quoteNumber: quote.quoteNumber,
      supplierDetails: {
        name: quote.supplierDetails?.name || quote.supplierId?.fullName,
        email: quote.supplierDetails?.email || quote.supplierId?.email,
        phone: quote.supplierDetails?.phone || quote.supplierId?.phone,
        address: quote.supplierDetails?.address
      },
      submissionDate: quote.submissionDate,
      validUntil: quote.validUntil,
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      taxApplicable: false, // Quotes don't have tax yet
      items: quote.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        specifications: item.specifications
      })),
      paymentTerms: quote.paymentTerms,
      deliveryTerms: quote.deliveryTerms,
      deliveryTime: quote.deliveryTime
    };

    const pdfResult = await pdfService.generateQuotationPDF(pdfData);

    if (!pdfResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF'
      });
    }

    const filename = `Quotation_${quote.quoteNumber}_${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfResult.buffer.length);

    res.send(pdfResult.buffer);

  } catch (error) {
    console.error('Download quotation PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF',
      error: error.message
    });
  }
};

// Preview quotation PDF
exports.previewQuotationPDF = async (req, res) => {
  try {
    const { quoteId } = req.params;

    const quote = await Quote.findById(quoteId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('items.itemId', 'code description');

    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }

    const pdfData = {
      quoteNumber: quote.quoteNumber,
      supplierDetails: {
        name: quote.supplierDetails?.name || quote.supplierId?.fullName,
        email: quote.supplierDetails?.email || quote.supplierId?.email,
        phone: quote.supplierDetails?.phone || quote.supplierId?.phone,
        address: quote.supplierDetails?.address
      },
      submissionDate: quote.submissionDate,
      validUntil: quote.validUntil,
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      taxApplicable: false,
      items: quote.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        specifications: item.specifications
      })),
      paymentTerms: quote.paymentTerms,
      deliveryTerms: quote.deliveryTerms,
      deliveryTime: quote.deliveryTime
    };

    const pdfResult = await pdfService.generateQuotationPDF(pdfData);

    if (!pdfResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF preview'
      });
    }

    const filename = `Quotation_${quote.quoteNumber}_preview.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfResult.buffer.length);

    res.send(pdfResult.buffer);

  } catch (error) {
    console.error('Preview quotation PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF preview',
      error: error.message
    });
  }
};

// Email quotation PDF
exports.emailQuotationPDF = async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { emailTo, message = '' } = req.body;

    const quote = await Quote.findById(quoteId)
      .populate('supplierId', 'fullName email phone supplierDetails')
      .populate('items.itemId', 'code description');

    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }

    const pdfData = {
      quoteNumber: quote.quoteNumber,
      supplierDetails: {
        name: quote.supplierDetails?.name || quote.supplierId?.fullName,
        email: quote.supplierDetails?.email || quote.supplierId?.email,
        phone: quote.supplierDetails?.phone || quote.supplierId?.phone,
        address: quote.supplierDetails?.address
      },
      submissionDate: quote.submissionDate,
      validUntil: quote.validUntil,
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      items: quote.items.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice
      })),
      paymentTerms: quote.paymentTerms,
      deliveryTerms: quote.deliveryTerms
    };

    const pdfResult = await pdfService.generateQuotationPDF(pdfData);

    if (!pdfResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate PDF for email'
      });
    }

    const { sendEmail } = require('../services/emailService');

    await sendEmail({
      to: emailTo || quote.supplierDetails?.email,
      subject: `Quotation ${quote.quoteNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Quotation Document</h2>
          <p>Please find attached the quotation document.</p>
          ${message ? `<p><strong>Message:</strong><br>${message}</p>` : ''}
          <p>Best regards,<br>GRATO ENGINEERING GLOBAL LTD</p>
        </div>
      `,
      attachments: [{
        filename: pdfResult.filename,
        content: pdfResult.buffer,
        contentType: 'application/pdf'
      }]
    });

    res.json({
      success: true,
      message: `Quotation PDF sent successfully to ${emailTo}`
    });

  } catch (error) {
    console.error('Email quotation PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to email PDF',
      error: error.message
    });
  }
};

module.exports = exports;
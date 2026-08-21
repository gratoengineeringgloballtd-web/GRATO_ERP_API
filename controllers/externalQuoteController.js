const crypto = require('crypto');
const RFQ = require('../models/RFQ');
const Quote = require('../models/Quote');
const PurchaseRequisition = require('../models/PurchaseRequisition');
const { sendEmail } = require('../services/emailService');

/**
 * Generate an invitation for an external (unregistered) supplier and email them the
 * link to view the RFQ and submit a quote. Called from createAndSendRFQ for every
 * address in externalSupplierEmails - kept as a standalone helper so it can be reused
 * (e.g. resending an invitation) without duplicating the token/email logic.
 */
async function inviteExternalSupplier(rfq, email, companyName, buyerName) {
  const token = crypto.randomBytes(32).toString('hex');

  rfq.externalInvitations.push({
    email: email.toLowerCase().trim(),
    companyName: companyName?.trim(),
    token,
    invitedDate: new Date(),
    expiresAt: rfq.responseDeadline,
    responseStatus: 'pending'
  });

  const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/external-quote/${token}`;

  await sendEmail({
    to: email,
    subject: `Request for Quotation - ${rfq.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #e6f7ff; padding: 20px; border-radius: 8px; border-left: 4px solid #1890ff;">
          <h2 style="color: #1890ff; margin-top: 0;">Request for Quotation</h2>
          <p>You have been invited by ${buyerName} to submit a quotation for the following requirement:</p>
          <div style="background-color: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h4>${rfq.title}</h4>
            <ul>
              <li><strong>RFQ Number:</strong> ${rfq.rfqNumber}</li>
              <li><strong>Quote Deadline:</strong> ${rfq.responseDeadline.toLocaleDateString('en-GB')}</li>
              <li><strong>Items:</strong> ${rfq.items.length} item(s)</li>
            </ul>
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${inviteUrl}" style="background-color: #1890ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              View RFQ & Submit Quote
            </a>
          </div>
          <p style="color: #888; font-size: 12px;">This link is unique to you - please don't share it. No account is needed to submit a quote.</p>
        </div>
      </div>
    `
  }).catch(err => console.error(`Failed to send external RFQ invitation to ${email}:`, err.message));

  return token;
}

/**
 * Get RFQ details for an external supplier viewing via their invitation link. Public -
 * no authentication, since the token itself is the credential.
 */
exports.getExternalRFQ = async (req, res) => {
  try {
    const { token } = req.params;

    const rfq = await RFQ.findOne({ 'externalInvitations.token': token })
      .populate('requisitionId', 'title deliveryLocation');

    if (!rfq) {
      return res.status(404).json({ success: false, message: 'Invitation not found or has expired' });
    }

    const invitation = rfq.externalInvitations.find(i => i.token === token);
    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      return res.status(410).json({ success: false, message: 'This invitation has expired' });
    }

    // If this supplier already submitted a quote against this RFQ, let them view/edit it
    // rather than starting from scratch.
    const existingQuote = await Quote.findOne({
      rfqId: rfq._id,
      externalInvitationToken: token
    });

    res.json({
      success: true,
      data: {
        rfq: {
          rfqNumber: rfq.rfqNumber,
          title: rfq.title,
          description: rfq.description,
          items: rfq.items.map((item, index) => ({
            id: item._id || index,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            specifications: item.specifications
          })),
          responseDeadline: rfq.responseDeadline,
          expectedDeliveryDate: rfq.expectedDeliveryDate,
          paymentTerms: rfq.paymentTerms,
          deliveryLocation: rfq.deliveryLocation,
          specialRequirements: rfq.specialRequirements
        },
        invitation: {
          email: invitation.email,
          companyName: invitation.companyName,
          responseStatus: invitation.responseStatus
        },
        existingQuote: existingQuote || null
      }
    });
  } catch (error) {
    console.error('Get external RFQ error:', error);
    res.status(500).json({ success: false, message: 'Failed to load RFQ', error: error.message });
  }
};

/**
 * Submit (or update) a quote from an external supplier. Public - no authentication,
 * the token is the credential. Creates a real Quote document with isExternal=true, so
 * it flows into the same evaluation/comparison pipeline as registered-supplier quotes.
 */
exports.submitExternalQuote = async (req, res) => {
  try {
    const { token } = req.params;
    const { supplierInfo, quotedItems, totalAmount, deliveryTime, deliveryTimeUnit, paymentTerms, warranty, validityPeriod, supplierNotes, termsAccepted } = req.body;

    if (!termsAccepted) {
      return res.status(400).json({ success: false, message: 'You must accept the terms and conditions to submit a quote' });
    }
    if (!supplierInfo?.companyName || !supplierInfo?.email) {
      return res.status(400).json({ success: false, message: 'Company name and email are required' });
    }
    if (!quotedItems || quotedItems.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one quoted item is required' });
    }

    const rfq = await RFQ.findOne({ 'externalInvitations.token': token });
    if (!rfq) {
      return res.status(404).json({ success: false, message: 'Invitation not found or has expired' });
    }

    const invitation = rfq.externalInvitations.find(i => i.token === token);
    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      return res.status(410).json({ success: false, message: 'This invitation has expired - the quote deadline has passed' });
    }

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (validityPeriod || 30));

    const quoteCount = await Quote.countDocuments();
    const quoteNumber = `QT-EXT-${new Date().getFullYear()}-${String(quoteCount + 1).padStart(6, '0')}`;

    const existingQuote = await Quote.findOne({ rfqId: rfq._id, externalInvitationToken: token });

    const quoteData = {
      requisitionId: rfq.requisitionId,
      rfqId: rfq._id,
      buyerId: rfq.buyerId,
      isExternal: true,
      externalInvitationToken: token,
      totalAmount,
      validUntil,
      status: 'received',
      supplierDetails: {
        name: supplierInfo.companyName,
        email: supplierInfo.email,
        phone: supplierInfo.phone,
        contactPerson: supplierInfo.contactPerson,
        address: supplierInfo.address
      },
      items: quotedItems.map(item => ({
        description: item.description,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        specifications: item.specifications,
        warranty: item.warranty,
        leadTime: item.deliveryTime ? `${item.deliveryTime} days` : undefined
      })),
      paymentTerms,
      deliveryTime: { value: deliveryTime, unit: deliveryTimeUnit || 'days' },
      warranty,
      supplierNotes
    };

    let quote;
    if (existingQuote) {
      Object.assign(existingQuote, quoteData);
      quote = await existingQuote.save();
    } else {
      quote = await Quote.create({ quoteNumber, ...quoteData });
    }

    invitation.responseStatus = 'responded';
    invitation.responseDate = new Date();
    rfq.responseSummary.totalResponded = (rfq.responseSummary.totalResponded || 0) + (existingQuote ? 0 : 1);
    await rfq.save();

    console.log(`✅ External quote ${existingQuote ? 'updated' : 'submitted'}: ${quote.quoteNumber} from ${supplierInfo.companyName}`);

    res.json({
      success: true,
      message: existingQuote ? 'Quote updated successfully' : 'Quote submitted successfully',
      data: { quoteNumber: quote.quoteNumber, submissionDate: quote.submissionDate }
    });
  } catch (error) {
    console.error('Submit external quote error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit quote', error: error.message });
  }
};

exports.inviteExternalSupplier = inviteExternalSupplier;

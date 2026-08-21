const express = require('express');
const router = express.Router();
const externalQuoteController = require('../controllers/externalQuoteController');

// Public - no auth middleware. The invitation token is the credential, matching how
// every other token-based public flow in this app works (e.g. share links).
router.get('/:token/rfq', externalQuoteController.getExternalRFQ);
router.post('/:token/submit', externalQuoteController.submitExternalQuote);

module.exports = router;

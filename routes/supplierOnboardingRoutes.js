const express = require('express');
const router = express.Router();
const supplierOnboardingController = require('../controllers/supplierOnboardingController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const uploadMiddleware = require('../middlewares/uploadMiddleware');

const documentUploadFields = [
    { name: 'businessRegistrationCertificate', maxCount: 1 },
    { name: 'taxClearanceCertificate', maxCount: 1 },
    { name: 'bankStatement', maxCount: 1 },
    { name: 'insuranceCertificate', maxCount: 1 },
    { name: 'additionalDocuments', maxCount: 5 }
];

router.post(
    '/onboarding/submit',
    uploadMiddleware.fields(documentUploadFields),
    supplierOnboardingController.submitApplication
);

router.get('/onboarding/applications', authMiddleware, requireRoles('admin', 'supply_chain'), supplierOnboardingController.getAllApplications);
router.get('/onboarding/applications/:id', authMiddleware, requireRoles('admin', 'supply_chain'), supplierOnboardingController.getApplicationById);
router.put('/onboarding/applications/:id/status', authMiddleware, requireRoles('admin', 'supply_chain'), supplierOnboardingController.updateApplicationStatus);

module.exports = router;

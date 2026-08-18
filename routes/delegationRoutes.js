const express = require('express');
const router = express.Router();
const delegationController = require('../controllers/delegationController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/me', delegationController.getMyDelegation);
router.post('/me', delegationController.setDelegation);
router.delete('/me', delegationController.clearDelegation);
router.get('/delegators', delegationController.getMyDelegators);
router.get('/candidates', delegationController.searchDelegateCandidates);

module.exports = router;

const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { authMiddleware, requireRoles } = require('../middlewares/authMiddleware');
const { upload, resizeImages, handleUpload, handleUploadError } = require('../middlewares/uploadMiddleware');

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Task routes with image upload handling
router.post(
  '/',
  authMiddleware,
  upload.array('images', 5),
  resizeImages,
  handleUploadError,
  handleUpload,
  taskController.createTask
);


router.get('/', taskController.getTasks);
router.get('/:id', taskController.getTask);

router.put('/:id',
  upload.array('images', 5),
  handleUploadError,
  resizeImages,
  handleUpload,
  taskController.updateTask
);

router.delete('/:id', taskController.deleteTask);

// Admin-only routes
router.get('/admin/all', 
  requireRoles('admin'),
  taskController.getAllTasks
);

module.exports = router;
const Task = require('../models/Task');
const User = require('../models/User');
const { uploadFile: uploadToCloudinary, deleteFile: deleteFromCloudinary } = require('../services/fileUploadService');
// const { createNotification } = require('../services/notificationService');

exports.createTask = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      price,
      scheduledDate
    } = req.body;

    // Parse location
    let location;
    try {
      location = JSON.parse(req.body.location);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid location format. Ensure it's a valid JSON string."
      });
    }

    // Create base task data
    const taskData = {
      title,
      description,
      category,
      price,
      location,
      scheduledDate,
      creator: req.user._id,
      images: []
    };

    // Handle image uploads if present
    if (req.processedFiles && req.processedFiles.length > 0) {
      const uploadPromises = req.processedFiles.map(file => 
        uploadToCloudinary({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        })
      );

      const uploadedImages = await Promise.all(uploadPromises);
      taskData.images = uploadedImages.map(img => ({
        url: img.secure_url,
        publicId: img.public_id
      }));
    }

    // Create task in database
    const task = await Task.create(taskData);

    res.status(201).json({
      success: true,
      data: task
    });

  } catch (error) {
    console.error('Task creation error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.getTasks = async (req, res) => {
  try {
    const {
      status,
      category,
      lat,
      lng,
      distance = 5000,
      sort = '-createdAt',
      page = 1,
      limit = 10
    } = req.query;

    const query = {};

    // Filter by status
    if (status) query.status = status;

    // Filter by category
    if (category) query.category = category;

    // Filter by location if coordinates provided
    if (lat && lng) {
      query.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseInt(distance)
        }
      };
    }

    // Pagination
    const skip = (page - 1) * limit;

    const tasks = await Task.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('creator', 'profile.name profile.avatar')
      .populate('doer', 'profile.name profile.avatar');

    const total = await Task.countDocuments(query);

    res.status(200).json({
      success: true,
      data: tasks,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: tasks.length,
        total: total
      }
    });

  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.getTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('creator', 'profile.name profile.avatar')
      .populate('doer', 'profile.name profile.avatar');

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.status(200).json({
      success: true,
      data: task
    });

  } catch (error) {
    console.error('Get task error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check if user is authorized to update
    if (task.creator.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this task'
      });
    }

    if (req.processedImages) {
      req.body.images = req.processedImages;
    }

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      req.body,
      { 
        new: true,
        runValidators: true
      }
    );

    res.status(200).json({
      success: true,
      data: updatedTask
    });

  } catch (error) {
    console.error('Update task error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Check if user is authorized to delete
    if (task.creator.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this task'
      });
    }

    // Delete task images from cloudinary
    if (task.images && task.images.length > 0) {
      const deletePromises = task.images.map(img => 
        deleteFromCloudinary(img.publicId)
      );
      await Promise.all(deletePromises);
    }

    await task.remove();

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully'
    });

  } catch (error) {
    console.error('Delete task error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


// Get All Tasks (Admin)
exports.getAllTasks = async (req, res) => {
  try {
    const tasks = await Task.find()
      .populate('creator', 'profile.name profile.avatar')
      .populate('doer', 'profile.name profile.avatar');

    res.status(200).json({
      success: true,
      count: tasks.length,
      data: tasks
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};
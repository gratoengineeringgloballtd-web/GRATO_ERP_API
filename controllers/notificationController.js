// controllers/notificationController.js
const socketService = require('../services/socketService');
const pushNotificationService = require('../services/pushNotificationService');
const Notification = require('../models/Notifications');

exports.sendTaskNotification = async (req, res) => {
    try {
        const { userId, taskId, type, message } = req.body;

        // Create notification object
        const notification = {
            title: 'Task Update',
            body: message,
            data: {
                taskId,
                type,
                timestamp: new Date().toISOString()
            }
        };

        // Send socket notification
        socketService.emitToUser(userId, 'task-update', {
            taskId,
            type,
            message,
            timestamp: new Date().toISOString()
        });

        // Send push notification
        await pushNotificationService.sendToUser(userId, notification);

        // Save notification to database
        await Notification.create({
            recipient: userId,
            type,
            message,
            taskId,
            read: false
        });

        res.status(200).json({
            success: true,
            message: 'Notification sent successfully'
        });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send notification',
            error: error.message
        });
    }
};

exports.markNotificationAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        await Notification.findByIdAndUpdate(notificationId, {
            read: true,
            readAt: new Date()
        });

        res.status(200).json({
            success: true,
            message: 'Notification marked as read'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update notification',
            error: error.message
        });
    }
};

exports.getUnreadNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({
            recipient: req.user._id,
            read: false
        }).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: notifications
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications',
            error: error.message
        });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const { notificationId } = req.params;
        await Notification.findByIdAndDelete(notificationId);

        res.status(200).json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete notification',
            error: error.message
        });
    }
};

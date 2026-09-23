const Payment = require('../models/Payment');
const Task = require('../models/Task');
const mtnMomoService = require('../services/mtnMomoService');

exports.initiatePayment = async (req, res) => {
    try {
        const { taskId, phoneNumber } = req.body;
        const userId = req.user._id;  

        // Find the task
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }
        console.log('Task found(F):', task.price);
        // Create payment record
        const payment = new Payment({
            taskId,
            amount: task.price,
            phoneNumber,
            payerId: userId,
            payeeId: task.creator,
            status: 'pending'
        });

        // Initiate payment with MTN MoMo
        const paymentResult = await mtnMomoService.initiatePayment(
            phoneNumber,
            task.price,
            `Payment for Task: ${task.title}`
        );

        // Update payment with transaction ID
        payment.transactionId = paymentResult.transactionId;
        await payment.save();

        res.status(200).json({
            message: 'Payment initiated successfully',
            paymentId: payment._id,
            transactionId: paymentResult.transactionId
        });
    } catch (error) {
        console.error('Payment initiation error:', error);
        res.status(500).json({ message: 'Failed to initiate payment' });
    }
};

exports.checkPaymentStatus = async (req, res) => {
    try {
        const { paymentId } = req.params;

        const payment = await Payment.findById(paymentId);
        if (!payment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        const statusResult = await mtnMomoService.checkPaymentStatus(payment.transactionId);
        
        if (statusResult.status !== payment.status) {
            payment.status = statusResult.status;
            await payment.save();

            // If payment is completed, update task status
            if (statusResult.status === 'completed') {
                await Task.findByIdAndUpdate(payment.taskId, {
                    paymentStatus: 'paid'
                });
            }
        }

        res.status(200).json({
            status: payment.status,
            paymentId: payment._id,
            transactionId: payment.transactionId
        });
    } catch (error) {
        console.error('Payment status check error:', error);
        res.status(500).json({ message: 'Failed to check payment status' });
    }
};

exports.getPaymentHistory = async (req, res) => {
    try {
        const userId = req.user._id;
        const payments = await Payment.find({
            $or: [{ payerId: userId }, { payeeId: userId }]
        })
        .populate('taskId', 'title')
        .sort('-createdAt');

        res.status(200).json(payments);
    } catch (error) {
        console.error('Payment history error:', error);
        res.status(500).json({ message: 'Failed to fetch payment history' });
    }
};
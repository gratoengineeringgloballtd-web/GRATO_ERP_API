const mongoose = require('mongoose');

const taskerSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    skills: [{
        type: String,
        required: true
    }],
    availability: [{
        day: {
            type: String,
            enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        },
        startTime: String,
        endTime: String
    }],
    currentLocation: {
        type: {
            type: String,
            default: "Point",
            enum: ["Point"]
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        }
    },
    rating: {
        type: Number,
        default: 0
    },
    completedTasks: {
        type: Number,
        default: 0
    },
    activeTask: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task'
    },
    preferredRadius: {
        type: Number,
        default: 10 // in kilometers
    },
    hourlyRate: {
        type: Number,
        required: true
    }
});

// Index for geospatial queries
taskerSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('Tasker', taskerSchema);
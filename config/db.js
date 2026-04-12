const mongoose = require('mongoose');



const { initializeSharePoint } = require('../utils/sharepointInit');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        
        console.log('MongoDB connected');
        initializeSharePoint();
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

module.exports = connectDB;



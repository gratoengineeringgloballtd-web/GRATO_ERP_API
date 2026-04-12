const socketIO = require('socket.io');

let io;

const initialize = (server) => {
  io = socketIO(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Handle simulation subscriptions
    socket.on('subscribe-simulation', (generatorId) => {
      socket.join(`simulation-${generatorId}`);
      
      // Start sending simulated data
      const interval = setInterval(() => {
        const data = SimulationController.generateTelemetry(generatorId, 1);
        socket.emit('telemetry-update', data);
        socket.to(`simulation-${generatorId}`).emit('telemetry-update', data);
      }, 1000);

      socket.on('disconnect', () => {
        clearInterval(interval);
      });
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

module.exports = { initialize, getIO };
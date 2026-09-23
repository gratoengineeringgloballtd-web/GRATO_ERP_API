module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('Telemetry socket connected:', socket.id);
    
    socket.on('disconnect', () => {
      console.log('Telemetry socket disconnected:', socket.id);
    });
  });
};
module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('Alert socket connected:', socket.id);
    
    socket.on('disconnect', () => {
      console.log('Alert socket disconnected:', socket.id);
    });
  });
};
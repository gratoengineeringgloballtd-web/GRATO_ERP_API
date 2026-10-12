// middlewares/errorCapture.js
// Records every 5xx response (method, URL, status, the message that was sent
// back, and who made the request) so IT can review failures from the IT
// console. Best-effort: logging problems never affect the request.
const mongoose = require('mongoose');

module.exports = function errorCapture(req, res, next) {
  const started = Date.now();
  let lastMessage;

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object') {
      lastMessage = body.message || body.error;
    }
    return originalJson(body);
  };

  res.on('finish', () => {
    if (res.statusCode < 500) return;
    if (mongoose.connection.readyState !== 1) return;
    try {
      const SystemErrorLog = require('../models/SystemErrorLog');
      SystemErrorLog.create({
        method: req.method,
        url: (req.originalUrl || req.url || '').slice(0, 500),
        status: res.statusCode,
        message: typeof lastMessage === 'string' ? lastMessage.slice(0, 1000) : undefined,
        userId: req.user?._id,
        userEmail: req.user?.email,
        userRole: req.user?.role,
        durationMs: Date.now() - started
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  });

  next();
};

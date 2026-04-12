const AuditLog = require('../models/AuditLog');

class AuditLogger {
  static async log(action, userId, requisitionId, details) {
    try {
      await AuditLog.create({
        action,
        userId,
        requisitionId,
        details,
        timestamp: new Date(),
        ipAddress: details.ipAddress
      });
      console.log(`Audit log created: ${action} by user ${userId}`);
    } catch (error) {
      console.error('Audit logging failed:', error);
      // Don't throw - logging should never break the app
    }
  }
}

module.exports = AuditLogger;
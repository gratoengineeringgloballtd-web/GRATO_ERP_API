const { AsyncLocalStorage } = require('async_hooks');

// Carries the current Express request through async calls so model hooks can tell who made a change.
const als = new AsyncLocalStorage();

const auditContextMiddleware = (req, res, next) => als.run({ req }, next);

function currentActor() {
  const store = als.getStore();
  const req = store && store.req;
  if (!req || !req.user) return { system: true };
  return {
    id: req.user.userId || String(req.user._id || ''),
    name: req.user.fullName || '',
    email: req.user.email || '',
    role: req.user.role || '',
    impersonatedBy: req.user.impersonatedBy || null,
    ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || '',
    method: req.method,
    path: (req.originalUrl || '').split('?')[0]
  };
}

module.exports = { als, auditContextMiddleware, currentActor };

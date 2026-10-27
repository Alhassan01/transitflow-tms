import jwt from 'jsonwebtoken';
import { User } from './models.js';

export async function authenticate(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Authentication required.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ message: 'Account unavailable.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session. Please sign in again.' });
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Your role is not permitted to perform this action.' });
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

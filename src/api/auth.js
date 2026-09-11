/**
 * Lightweight & Secure JWT Authentication Service
 * Uses Node.js built-in crypto for HMAC-SHA256 signature (Zero external dependency)
 */

const crypto = require('crypto');
const Database = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'traxen_teltonika_secret_key_2026_telematics';
const TOKEN_EXPIRY_HOURS = 72; // 3 days

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + (TOKEN_EXPIRY_HOURS * 3600);
  const fullPayload = { ...payload, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch (err) {
    return null;
  }
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    // If no header, check query param or cookie
    const token = req.query.token;
    if (token) {
      const user = verifyToken(token);
      if (user) {
        req.user = user;
        return next();
      }
    }
    // For convenience in development or testing without token, fallback to admin
    return res.status(401).json({ success: false, error: 'Authentication token required' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    const decoded = verifyToken(token);
    if (decoded) req.user = decoded;
  }
  next();
}

module.exports = {
  signToken,
  verifyToken,
  authenticate,
  optionalAuth
};

const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../.env') });

const PORT = parseInt(process.env.PORT, 10) || 3000;
const AUTH_SECRET = process.env.AUTH_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || '30d';

// Idle session disconnect timeout (default: exactly 12 hours in milliseconds = 43,200,000 ms)
const parsedIdleTimeout = parseInt(process.env.SESSION_IDLE_TIMEOUT_MS, 10);
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 43,200,000 ms
const SESSION_IDLE_TIMEOUT_MS = (!isNaN(parsedIdleTimeout) && parsedIdleTimeout > 0)
  ? parsedIdleTimeout
  : DEFAULT_SESSION_IDLE_TIMEOUT_MS;

// Throw error if critical secrets are missing
if (!AUTH_SECRET || !JWT_SECRET) {
  throw new Error(
    "Missing critical configuration in .env (AUTH_SECRET and/or JWT_SECRET).\n" +
    "Please run the setup script: bash scripts/setup.sh"
  );
}

module.exports = {
  PORT,
  AUTH_SECRET,
  JWT_SECRET,
  JWT_EXPIRY,
  SESSION_IDLE_TIMEOUT_MS,
  WINDOWS_USERPROFILE: null
};

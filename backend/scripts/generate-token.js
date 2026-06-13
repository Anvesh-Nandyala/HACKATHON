/**
 * Utility script to generate test JWT tokens.
 * Usage: node scripts/generate-token.js [userId] [role]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { generateToken } = require('../src/middleware/auth');

const userId = process.argv[2] || 'user-001';
const role = process.argv[3] || 'seller';

const token = generateToken(userId, role);
console.log(`\nGenerated token for user "${userId}" with role "${role}":\n`);
console.log(`Bearer ${token}\n`);
console.log('Use this in the Authorization header for API requests.');

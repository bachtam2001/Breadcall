/**
 * Diagnostic script to test login endpoint
 * Run this on the production server to diagnose login issues
 *
 * Usage: node debug-login.js [username] [password]
 */

const https = require('https');

const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'B@chtam2001';

const options = {
  hostname: 'call.bachtam2001.com',
  port: 443,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': JSON.stringify({ username, password }).length
  }
};

console.log('=== Login Diagnostic Test ===');
console.log(`Testing login for user: ${username}`);
console.log(`Target: https://call.bachtam2001.com/api/auth/login`);
console.log('');

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));

  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('');
    console.log('Response body:');
    console.log(data);

    try {
      const parsed = JSON.parse(data);
      console.log('');
      console.log('Parsed response:', JSON.stringify(parsed, null, 2));

      if (parsed.success) {
        console.log('');
        console.log('✓ Login SUCCESSFUL');
        console.log(`  - User: ${parsed.user?.username} (${parsed.user?.role})`);
        console.log(`  - Access token present: ${!!parsed.accessToken}`);
        console.log(`  - Expires in: ${parsed.expiresIn}s`);
      } else {
        console.log('');
        console.log('✗ Login FAILED');
        console.log(`  - Error: ${parsed.error}`);
      }
    } catch (e) {
      console.log('');
      console.log('✗ Response is not valid JSON');
      console.log('  - This might indicate nginx/proxy issues');
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(1);
});

req.write(JSON.stringify({ username, password }));
req.end();

console.log('Test script running');
// Basic test to see if we can import local modules if needed, or just prove node is working
const fs = require('fs');
console.log('Files in current dir:', fs.readdirSync('.'));

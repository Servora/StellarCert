const { v4: uuidv4 } = require('uuid');
console.log('UUID generated:', uuidv4());
const text = 'test?query=1';
console.log('Split test:', text.split('?')[0]);
console.log('Success!');

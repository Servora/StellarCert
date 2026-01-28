const { Keypair } = require('@stellar/stellar-sdk');

const pair = Keypair.random();
console.log('PUBLIC_KEY=' + pair.publicKey());
console.log('SECRET_KEY=' + pair.secret());

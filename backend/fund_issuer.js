const axios = require('axios');
const publicKey = 'GDQPXNZYUQFB7KDRPML6B5NMUCMYZ4TZRY6ZMGXVPKTJRHTP23DBUTTB';

async function fund() {
    try {
        console.log(`Funding ${publicKey}...`);
        const response = await axios.get(`https://friendbot.stellar.org?addr=${publicKey}`);
        console.log('Success!', response.data);
    } catch (error) {
        console.error('Error funding account:', error.message);
        if (error.response) {
            console.error(error.response.data);
        }
    }
}

fund();

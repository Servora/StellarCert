const { Client } = require('pg');

async function setupUser() {
    const client = new Client({
        user: 'mac',
        host: 'localhost',
        database: 'postgres',
        port: 5432,
    });

    try {
        await client.connect();
        console.log('Connected to PostgreSQL server.');

        // Create user if not exists
        try {
            await client.query("CREATE USER stellarwave_user WITH PASSWORD 'stellarwave_password'");
            console.log('User stellarwave_user created.');
        } catch (err) {
            if (err.code === '42710') {
                console.log('User stellarwave_user already exists.');
            } else {
                console.error('Error creating user:', err.message);
            }
        }

        // Grant privileges
        try {
            await client.query('GRANT ALL PRIVILEGES ON DATABASE stellarwave TO stellarwave_user');
            console.log('Privileges granted on stellarwave database.');
            // Need to grant ON SCHEMA public in newer PG versions
            const dbClient = new Client({
                user: 'mac',
                host: 'localhost',
                database: 'stellarwave',
                port: 5432,
            });
            await dbClient.connect();
            await dbClient.query('GRANT ALL ON SCHEMA public TO stellarwave_user');
            console.log('Privileges granted on public schema.');
            await dbClient.end();
        } catch (err) {
            console.error('Error granting privileges:', err.message);
        }

    } catch (err) {
        console.error('Connection error:', err.message);
    } finally {
        await client.end();
    }
}

setupUser();

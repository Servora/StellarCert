const { Client } = require('pg');

async function resetDb() {
    const client = new Client({
        host: 'localhost',
        port: 5432,
        user: 'stellarwave_user',
        password: 'stellarwave_password',
        database: 'stellarwave',
    });

    try {
        await client.connect();
        console.log('Connected to database');

        // Drop all tables
        const tables = ['verifications', 'certificates', 'certificates_old', 'users', 'issuers', 'audit_logs'];

        for (const table of tables) {
            try {
                await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
                console.log(`Dropped table ${table}`);
            } catch (e) {
                console.error(`Error dropping table ${table}:`, e.message);
            }
        }

        console.log('Database reset complete');
    } catch (err) {
        console.error('Connection error:', err.stack);
    } finally {
        await client.end();
    }
}

resetDb();

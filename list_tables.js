const { Client } = require('pg');

async function listTables() {
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

        const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

        console.log('Tables in database:');
        res.rows.forEach(row => console.log(` - ${row.table_name}`));

        const constraints = await client.query(`
      SELECT conname, contype 
      FROM pg_constraint 
      JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace 
      WHERE nspname = 'public'
    `);
        console.log('Constraints in database:');
        constraints.rows.forEach(row => console.log(` - ${row.conname} (${row.contype})`));

    } catch (err) {
        console.error('Error:', err.stack);
    } finally {
        await client.end();
    }
}

listTables();

const { Client } = require('pg');

async function checkAndCreate() {
  const client = new Client({
    user: 'mac', // Trying current user
    host: 'localhost',
    database: 'postgres',
    port: 5432,
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL server.');
    try {
      await client.query('CREATE DATABASE stellarwave');
      console.log('Database stellarwave created.');
    } catch (err) {
      if (err.code === '42P04') {
        console.log('Database stellarwave already exists.');
      } else {
        console.error('Error creating database:', err.message);
      }
    }
  } catch (err) {
    console.error('Could not connect to PostgreSQL server:', err.message);
  } finally {
    await client.end();
  }
}

checkAndCreate();

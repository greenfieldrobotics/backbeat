import pg from 'pg';

export default async function globalSetup() {
  // Connect to the default 'backbeat' database to create the test database
  const adminPool = new pg.Pool({
    connectionString: 'postgres://backbeat:backbeat@postgres:5432/backbeat',
  });

  try {
    // Drop and recreate test database
    await adminPool.query('DROP DATABASE IF EXISTS backbeat_test');
    await adminPool.query('CREATE DATABASE backbeat_test OWNER backbeat');
    console.log('Created backbeat_test database');
  } finally {
    await adminPool.end();
  }

  // Connect to the test database and create schema
  const testPool = new pg.Pool({
    connectionString: 'postgres://backbeat:backbeat@postgres:5432/backbeat_test',
  });

  try {
    const { initializeDatabase } = await import('../../src/db/schema.js');
    await initializeDatabase(testPool);
    console.log('Initialized backbeat_test schema');
  } finally {
    await testPool.end();
  }
}

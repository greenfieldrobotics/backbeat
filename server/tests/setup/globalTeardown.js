export default async function globalTeardown() {
  // The test database (backbeat_test) is left intact after tests.
  // It gets dropped and recreated by globalSetup on the next run.
  // This avoids connection pool conflicts with --forceExit.
  console.log('Tests complete. backbeat_test database preserved for inspection.');
}

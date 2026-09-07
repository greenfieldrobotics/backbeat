import { truncateAllTables } from './setup/testSetup.js';
import pool, {
  executeSql,
  executeSqlStrict,
  executeSqlWrite,
  executeSqlInsert,
  withTransaction,
  query,
} from '../src/db/connection.js';

describe('Query helper layer', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  describe('executeSqlStrict', () => {
    test('returns the rows', async () => {
      await query(`INSERT INTO locations (name, type) VALUES ('Strict Warehouse', 'Warehouse')`);

      const rows = await executeSqlStrict(pool, 'SELECT name, type FROM locations WHERE name = $1', ['Strict Warehouse']);

      expect(rows).toEqual([{ name: 'Strict Warehouse', type: 'Warehouse' }]);
    });

    test('returns an empty array when nothing matches', async () => {
      const rows = await executeSqlStrict(pool, 'SELECT name FROM locations WHERE name = $1', ['Nothing Here']);

      expect(rows).toEqual([]);
    });

    test('propagates a failure to the caller', async () => {
      await expect(
        executeSqlStrict(pool, 'SELECT * FROM a_table_that_does_not_exist')
      ).rejects.toThrow(/a_table_that_does_not_exist/);
    });

    test('propagates a unique violation with its Postgres error code', async () => {
      await query(`INSERT INTO locations (name, type) VALUES ('Duplicate Warehouse', 'Warehouse')`);

      // Services depend on this: 23505 is what turns into a 409 instead of a 500.
      await expect(
        executeSqlStrict(pool, 'INSERT INTO locations (name, type) VALUES ($1, $2)', ['Duplicate Warehouse', 'Warehouse'])
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('executeSql', () => {
    test('returns the rows when the query succeeds', async () => {
      await query(`INSERT INTO locations (name, type) VALUES ('Lenient Warehouse', 'Warehouse')`);

      const rows = await executeSql(pool, 'SELECT name, type FROM locations WHERE name = $1', ['Lenient Warehouse']);

      expect(rows).toEqual([{ name: 'Lenient Warehouse', type: 'Warehouse' }]);
    });

    test('logs and returns [] when the query fails', async () => {
      const logged = [];
      const originalError = console.error;
      console.error = (msg) => logged.push(msg);

      try {
        const rows = await executeSql(pool, 'SELECT * FROM a_table_that_does_not_exist');
        expect(rows).toEqual([]);
      } finally {
        console.error = originalError;
      }

      expect(logged.length).toBe(1);
      expect(logged[0]).toContain('a_table_that_does_not_exist');
    });
  });

  describe('executeSqlWrite', () => {
    test('returns the number of rows affected by an UPDATE', async () => {
      await query(`INSERT INTO locations (name, type) VALUES ('Write A', 'Warehouse'), ('Write B', 'Warehouse')`);

      const rowCount = await executeSqlWrite(pool, `UPDATE locations SET type = 'Regional Site' WHERE type = $1`, ['Warehouse']);

      expect(rowCount).toBe(2);
    });

    test('returns 0 when a DELETE matches nothing', async () => {
      const rowCount = await executeSqlWrite(pool, 'DELETE FROM locations WHERE name = $1', ['Never Existed']);

      expect(rowCount).toBe(0);
    });

    test('propagates a failure instead of swallowing it', async () => {
      // A write that fails quietly is data loss — writes never swallow.
      await expect(
        executeSqlWrite(pool, `INSERT INTO locations (name, type) VALUES ($1, $2)`, ['Bad Type', 'Not A Real Type'])
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('executeSqlInsert', () => {
    test('returns the id of the new row', async () => {
      const id = await executeSqlInsert(pool, 'INSERT INTO locations (name, type) VALUES ($1, $2)', ['Insert Warehouse', 'Warehouse']);

      expect(typeof id).toBe('number');
      const rows = await executeSqlStrict(pool, 'SELECT name FROM locations WHERE id = $1', [id]);
      expect(rows[0].name).toBe('Insert Warehouse');
    });

    test('tolerates a trailing semicolon', async () => {
      const id = await executeSqlInsert(pool, `INSERT INTO locations (name, type) VALUES ('Semicolon Warehouse', 'Warehouse');`);

      expect(typeof id).toBe('number');
    });

    test('refuses SQL that already has a RETURNING clause', async () => {
      await expect(
        executeSqlInsert(pool, `INSERT INTO locations (name, type) VALUES ('Returning Warehouse', 'Warehouse') RETURNING *`)
      ).rejects.toThrow(/adds its own RETURNING clause/);

      const rows = await executeSqlStrict(pool, 'SELECT name FROM locations');
      expect(rows).toEqual([]);
    });

    test('propagates a failure to the caller', async () => {
      await query(`INSERT INTO locations (name, type) VALUES ('Insert Duplicate', 'Warehouse')`);

      await expect(
        executeSqlInsert(pool, 'INSERT INTO locations (name, type) VALUES ($1, $2)', ['Insert Duplicate', 'Warehouse'])
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('composing inside a caller transaction', () => {
    test('helpers run on the client they are given and commit with it', async () => {
      const id = await withTransaction(async (client) => {
        const newId = await executeSqlInsert(client, 'INSERT INTO locations (name, type) VALUES ($1, $2)', ['Committed Warehouse', 'Warehouse']);
        await executeSqlWrite(client, `UPDATE locations SET type = 'Regional Site' WHERE id = $1`, [newId]);
        return newId;
      });

      const rows = await executeSqlStrict(pool, 'SELECT name, type FROM locations WHERE id = $1', [id]);
      expect(rows).toEqual([{ name: 'Committed Warehouse', type: 'Regional Site' }]);
    });

    test('work done through the helpers rolls back with the transaction', async () => {
      await expect(
        withTransaction(async (client) => {
          await executeSqlInsert(client, 'INSERT INTO locations (name, type) VALUES ($1, $2)', ['Rolled Back Warehouse', 'Warehouse']);
          throw new Error('workflow failed after the insert');
        })
      ).rejects.toThrow('workflow failed after the insert');

      const rows = await executeSqlStrict(pool, 'SELECT name FROM locations');
      expect(rows).toEqual([]);
    });
  });
});

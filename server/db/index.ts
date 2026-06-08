import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getDatabaseUrl } from '../config/env';
import * as schema from './schema';

// Lazily-connected connection pool. Constructing the pool does not open a socket,
// so the server can start even when PostgreSQL is not yet running.
const pool = new pg.Pool({ connectionString: getDatabaseUrl() });

export const db = drizzle(pool, { schema });
export { pool };

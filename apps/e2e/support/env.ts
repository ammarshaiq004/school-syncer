import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ports for the servers Playwright starts; kept clear of the dev servers on 3000 and 4000. */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const API_URL = `http://localhost:${API_PORT}/api`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

const here = path.dirname(fileURLToPath(import.meta.url));
export const API_DIR = path.resolve(here, '../../api');
/** Where the setup project leaves the seeded logins for the tests. */
export const SEED_FILE = path.resolve(here, '../.seed/seed.json');

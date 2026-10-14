import { randomBytes } from 'node:crypto';

// Rate-limit counters are shared through Postgres; each test file (and each
// run) gets its own namespace so suites and reruns do not use up each
// other's allowances from the same 127.0.0.1.
process.env.RATE_LIMIT_NAMESPACE = `e2e-${randomBytes(6).toString('hex')}`;

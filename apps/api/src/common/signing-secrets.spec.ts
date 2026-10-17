import { JwtService } from '@nestjs/jwt';
import { LocalStorageDriver } from '../elearning/files/storage/local.driver.js';
import { fileSigningSecrets, previousSecrets, verifySessionToken } from './signing-secrets.js';

const OLD = 'old-secret-0123456789abcdef0123456789';
const NEW = 'new-secret-fedcba9876543210fedcba9876';

describe('previousSecrets', () => {
  it('splits a comma-separated list, dropping blanks', () => {
    expect(previousSecrets(' a , ,b,')).toEqual(['a', 'b']);
    expect(previousSecrets(undefined)).toEqual([]);
  });
});

describe('JWT_SECRET rotation', () => {
  const jwt = new JwtService({ secret: NEW });
  const oldToken = new JwtService({ secret: OLD }).sign({ sub: 'u1' });

  it('accepts tokens signed with JWT_SECRET', async () => {
    await expect(verifySessionToken(jwt, jwt.sign({ sub: 'u2' }), {})).resolves.toMatchObject({ sub: 'u2' });
  });

  it('accepts tokens signed with JWT_SECRET_PREVIOUS only while it is set', async () => {
    await expect(verifySessionToken(jwt, oldToken, { JWT_SECRET_PREVIOUS: `unrelated-secret-xxxxxxxxxxxxxxxxxxxx,${OLD}` })).resolves.toMatchObject({ sub: 'u1' });
    await expect(verifySessionToken(jwt, oldToken, {})).rejects.toThrow(/invalid signature/);
  });

  it('still refuses tokens signed with anything else', async () => {
    const forged = new JwtService({ secret: 'attacker-secret-aaaaaaaaaaaaaaaaaaaaa' }).sign({ sub: 'u1' });
    await expect(verifySessionToken(jwt, forged, { JWT_SECRET_PREVIOUS: OLD })).rejects.toThrow();
  });
});

describe('FILE_SIGNING_SECRET rotation', () => {
  it('uses FILE_SIGNING_SECRET and its previous values, else JWT_SECRET and its previous values', () => {
    expect(fileSigningSecrets({ FILE_SIGNING_SECRET: NEW, FILE_SIGNING_SECRET_PREVIOUS: OLD, JWT_SECRET: 'j', JWT_SECRET_PREVIOUS: 'jp' })).toEqual({ current: NEW, previous: [OLD] });
    expect(fileSigningSecrets({ JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: OLD })).toEqual({ current: NEW, previous: [OLD] });
    expect(() => fileSigningSecrets({})).toThrow(/JWT_SECRET/);
  });

  it('keeps links signed with the previous secret working until it is removed', async () => {
    const before = new LocalStorageDriver('/tmp/unused', OLD, 'http://api');
    const link = new URL(await before.signedUrl('k', { id: 'f1' }, 600));
    const exp = link.searchParams.get('exp')!;
    const sig = link.searchParams.get('sig')!;
    const during = new LocalStorageDriver('/tmp/unused', NEW, 'http://api', [OLD]);
    const after = new LocalStorageDriver('/tmp/unused', NEW, 'http://api');
    expect(during.verify('f1', exp, sig)).toBe(true);
    expect(after.verify('f1', exp, sig)).toBe(false);
    expect(during.verify('f2', exp, sig)).toBe(false);
  });
});

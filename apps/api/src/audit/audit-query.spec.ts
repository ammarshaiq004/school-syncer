import { actorOf, auditWhere } from './audit-query.js';

describe('audit query', () => {
  it('scopes to the school and maps filters', () => {
    expect(auditWhere('s1', {})).toEqual({ schoolId: 's1' });
    expect(auditWhere('s1', { entity: 'User', userId: 'u1', action: 'user' })).toEqual({
      schoolId: 's1',
      entity: 'User',
      userId: 'u1',
      action: { startsWith: 'user.' },
    });
    expect(auditWhere('s1', { action: 'user.update', userId: 'platform' })).toMatchObject({
      action: 'user.update',
      userId: null,
    });
  });

  it('turns local from/to days into an inclusive range (Asia/Karachi, UTC+5)', () => {
    const where = auditWhere('s1', { from: '2026-10-01', to: '2026-10-03' });
    expect(where.createdAt).toEqual({
      gte: new Date('2026-09-30T19:00:00.000Z'),
      lt: new Date('2026-10-03T19:00:00.000Z'),
    });
  });

  it('names the actor', () => {
    const names = new Map([['u1', 'Ayesha Khan']]);
    expect(actorOf({ userId: 'u1', after: null }, names)).toEqual({ kind: 'user', id: 'u1', name: 'Ayesha Khan' });
    expect(actorOf({ userId: 'gone', after: null }, names).name).toBe('Removed user');
    expect(
      actorOf({ userId: 'u1', after: null, support: { adminId: 'a1', adminName: 'Hira Baig' } }, names).name,
    ).toBe('Ayesha Khan (via SchoolSyncer support: Hira Baig)');
    expect(actorOf({ userId: null, after: { by: 'Bilal' } }, names)).toEqual({
      kind: 'platform',
      id: null,
      name: 'Bilal (SchoolSyncer)',
    });
    expect(actorOf({ userId: null, after: null }, names).kind).toBe('system');
  });
});

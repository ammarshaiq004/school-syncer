import {
  buildContacts,
  canPost,
  messagesQuerySchema,
  preview,
  sendMessageSchema,
  threadRole,
  threadsQuerySchema,
} from './chat-rules.js';

describe('threadRole', () => {
  const thread = { guardianUserId: 'parent', staffUserId: 'teacher' };
  const none = { isGuardianOfStudent: false, canObserve: false };

  it('recognises the two participants', () => {
    expect(
      threadRole(thread, 'parent', { ...none, isGuardianOfStudent: true }),
    ).toBe('PARENT');
    expect(threadRole(thread, 'teacher', none)).toBe('STAFF');
  });

  it('drops a parent who is no longer a guardian of the student', () => {
    expect(threadRole(thread, 'parent', none)).toBeNull();
  });

  it('lets setup roles observe, and nobody else', () => {
    expect(threadRole(thread, 'principal', { ...none, canObserve: true })).toBe(
      'OBSERVER',
    );
    expect(threadRole(thread, 'other-teacher', none)).toBeNull();
  });

  it('prefers participation over observing', () => {
    expect(threadRole(thread, 'teacher', { ...none, canObserve: true })).toBe(
      'STAFF',
    );
  });
});

describe('canPost', () => {
  it('lets only participants post', () => {
    const t = { guardianUserId: 'p', staffUserId: 's' };
    expect(canPost(t, 'PARENT')).toBe(true);
    expect(canPost(t, 'STAFF')).toBe(true);
    expect(canPost(t, 'OBSERVER')).toBe(false);
    expect(canPost(t, null)).toBe(false);
  });

  it('closes a thread once either account is removed', () => {
    expect(canPost({ guardianUserId: null, staffUserId: 's' }, 'STAFF')).toBe(
      false,
    );
    expect(canPost({ guardianUserId: 'p', staffUserId: null }, 'PARENT')).toBe(
      false,
    );
  });
});

describe('buildContacts', () => {
  it('puts the class teacher first and merges subjects per teacher', () => {
    const contacts = buildContacts({
      classTeacher: { id: 't1', name: 'Saima Bibi' },
      subjects: [
        { subject: 'Urdu', teacher: { id: 't1', name: 'Saima Bibi' } },
        { subject: 'Science', teacher: { id: 't2', name: 'Asif Mehmood' } },
        { subject: 'Maths', teacher: { id: 't2', name: 'Asif Mehmood' } },
        { subject: 'English', teacher: { id: 't3', name: 'Ayesha Noor' } },
        { subject: 'Art', teacher: null },
      ],
    });
    expect(contacts).toEqual([
      {
        userId: 't1',
        name: 'Saima Bibi',
        isClassTeacher: true,
        subjects: ['Urdu'],
      },
      {
        userId: 't2',
        name: 'Asif Mehmood',
        isClassTeacher: false,
        subjects: ['Maths', 'Science'],
      },
      {
        userId: 't3',
        name: 'Ayesha Noor',
        isClassTeacher: false,
        subjects: ['English'],
      },
    ]);
  });

  it('is empty when nobody is assigned', () => {
    expect(
      buildContacts({
        classTeacher: null,
        subjects: [{ subject: 'Art', teacher: null }],
      }),
    ).toEqual([]);
  });
});

describe('chat schemas', () => {
  it('trims bodies and enforces 1-2000 characters', () => {
    expect(sendMessageSchema.parse({ body: '  Salam  ' }).body).toBe('Salam');
    expect(sendMessageSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ body: 'a'.repeat(2000) }).success,
    ).toBe(true);
    expect(
      sendMessageSchema.safeParse({ body: 'a'.repeat(2001) }).success,
    ).toBe(false);
  });

  it('defaults and caps the page size', () => {
    expect(messagesQuerySchema.parse({}).limit).toBe(50);
    expect(messagesQuerySchema.parse({ limit: '10' }).limit).toBe(10);
    expect(messagesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(threadsQuerySchema.parse({}).scope).toBe('mine');
    expect(threadsQuerySchema.safeParse({ scope: 'everyone' }).success).toBe(
      false,
    );
  });
});

describe('preview', () => {
  it('flattens whitespace and truncates', () => {
    expect(preview('Hello\n\n  there')).toBe('Hello there');
    const long = preview('x'.repeat(200), 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith('…')).toBe(true);
  });
});

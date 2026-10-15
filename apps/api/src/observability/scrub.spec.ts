import { isSecretKey, REDACTED, scrub, scrubText } from './scrub.js';

describe('scrubText', () => {
  it('masks CNICs, phones and emails', () => {
    expect(scrubText('Guardian 35202-1234567-1 not found')).toBe('Guardian [cnic] not found');
    expect(scrubText('B-Form 3520212345671 invalid')).toBe('B-Form [number] invalid');
    expect(scrubText('send to +92 300 1234567 failed')).toBe('send to [phone] failed');
    expect(scrubText('send to 0300-1234567 failed')).toBe('send to [phone] failed');
    expect(scrubText('to 923001234567')).toBe('to [phone]');
    expect(scrubText('call +44 20 7946 0958')).toBe('call [phone]');
    expect(scrubText('mail ali.khan+1@school.edu.pk now')).toBe('mail [email] now');
  });

  it('masks tokens, credentials and inline secrets', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.abcdefghijklmnop';
    expect(scrubText(`token was ${jwt}`)).toBe('token was [jwt]');
    expect(scrubText('Authorization: Bearer abc.def-ghi123')).toBe('Authorization: Bearer [redacted]');
    expect(scrubText('/files/x?exp=1&sig=AbC123_- ok')).toBe('/files/x?exp=1&sig=[redacted] ok');
    expect(scrubText('password: hunter22, user ali')).toBe('password: [redacted], user ali');
    expect(scrubText('{"api_key":"sk_live_123"}')).toBe('{"api_key":"[redacted]"}');
    expect(scrubText('card 4111 1111 1111 1111 declined')).toBe('card [number] declined');
  });

  it('leaves ordinary text alone', () => {
    expect(scrubText('Fee voucher 2026-10 for class 5 (Rs 4500)')).toBe('Fee voucher 2026-10 for class 5 (Rs 4500)');
  });
});

describe('scrub', () => {
  it('names secret keys however they are written', () => {
    for (const key of ['password', 'newPassword', 'pass', 'pwd', 'JWT_SECRET', 'accessToken', 'Authorization', 'cookie', 'x-api-key', 'cnic', 'guardianCnic', 'bForm', 'phone', 'fatherPhone', 'mobile', 'whatsapp', 'to', 'cardNumber', 'cvv', 'IBAN', 'accountNumber', 'hashKey', 'salt', 'otp', 'code', 'signature', 'sig', 'dsn']) {
      expect([key, isSecretKey(key)]).toEqual([key, true]);
    }
    for (const key of ['name', 'schoolId', 'amount', 'status', 'message', 'url', 'topic']) {
      expect([key, isSecretKey(key)]).toEqual([key, false]);
    }
  });

  it('drops the values of secret keys at any depth and scrubs other strings', () => {
    const event = {
      request: { headers: { authorization: 'Bearer x', 'user-agent': 'Mozilla' }, data: { password: 'p', guardian: { cnic: '35202-1234567-1', name: 'Ali' } } },
      extra: { gateway: { secrets: { hashKey: 'h', merchantId: 'm' } }, note: 'parent 03001234567' },
      tags: { queue: 'messages.deliver' },
      count: 3,
      none: null,
      empty: { token: '' },
    };
    expect(scrub(event)).toEqual({
      request: { headers: { authorization: REDACTED, 'user-agent': 'Mozilla' }, data: { password: REDACTED, guardian: { cnic: REDACTED, name: 'Ali' } } },
      extra: { gateway: { secrets: REDACTED }, note: 'parent [phone]' },
      tags: { queue: 'messages.deliver' },
      count: 3,
      none: null,
      empty: { token: '' },
    });
    // The original is untouched.
    expect(event.request.data.password).toBe('p');
  });

  it('stops at a depth limit and caps arrays', () => {
    type Nested = { next?: Nested };
    const deep: Nested = {};
    let node = deep;
    for (let i = 0; i < 20; i++) node = node.next = {};
    expect(JSON.stringify(scrub(deep))).toContain('[truncated]');
    expect(scrub(Array.from({ length: 500 }, (_, i) => i))).toHaveLength(100);
  });
});

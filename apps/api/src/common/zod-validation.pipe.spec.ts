import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ name: z.string().min(2) }));

  it('returns parsed data when valid', () => {
    expect(pipe.transform({ name: 'Grade 5' })).toEqual({ name: 'Grade 5' });
  });

  it('throws a 400 listing the failing fields', () => {
    expect(() => pipe.transform({ name: 'x' })).toThrow(BadRequestException);
  });
});

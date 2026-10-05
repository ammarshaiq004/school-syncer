import { lessonContentProblem, neighbours, progressPercent, reorderProblem } from './course-rules.js';

describe('progressPercent', () => {
  it('rounds and treats an empty course as 0%', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
    expect(progressPercent(3, 3)).toBe(100);
    expect(progressPercent(5, 3)).toBe(100);
  });
});

describe('reorderProblem', () => {
  it('accepts a permutation of the existing ids', () => {
    expect(reorderProblem(['a', 'b', 'c'], ['c', 'a', 'b'])).toBeNull();
    expect(reorderProblem([], [])).toBeNull();
  });
  it('rejects duplicates, missing and unknown ids', () => {
    expect(reorderProblem(['a', 'b'], ['a', 'a'])).toMatch(/twice/);
    expect(reorderProblem(['a', 'b', 'c'], ['a', 'b'])).toMatch(/every item/);
    expect(reorderProblem(['a', 'b'], ['a', 'x'])).toMatch(/not here/);
  });
});

describe('lessonContentProblem', () => {
  it('needs body for text lessons and an https link for the rest', () => {
    expect(lessonContentProblem({ kind: 'TEXT', body: 'Read chapter 2' })).toBeNull();
    expect(lessonContentProblem({ kind: 'TEXT', body: '   ' })).toMatch(/content/);
    expect(lessonContentProblem({ kind: 'VIDEO', url: 'https://youtu.be/dQw4w9WgXcQ' })).toBeNull();
    expect(lessonContentProblem({ kind: 'VIDEO' })).toMatch(/video link/);
    expect(lessonContentProblem({ kind: 'LINK', url: null })).toMatch(/needs a link/);
    expect(lessonContentProblem({ kind: 'DOCUMENT', url: '' })).toMatch(/document/);
    expect(lessonContentProblem({ kind: 'LINK', url: 'http://example.com' })).toMatch(/https/);
    expect(lessonContentProblem({ kind: 'TEXT', body: 'x', url: 'javascript:alert(1)' })).toMatch(/https/);
  });
});

describe('neighbours', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('finds the previous and next items', () => {
    expect(neighbours(items, 'a')).toEqual({ prev: null, next: { id: 'b' } });
    expect(neighbours(items, 'b')).toEqual({ prev: { id: 'a' }, next: { id: 'c' } });
    expect(neighbours(items, 'c')).toEqual({ prev: { id: 'b' }, next: null });
    expect(neighbours(items, 'x')).toEqual({ prev: null, next: null });
  });
});

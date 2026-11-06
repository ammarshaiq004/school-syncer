import { consoleView, listQuerySchema, reportSchema, schoolView } from './problem-reports.js';

const at = (iso: string) => new Date(iso);
const row = {
  id: 'r1',
  schoolId: 's1',
  reporterId: 'u1',
  reporterName: 'Ayesha',
  roles: ['TEACHER'],
  source: 'WEB',
  message: 'Save spins',
  page: '/attendance',
  appVersion: '0.1.0',
  browser: 'Chrome',
  screenshotId: 'f1',
  screenshot: null,
  status: 'FIXED',
  statusChangedAt: at('2026-10-02T00:00:00Z'),
  createdAt: at('2026-10-01T00:00:00Z'),
  updatedAt: at('2026-10-02T00:00:00Z'),
  activity: [
    { id: 'a1', reportId: 'r1', adminId: 'p1', adminName: 'Support', status: 'IN_PROGRESS', fromStatus: 'NEW', note: null, createdAt: at('2026-10-01T10:00:00Z') },
    { id: 'a2', reportId: 'r1', adminId: 'p1', adminName: 'Support', status: null, fromStatus: null, note: 'Slow network', createdAt: at('2026-10-01T11:00:00Z') },
    { id: 'a3', reportId: 'r1', adminId: 'p1', adminName: 'Support', status: 'FIXED', fromStatus: 'IN_PROGRESS', note: null, createdAt: at('2026-10-02T00:00:00Z') },
  ],
} as unknown as Parameters<typeof schoolView>[0];

describe('problem report replies', () => {
  const replied = {
    ...row,
    assignedTo: { id: 'p1', name: 'Support' },
    activity: [
      ...row.activity,
      { id: 'a4', reportId: 'r1', adminId: 'p1', adminName: 'Support', status: null, fromStatus: null, note: null, reply: 'Please update the app.', createdAt: at('2026-10-02T01:00:00Z') },
    ],
  } as unknown as Parameters<typeof schoolView>[0];

  it('shows the school each reply without who wrote it, and not who looks after the report', () => {
    const view = schoolView(replied);
    expect(view.replies).toEqual([{ id: 'a4', reply: 'Please update the app.', at: at('2026-10-02T01:00:00Z') }]);
    expect(view.history).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain('Support');
  });

  it('shows the console the assignee and the reply', () => {
    const view = consoleView(replied);
    expect(view.assignedTo).toEqual({ id: 'p1', name: 'Support' });
    expect(view.activity.at(-1)).toMatchObject({ reply: 'Please update the app.', adminName: 'Support' });
  });
});

describe('problem report views', () => {
  it('shows the school status changes only, never notes or staff names', () => {
    const view = schoolView(row);
    expect(view.history).toEqual([
      { status: 'IN_PROGRESS', fromStatus: 'NEW', at: at('2026-10-01T10:00:00Z') },
      { status: 'FIXED', fromStatus: 'IN_PROGRESS', at: at('2026-10-02T00:00:00Z') },
    ]);
    expect(view.hasScreenshot).toBe(true);
    expect(JSON.stringify(view)).not.toContain('Slow network');
    expect(JSON.stringify(view)).not.toContain('Support');
  });

  it('shows the console everything', () => {
    const view = consoleView(row);
    expect(view.activity.map((a) => a.note)).toEqual([null, 'Slow network', null]);
    expect(view.schoolId).toBe('s1');
  });
});

describe('reportSchema', () => {
  it('keeps one-line fields on one line and defaults to the web', () => {
    const parsed = reportSchema.parse({ message: '  It broke again  ', page: '/fees\r\nX-Evil: 1', browser: 'Chrome\n' });
    expect(parsed).toMatchObject({ message: 'It broke again', page: '/fees X-Evil: 1', browser: 'Chrome', source: 'WEB' });
  });

  it('needs a real message and a page', () => {
    expect(reportSchema.safeParse({ message: 'Hi', page: '/' }).success).toBe(false);
    expect(reportSchema.safeParse({ message: 'Nothing loads', page: '   ' }).success).toBe(false);
    expect(reportSchema.safeParse({ message: 'Nothing loads', page: 'teacher', source: 'DESKTOP' }).success).toBe(false);
  });

  it('pages the inbox from 1', () => {
    expect(listQuerySchema.parse({}).page).toBe(1);
    expect(listQuerySchema.parse({ page: '3', open: 'true' })).toMatchObject({ page: 3, open: 'true' });
    expect(listQuerySchema.safeParse({ status: 'DONE' }).success).toBe(false);
  });
});

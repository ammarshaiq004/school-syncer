import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { deleteSchools } from './cleanup.js';

// The school's public website: edited by the owner, read by anyone once published.
describe('School website (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const run = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  let owner: Record<string, string>;
  let teacher: Record<string, string>;
  let other: Record<string, string>;
  let slug: string;
  let otherSlug: string;

  const register = async (name: string, email: string) =>
    (
      await request(server)
        .post('/api/auth/register-school')
        .send({ schoolName: name, ownerName: 'Owner', email, password: 'password123' })
        .expect(201)
    ).body;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    const a = await register(`Site School ${run}`, `site+${run}@test.pk`);
    slug = a.schoolSlug;
    owner = { Authorization: `Bearer ${a.accessToken}` };
    const b = await register(`Other Site School ${run}`, `site-other+${run}@test.pk`);
    otherSlug = b.schoolSlug;
    other = { Authorization: `Bearer ${b.accessToken}` };

    const phone = `0300${run.slice(-7)}`;
    await request(server)
      .post('/api/users')
      .set(owner)
      .send({ name: 'Teacher', phone, password: 'password123', roles: [{ role: 'TEACHER' }] })
      .expect(201);
    const login = await request(server)
      .post('/api/auth/login')
      .send({ schoolSlug: slug, login: phone, password: 'password123' })
      .expect(200);
    teacher = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    await deleteSchools(prisma, { slug });
    await deleteSchools(prisma, { slug: otherSlug });
    await app.close();
  });

  it('suggests a site from the school record before anything is saved', async () => {
    const res = await request(server).get('/api/school/site').set(owner).expect(200);
    expect(res.body).toMatchObject({ slug, published: false, saved: {} });
    expect(res.body.config.hero.headline).toBeTruthy();
    expect(res.body.config.theme.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(res.body.defaults.hero).toEqual(res.body.config.hero);
  });

  it('has no public site until it is published', async () => {
    await request(server).get(`/api/public/${slug}/site`).expect(404);
    await request(server).get('/api/public/no-such-school/site').expect(404);
  });

  it('saves choices, publishes, and shows them to anyone', async () => {
    const save = await request(server)
      .put('/api/school/site')
      .set(owner)
      .send({ published: true, content: { hero: { headline: 'Learning that lasts', tagline: 'Since 1999', subheadline: 'Small classes.', notice: '' }, theme: { primary: '#0f766e', accent: '#f97316', font: 'modern', scene: 'learning', corners: 'sharp', appearance: 'dark' } } })
      .expect(200);
    expect(save.body.published).toBe(true);
    expect(Object.keys(save.body.saved).sort()).toEqual(['hero', 'theme']);

    const pub = await request(server).get(`/api/public/${slug}/site`).expect(200);
    expect(pub.body.school.slug).toBe(slug);
    expect(pub.body.site.hero.headline).toBe('Learning that lasts');
    expect(pub.body.site.theme).toMatchObject({ primary: '#0f766e', font: 'modern', scene: 'learning' });
    // Sections that were not saved still follow the school's record.
    expect(pub.body.site.about.title).toBeTruthy();
  });

  it('puts left-out sections back on their defaults', async () => {
    await request(server).put('/api/school/site').set(owner).send({ published: true, content: {} }).expect(200);
    const res = await request(server).get(`/api/public/${slug}/site`).expect(200);
    expect(res.body.site.hero.headline).not.toBe('Learning that lasts');
  });

  it('refuses a bad colour and an overlong headline', async () => {
    await request(server).put('/api/school/site').set(owner).send({ published: true, content: { theme: { primary: 'red', accent: '#f97316', font: 'modern', scene: 'campus', corners: 'soft', appearance: 'auto' } } }).expect(400);
    await request(server).put('/api/school/site').set(owner).send({ published: true, content: { hero: { headline: 'x'.repeat(500), tagline: '', subheadline: '', notice: '' } } }).expect(400);
  });

  it('keeps the editor to the people who run the school', async () => {
    await request(server).get('/api/school/site').set(teacher).expect(403);
    await request(server).put('/api/school/site').set(teacher).send({ published: true, content: {} }).expect(403);
    await request(server).get('/api/school/site').expect(401);
  });

  it('keeps each school to its own site', async () => {
    await request(server).put('/api/school/site').set(owner).send({ published: true, content: { hero: { headline: 'Only for school one', tagline: '', subheadline: '', notice: '' } } }).expect(200);
    const mine = await request(server).get('/api/school/site').set(other).expect(200);
    expect(mine.body.slug).toBe(otherSlug);
    expect(mine.body.published).toBe(false);
    expect(mine.body.config.hero.headline).not.toBe('Only for school one');
    await request(server).get(`/api/public/${otherSlug}/site`).expect(404);
  });
});

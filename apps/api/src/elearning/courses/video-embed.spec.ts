import { parseStartTime, videoEmbedUrl } from './video-embed.js';

describe('videoEmbedUrl', () => {
  const nocookie = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ' http://youtu.be/dQw4w9WgXcQ ',
  ])('embeds YouTube link %s without cookies', (url) => {
    expect(videoEmbedUrl(url)).toBe(nocookie);
  });

  it('keeps the start time', () => {
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(`${nocookie}?start=90`);
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toBe(`${nocookie}?start=90`);
  });

  it('embeds Vimeo links with do-not-track', () => {
    expect(videoEmbedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871?dnt=1');
    expect(videoEmbedUrl('https://vimeo.com/channels/staffpicks/76979871')).toBe(
      'https://player.vimeo.com/video/76979871?dnt=1',
    );
    expect(videoEmbedUrl('https://player.vimeo.com/video/76979871')).toBe(
      'https://player.vimeo.com/video/76979871?dnt=1',
    );
  });

  it('keeps the privacy hash of unlisted Vimeo videos', () => {
    expect(videoEmbedUrl('https://vimeo.com/76979871/abc123def0')).toBe(
      'https://player.vimeo.com/video/76979871?h=abc123def0&dnt=1',
    );
  });

  it.each([
    null,
    '',
    'not a url',
    'javascript:alert(1)',
    'https://drive.google.com/file/d/abc/view',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UC123',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://vimeo.com/about',
    'ftp://youtu.be/dQw4w9WgXcQ',
  ])('returns null for %s', (url) => {
    expect(videoEmbedUrl(url)).toBeNull();
  });
});

describe('parseStartTime', () => {
  it('reads seconds and h/m/s forms', () => {
    expect(parseStartTime('45')).toBe(45);
    expect(parseStartTime('45s')).toBe(45);
    expect(parseStartTime('2m')).toBe(120);
    expect(parseStartTime('1h2m3s')).toBe(3723);
    expect(parseStartTime('0')).toBeNull();
    expect(parseStartTime('abc')).toBeNull();
    expect(parseStartTime(null)).toBeNull();
  });
});

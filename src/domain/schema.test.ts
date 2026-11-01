import { describe, expect, it } from 'vitest';
import { songSchema } from './schema';

const legacySong = {
  id: 'sng_legacy',
  title: 'Legacy song',
  durationSec: 180,
  videoFileName: null,
  grid: { cols: 9, rows: 5 },
  sections: [],
  lines: [],
};

describe('songSchema audio references', () => {
  it('defaults audioFileName to null for songs saved before audio support', () => {
    const parsed = songSchema.parse(legacySong);
    expect(parsed.audioFileName).toBeNull();
  });

  it('keeps a linked audio filename', () => {
    const parsed = songSchema.parse({ ...legacySong, audioFileName: 'track.mp3' });
    expect(parsed.audioFileName).toBe('track.mp3');
  });

  it('accepts an explicitly cleared audio filename', () => {
    const parsed = songSchema.parse({ ...legacySong, audioFileName: null });
    expect(parsed.audioFileName).toBeNull();
  });
});

describe('songSchema source links', () => {
  it('defaults sourceUrl to null for songs saved before link support', () => {
    const parsed = songSchema.parse(legacySong);
    expect(parsed.sourceUrl).toBeNull();
  });

  it('keeps a saved source link', () => {
    const parsed = songSchema.parse({
      ...legacySong,
      sourceUrl: 'https://www.youtube.com/watch?v=example',
    });
    expect(parsed.sourceUrl).toBe('https://www.youtube.com/watch?v=example');
  });

  it('accepts an explicitly cleared source link', () => {
    const parsed = songSchema.parse({ ...legacySong, sourceUrl: null });
    expect(parsed.sourceUrl).toBeNull();
  });

  it('rejects a source link longer than 2048 characters', () => {
    const result = songSchema.safeParse({
      ...legacySong,
      sourceUrl: `https://example.com/${'a'.repeat(2048)}`,
    });
    expect(result.success).toBe(false);
  });
});

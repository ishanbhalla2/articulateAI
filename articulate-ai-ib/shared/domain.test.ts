import { describe, expect, it } from 'vitest';
import { missingForGenerate, type MediaRef, type SessionInput } from './domain';

const media = (role: MediaRef['role'], judge_id: string | null = null): MediaRef => ({
  media_id: crypto.randomUUID(),
  role,
  judge_id,
  source: 'upload',
  media_path: 'raw/s/m',
  media_type: 'audio',
  mime_type: 'audio/webm',
  original_filename: null,
  duration_seconds: 10,
  part_count: 1,
});

const complete: SessionInput = {
  participant_name: 'Alex',
  topic_text: 'RAG on Databricks',
  domain_key: null,
  judges: [{ judge_id: 'j1', position: 1, name: 'Sam', role: 'CTO' }],
  audiences: ['ctos'],
  media: [media('participant'), media('judge', 'j1')],
};

describe('missingForGenerate', () => {
  it('accepts a complete session', () => {
    expect(missingForGenerate(complete)).toEqual([]);
  });

  it('lists every missing requirement', () => {
    expect(missingForGenerate({ ...complete, participant_name: ' ', topic_text: null, audiences: [], media: [] })).toEqual([
      'participant name',
      'topic',
      'participant recording',
      'at least one judge recording',
      'at least one audience',
    ]);
  });

  it('accepts a recorded topic instead of text', () => {
    expect(missingForGenerate({ ...complete, topic_text: null, media: [...complete.media, media('topic')] })).toEqual([]);
  });

  it('does not count empty judge slots', () => {
    expect(missingForGenerate({ ...complete, media: [media('participant')] })).toEqual(['at least one judge recording']);
  });
});

import { describe, it, expect } from 'vitest';
import { AiBudget } from './budget';
import { FallbackAiClient } from './fallback';
import { GeminiAiClient, type GenerateFn } from './gemini';
import type { RawItem, StoryInput } from '../types';

const item = (id: string, title: string, sourceId = 's1'): RawItem => ({
  id,
  sourceId,
  siteName: sourceId.toUpperCase(),
  title,
  url: `https://x.dev/${id}`,
  snippet: `${title} snippet`,
});

function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

const freeBudget = (max = 10) => {
  const c = fakeClock();
  return new AiBudget(max, 8, c.now, c.sleep);
};

describe('AiBudget', () => {
  it('budget stops after maxCalls', async () => {
    const b = freeBudget(2);
    expect([await b.take(), await b.take(), await b.take()]).toEqual([true, true, false]);
    expect(b.remaining).toBe(0);
  });

  it('budget waits to respect perMinute', async () => {
    const c = fakeClock();
    const b = new AiBudget(10, 2, c.now, c.sleep);
    await b.take();
    await b.take();
    expect(c.slept).toEqual([]);
    await b.take();
    expect(c.slept).toEqual([60_000]);
  });

  it('refuses after quota is marked exhausted', async () => {
    const b = freeBudget(5);
    b.markQuotaExhausted();
    expect(b.exhausted).toBe(true);
    expect(await b.take()).toBe(false);
  });
});

describe('FallbackAiClient', () => {
  it('fallback clusters similar titles and scores releases higher', async () => {
    const ai = new FallbackAiClient();
    const clusters = await ai.triage(
      [
        item('i0', 'Angular 22 released with zoneless default', 's1'),
        item('i1', 'Angular 22 released: zoneless by default', 's2'),
        item('i2', 'Thoughts on team rituals', 's1'),
      ],
      [],
      { s1: ['angular'], s2: ['web'] },
    );
    expect(clusters).toHaveLength(2);
    const big = clusters.find((c) => c.itemIds.length === 2)!;
    expect(big.relevance).toBe(7);
    expect(big.tags.sort()).toEqual(['angular', 'web']);
    expect(clusters.find((c) => c.itemIds.length === 1)!.relevance).toBe(5);
    expect(new Set(clusters.map((c) => c.id)).size).toBe(2);
  });

  it('links clusters to similar recent posts', async () => {
    const [c] = await new FallbackAiClient().triage(
      [item('i0', 'Angular 22 released')],
      [{ id: 'p1', title: 'Angular 22 released today' }],
      {},
    );
    expect(c.existingPostId).toBe('p1');
  });

  it('summarize returns nothing', async () => {
    expect(await new FallbackAiClient().summarize([{ clusterId: 'c', items: [], text: '' }])).toEqual([]);
  });
});

describe('GeminiAiClient', () => {
  const make = (generate: GenerateFn, budget = freeBudget()) =>
    new GeminiAiClient({ apiKey: 'k', model: 'gemini-flash-latest', budget, generate, sleep: async () => {} });

  const idsIn = (contents: string, key: string) =>
    [...contents.matchAll(new RegExp(`"${key}":"([a-z]\\d+)"`, 'g'))].map((m) => m[1]);

  it('gemini triage returns validated clusters', async () => {
    const calls: Parameters<GenerateFn>[0][] = [];
    const ai = make(async (req) => {
      calls.push(req);
      return { text: JSON.stringify({ clusters: [{ itemIds: ['i0', 'i1'], relevance: 9, tags: ['Angular'] }] }) };
    });
    const clusters = await ai.triage([item('i0', 'A'), item('i1', 'B')], [], {});
    expect(clusters).toEqual([{ id: expect.any(String), itemIds: ['i0', 'i1'], relevance: 9, tags: ['angular'] }]);
    expect(calls[0].model).toBe('gemini-flash-latest');
    expect(calls[0].config.responseMimeType).toBe('application/json');
  });

  it('rejects unknown item ids and unknown existing posts', async () => {
    const ai = make(async () => ({
      text: JSON.stringify({
        clusters: [
          { itemIds: ['i0', 'zzz'], existingPostId: 'nope', relevance: 8, tags: [] },
          { itemIds: ['zzz'], relevance: 9, tags: [] },
        ],
      }),
    }));
    const clusters = await ai.triage([item('i0', 'A')], [{ id: 'p1', title: 'x' }], {});
    expect(clusters).toHaveLength(1);
    expect(clusters[0].itemIds).toEqual(['i0']);
    expect(clusters[0].existingPostId).toBeUndefined();
  });

  it('puts items the model forgot into fallback clusters', async () => {
    const ai = make(async () => ({ text: JSON.stringify({ clusters: [{ itemIds: ['i0'], relevance: 8, tags: [] }] }) }));
    const clusters = await ai.triage([item('i0', 'Alpha news'), item('i1', 'Totally different')], [], {});
    expect(clusters.flatMap((c) => c.itemIds).sort()).toEqual(['i0', 'i1']);
  });

  it('falls back on invalid JSON', async () => {
    const items = [item('i0', 'Angular 22 released'), item('i1', 'Bun 2 released')];
    const clusters = await make(async () => ({ text: 'not json' })).triage(items, [], {});
    const expected = await new FallbackAiClient().triage(items, [], {});
    expect(clusters.map(({ itemIds, relevance }) => ({ itemIds, relevance }))).toEqual(
      expected.map(({ itemIds, relevance }) => ({ itemIds, relevance })),
    );
  });

  it('triages in batches of 40', async () => {
    let calls = 0;
    const ai = make(async (req) => {
      calls++;
      const ids = idsIn(req.contents, 'id');
      return { text: JSON.stringify({ clusters: ids.map((id) => ({ itemIds: [id], relevance: 7, tags: [] })) }) };
    });
    const items = Array.from({ length: 45 }, (_, i) => item(`i${i}`, `Story number ${i} unique${i}`));
    expect(await ai.triage(items, [], {})).toHaveLength(45);
    expect(calls).toBe(2);
  });

  it('marks quota exhausted on daily 429 and stops calling', async () => {
    const budget = freeBudget();
    let calls = 0;
    const ai = make(async () => {
      calls++;
      throw Object.assign(new Error('Quota exceeded for metric GenerateRequestsPerDayPerProjectPerModel'), {
        status: 429,
      });
    }, budget);
    await ai.triage([item('i0', 'A')], [], {});
    await ai.summarize([{ clusterId: 'c0', items: [item('i0', 'A')], text: 't' }]);
    expect(budget.exhausted).toBe(true);
    expect(calls).toBe(1);
  });

  it('retries transient errors up to 3 times', async () => {
    let calls = 0;
    const ai = make(async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('Service unavailable'), { status: 503 });
      return { text: JSON.stringify({ clusters: [{ itemIds: ['i0'], relevance: 6, tags: [] }] }) };
    });
    const clusters = await ai.triage([item('i0', 'A')], [], {});
    expect(calls).toBe(3);
    expect(clusters[0].relevance).toBe(6);
  });

  it('summarize chunks by 5 and drops unknown cluster ids', async () => {
    let calls = 0;
    const ai = make(async (req) => {
      calls++;
      const stories: object[] = idsIn(req.contents, 'clusterId').map((id) => ({
        clusterId: id,
        title: `T ${id}`,
        tldr: 'tl',
        keyPoints: ['k'],
        whyItMatters: 'w',
        tags: ['x'],
      }));
      stories.push({ clusterId: 'ghost', title: 'G', tldr: 'g', keyPoints: [], whyItMatters: '', tags: [] });
      return { text: JSON.stringify({ stories }) };
    });
    const stories: StoryInput[] = Array.from({ length: 7 }, (_, i) => ({
      clusterId: `c${i}`,
      items: [item(`i${i}`, 't')],
      text: 'body',
    }));
    const out = await ai.summarize(stories);
    expect(calls).toBe(2);
    expect(out.map((s) => s.clusterId)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  });

  it('summarize returns what it has when the budget runs out', async () => {
    const ai = make(async (req) => {
      const stories = idsIn(req.contents, 'clusterId').map((id) => ({
        clusterId: id,
        title: 'T',
        tldr: 't',
        keyPoints: [],
        whyItMatters: 'w',
        tags: [],
      }));
      return { text: JSON.stringify({ stories }) };
    }, freeBudget(1));
    const stories: StoryInput[] = Array.from({ length: 7 }, (_, i) => ({ clusterId: `c${i}`, items: [], text: '' }));
    expect(await ai.summarize(stories)).toHaveLength(5);
  });
});

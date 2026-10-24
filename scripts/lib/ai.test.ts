import { describe, it, expect } from 'vitest';
import { AiBudget, FallbackAiClient, GeminiAiClient, type GenerateFn, type RawItem, type StoryInput, jaccard, titleTokens, clusterByTitle, matchExisting } from './ai';
import { normalizeUrl } from '../../shared/feed';

describe('ai', () => {
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

  it('keeps half the calls for summaries: triage falls back to title matching after that', async () => {
    let calls = 0;
    const budget = freeBudget(4);
    const ai = make(async (req) => {
      calls++;
      const ids = idsIn(req.contents, 'id');
      return { text: JSON.stringify({ clusters: ids.map((id) => ({ itemIds: [id], relevance: 9, tags: [] })) }) };
    }, budget);
    for (let i = 0; i < 3; i++) await ai.triage([item(`i${i}`, `Story ${i}`)], [], {});
    expect(calls).toBe(2);
    expect(budget.remaining).toBe(2);
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

  it('summarize chunks by 10 and drops unknown cluster ids', async () => {
    let calls = 0;
    const ai = make(async (req) => {
      calls++;
      const stories: object[] = idsIn(req.contents, 'clusterId').map((id) => ({
        clusterId: id,
        tldr: 'tl',
        keyPoints: ['k'],
        whyItMatters: 'w',
        tags: ['x'],
      }));
      stories.push({ clusterId: 'ghost', tldr: 'g', keyPoints: [], whyItMatters: '', tags: [] });
      return { text: JSON.stringify({ stories }) };
    });
    const stories: StoryInput[] = Array.from({ length: 12 }, (_, i) => ({
      clusterId: `c${i}`,
      items: [item(`i${i}`, 't')],
      text: 'body',
    }));
    const out = await ai.summarize(stories);
    expect(calls).toBe(2);
    expect(out.map((s) => s.clusterId)).toEqual(stories.map((s) => s.clusterId));
  });

  it('summarize returns what it has when the budget runs out', async () => {
    const ai = make(async (req) => {
      const stories = idsIn(req.contents, 'clusterId').map((id) => ({
        clusterId: id,
        tldr: 't',
        keyPoints: [],
        whyItMatters: 'w',
        tags: [],
      }));
      return { text: JSON.stringify({ stories }) };
    }, freeBudget(1));
    const stories: StoryInput[] = Array.from({ length: 12 }, (_, i) => ({ clusterId: `c${i}`, items: [], text: '' }));
    expect(await ai.summarize(stories)).toHaveLength(10);
  });
});
});

describe('dedupe', () => {
const item = (id: string, title: string): RawItem => ({ id, sourceId: 's', siteName: 'S', title, url: `https://x.dev/${id}`, snippet: '' });

it('normalizes urls', () => {
  expect(normalizeUrl('https://www.Example.com/a/?utm_source=x&b=2&a=1#top')).toBe('https://example.com/a?a=1&b=2');
  expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  expect(normalizeUrl('https://example.com/p?fbclid=1&ref=hn')).toBe('https://example.com/p');
});

it('returns invalid urls unchanged', () => {
  expect(normalizeUrl('not a url')).toBe('not a url');
});

it('computes jaccard similarity', () => {
  expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  expect(jaccard(new Set(), new Set())).toBe(0);
});

it('drops stopwords and short words but keeps version numbers', () => {
  expect([...titleTokens('The Angular 22 is out with a new API')]).toEqual(['angular', '22', 'new', 'api']);
});

it('clusters similar titles', () => {
  const items = [
    item('i0', 'Angular 22 released with zoneless default'),
    item('i1', 'Angular 22 released: zoneless by default'),
    item('i2', 'Node 26 LTS'),
  ];
  const clusters = clusterByTitle(items);
  expect(clusters.map((c) => c.length).sort()).toEqual([1, 2]);
  expect(clusters.find((c) => c.length === 2)).toEqual(['i0', 'i1']);
});

it('matches existing recent posts', () => {
  const recent = [{ id: 'p1', title: 'Angular 22 released, zoneless default' }];
  expect(matchExisting('Angular 22 is released with zoneless', recent)).toBe('p1');
  expect(matchExisting('Bun 2.0', [{ id: 'p1', title: 'Angular 22 released' }])).toBeUndefined();
});

it('keeps different versions apart', () => {
  expect(clusterByTitle([item('i0', 'Angular 21 released'), item('i1', 'Angular 22 released')])).toHaveLength(2);
});
});

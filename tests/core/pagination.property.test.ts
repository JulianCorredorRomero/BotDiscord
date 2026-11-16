import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { formatDuration, formatQueuePage, paginateQueue } from '../../src/core/volume-format.js';

const trackArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 30 }),
  durationSec: fc.nat({ max: 36000 }),
  thumbnailUrl: fc.constant('https://i.ytimg.com/vi/x/0.jpg'),
});

describe('paginateQueue property', () => {
  // Feature: discord-music-bot, Property 10: Paginación de /queue
  // **Validates: Requirements 2.13**
  it('pages have <=10 items, ceil(n/10) pages, concatenation keeps order with positions from 1, text has details', () => {
    fc.assert(
      fc.property(fc.array(trackArb, { minLength: 1, maxLength: 120 }), (queue) => {
        const n = queue.length;
        const expectedPages = Math.ceil(n / 10);
        const all: Array<{ position: number; track: (typeof queue)[number] }> = [];

        for (let p = 1; p <= expectedPages; p++) {
          const page = paginateQueue(queue, p);
          expect(page.totalPages).toBe(expectedPages);
          expect(page.page).toBe(p);
          expect(page.items.length).toBeLessThanOrEqual(10);
          expect(page.items.length).toBeGreaterThan(0);
          all.push(...page.items);

          const text = formatQueuePage(page);
          for (const { position, track } of page.items) {
            expect(text).toContain(`${position}. ${track.title} (${formatDuration(track.durationSec)})`);
          }
          expect(text).toContain(`Página ${p}/${expectedPages}`);
        }

        expect(all.length).toBe(n);
        all.forEach((it, i) => {
          expect(it.position).toBe(i + 1);
          expect(it.track).toBe(queue[i]);
        });
      }),
      { numRuns: 100 },
    );
  });
});

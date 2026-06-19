import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TopNav } from './TopNav';

// spec: docs/specs/section-navigation.md §Behaviour.2,4,6

describe('TopNav', () => {
  it('exposes all four sections plus History and Question Bank in a consistent order', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TopNav />
      </MemoryRouter>,
    );
    expect(html).toContain('Reading');
    expect(html).toContain('Listening');
    expect(html).toContain('Writing');
    expect(html).toContain('Speaking');
    expect(html).toContain('History');
    expect(html).toContain('Question Bank');
    // Full consistent order Reading < Listening < Writing < Speaking < History (§Behaviour.6).
    const order = ['Reading', 'Listening', 'Writing', 'Speaking', 'History'].map((s) =>
      html.indexOf(s),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('marks the active section with aria-current', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TopNav active="writing" />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-current="page"');
  });
});

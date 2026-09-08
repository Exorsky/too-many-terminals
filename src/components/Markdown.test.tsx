import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc');
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' }),
  },
}));

import * as ipc from '@/lib/ipc';
import Markdown from './Markdown';

beforeAll(() => {
  // jsdom has no layout, so nothing implements this.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Markdown, on the punctuation that used to break links', () => {
  it('keeps parentheses that belong to the URL', () => {
    render(<Markdown source="[wiki](https://en.wikipedia.org/wiki/Foo_(bar))" />);
    expect(screen.getByRole('link', { name: 'wiki' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    );
  });

  it('keeps brackets inside the link text', () => {
    render(<Markdown source="[a [b] c](x.md)" />);
    expect(screen.getByRole('link', { name: 'a [b] c' })).toHaveAttribute('href', 'x.md');
  });

  it('does not swallow a link title into the href', () => {
    render(<Markdown source={'[a](x.md "the title")'} />);
    expect(screen.getByRole('link', { name: 'a' })).toHaveAttribute('href', 'x.md');
  });

  it('renders formatting inside a link instead of showing the markers', () => {
    render(<Markdown source="[**bold**](x.md)" />);
    expect(screen.getByRole('link', { name: 'bold' }).querySelector('strong')).not.toBeNull();
  });

  it('renders headings past level three', () => {
    render(<Markdown source="#### Deep heading" />);
    expect(screen.getByRole('heading', { level: 4, name: 'Deep heading' })).toHaveAttribute('id', 'deep-heading');
  });

  it('renders GitHub extensions — task lists and strikethrough', () => {
    const { container } = render(<Markdown source={'- [x] done\n- [ ] todo\n\n~~gone~~'} />);
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(container.querySelector('del')?.textContent).toBe('gone');
  });
});

describe('Markdown links', () => {
  it('hands a web link to the OS', async () => {
    render(<Markdown source="[site](https://example.com)" />);
    await userEvent.click(screen.getByRole('link', { name: 'site' }));
    expect(ipc.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('reports a file link instead of opening it as a URL', async () => {
    const onOpenLink = vi.fn();
    render(<Markdown source="[arch](docs/architecture.md)" onOpenLink={onOpenLink} />);
    await userEvent.click(screen.getByRole('link', { name: 'arch' }));
    expect(onOpenLink).toHaveBeenCalledWith('docs/architecture.md');
    expect(ipc.openExternal).not.toHaveBeenCalled();
  });

  it('scrolls to a heading for an in-page anchor', async () => {
    const onOpenLink = vi.fn();
    render(<Markdown source={'## The rail\n\n[jump](#the-rail)'} onOpenLink={onOpenLink} />);
    await userEvent.click(screen.getByRole('link', { name: 'jump' }));
    expect(onOpenLink).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'The rail' }).scrollIntoView).toBeDefined();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe('Markdown code fences', () => {
  it('renders a mermaid fence as a diagram', async () => {
    render(<Markdown source={'```mermaid\ngraph TD;\nA-->B;\n```'} />);
    expect(await screen.findByTestId('diagram')).toBeInTheDocument();
  });

  it('keeps a normal fence as code, with its language label', async () => {
    const { container } = render(<Markdown source={'```rust\nfn main() {}\n```'} />);
    await waitFor(() => expect(container.querySelector('pre')?.textContent).toBe('fn main() {}'));
    expect(screen.getByText('rust')).toBeInTheDocument();
  });
});

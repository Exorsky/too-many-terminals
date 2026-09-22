import { describe, expect, it } from 'vitest';
import {
  bySessionOrder, compactAge, learnSessionNames, matchesQuery, recencyOf, restoreTab,
  STATE_DOT,
  sessionState, shellPtyId, toSavedTab,
} from './sessions';
import type { SavedTab, Tab } from '@/types';

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'a',
    kind: 'claude',
    name: 'Session',
    shellId: null,
    cwd: '/proj',
    projectDir: '/proj',
    resumeSessionId: null,
    exited: false,
    status: 'idle',
    ...overrides,
  };
}

describe('sessionState', () => {
  it('maps the four Claude statuses onto the four the UI shows', () => {
    expect(sessionState(tab({ status: 'working' }))).toBe('running');
    expect(sessionState(tab({ status: 'requires_response' }))).toBe('attention');
    expect(sessionState(tab({ status: 'idle' }))).toBe('idle');
    expect(sessionState(tab({ status: 'new' }))).toBe('idle');
  });

  it('never calls a session with no process behind it running', () => {
    // The row would otherwise promise activity that cannot happen: the pty is
    // gone, so "working" is a stale reading, not a state.
    expect(sessionState(tab({ status: 'working', dormant: true }))).toBe('asleep');
    expect(sessionState(tab({ status: 'working', exited: true }))).toBe('muted');
    expect(sessionState(tab({ status: 'working', archived: true }))).toBe('muted');
  });

  it('separates a restored session from a dead one', () => {
    // A workspace reopened with twenty sessions is entirely the first kind.
    // Folding both into one grey dot is what made the list look statusless.
    expect(sessionState(tab({ dormant: true }))).toBe('asleep');
    expect(sessionState(tab({ exited: true }))).toBe('muted');
    expect(sessionState(tab({ status: 'new' }))).not.toBe('asleep');
  });

  it('treats a shell session as idle — it has no Claude status', () => {
    expect(sessionState(tab({ kind: 'shell', status: 'new' }))).toBe('idle');
  });
});

describe('restoreTab', () => {
  const saved = (o: Partial<SavedTab> = {}): SavedTab => ({
    kind: 'claude', name: 'Alpha', shellId: null, resumeSessionId: 's1', cwd: '/proj', ...o,
  });

  it('takes projectDir at face value — the backend already migrated it', () => {
    // Deriving it here too was the bug: serde hands a missing Option<String>
    // over as `null`, which is indistinguishable from an explicit Inbox once
    // it has crossed IPC. See `workspace::migrate`.
    expect(restoreTab(saved({ projectDir: '/proj' })).projectDir).toBe('/proj');
    expect(restoreTab(saved({ projectDir: null })).projectDir).toBeNull();
    expect(restoreTab(saved()).projectDir).toBeNull();
  });

  it('keeps a saved id and mints one when there is none', () => {
    expect(restoreTab(saved({ id: 'keep-me' })).id).toBe('keep-me');
    expect(restoreTab(saved({ id: '' })).id).not.toBe('');
  });

  it('comes back dormant, so restoring N sessions launches no processes', () => {
    expect(restoreTab(saved()).dormant).toBe(true);
  });

  it('round-trips through toSavedTab', () => {
    const original = tab({ id: 'x', projectDir: null, archived: true, pinned: true, cwd: '/scratch' });
    expect(restoreTab(toSavedTab(original))).toMatchObject({
      id: 'x', projectDir: null, archived: true, pinned: true, cwd: '/scratch',
    });
  });
});

describe('bySessionOrder', () => {
  it('holds pinned sessions above everything, then sorts by recency', () => {
    const old = tab({ id: 'old', createdAt: 1_000 });
    const fresh = tab({ id: 'fresh', createdAt: 9_000 });
    const pinned = tab({ id: 'pinned', createdAt: 5, pinned: true });
    const sorted = [old, fresh, pinned].sort(bySessionOrder(new Map()));
    expect(sorted.map((t) => t.id)).toEqual(['pinned', 'fresh', 'old']);
  });

  it('uses a transcript mtime for a restored session with no clock of its own', () => {
    const restored = tab({ id: 'restored', resumeSessionId: 's1' });
    const thisRun = tab({ id: 'this-run', createdAt: 1_000 });
    const lastUsed = new Map([['s1', 50_000]]);
    expect([thisRun, restored].sort(bySessionOrder(lastUsed)).map((t) => t.id))
      .toEqual(['restored', 'this-run']);
  });
});

describe('recencyOf', () => {
  it('takes whichever of the three clocks is freshest', () => {
    expect(recencyOf(tab({ createdAt: 5, statusChangedAt: 90 }), 40)).toBe(90);
    expect(recencyOf(tab({ createdAt: 5 }), 400)).toBe(400);
    expect(recencyOf(tab())).toBe(0);
  });
});

describe('matchesQuery', () => {
  const t = tab({ name: 'Analyze 429 errors', cwd: '/home/u/work/api', projectDir: '/home/u/work/api' });

  it('matches on name, project path and directory', () => {
    expect(matchesQuery(t, '429')).toBe(true);
    expect(matchesQuery(t, 'API')).toBe(true);
    expect(matchesQuery(t, 'work')).toBe(true);
    expect(matchesQuery(t, 'nginx')).toBe(false);
  });

  it('finds an unfiled session by the word Inbox', () => {
    expect(matchesQuery(tab({ projectDir: null }), 'inbox')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(matchesQuery(t, '   ')).toBe(true);
  });
});

describe('compactAge', () => {
  const now = 1_000_000_000;
  it('drops to the coarsest useful unit', () => {
    expect(compactAge(now - 30_000, now)).toBe('now');
    expect(compactAge(now - 5 * 60_000, now)).toBe('5m');
    expect(compactAge(now - 3 * 3_600_000, now)).toBe('3h');
    expect(compactAge(now - 2 * 86_400_000, now)).toBe('2d');
  });

  it('says nothing at all when there is no clock', () => {
    expect(compactAge(undefined, now)).toBe('');
    expect(compactAge(0, now)).toBe('');
  });
});

describe('learnSessionNames', () => {
  it('records a real name against its Claude session id', () => {
    const next = learnSessionNames({}, [tab({ resumeSessionId: 's1', name: 'Fixing history' })]);
    expect(next).toEqual({ s1: 'Fixing history' });
  });

  it('ignores the placeholder name, so it never becomes a session title', () => {
    expect(learnSessionNames({}, [tab({ resumeSessionId: 's1', name: 'Claude' })])).toEqual({});
  });

  it('returns the same object when nothing is new', () => {
    const prev = { s1: 'Fixing history' };
    expect(learnSessionNames(prev, [tab({ resumeSessionId: 's1', name: 'Fixing history' })])).toBe(prev);
  });
});

describe('shellPtyId', () => {
  it('derives a session shell id that cannot collide with a session id', () => {
    expect(shellPtyId('abc')).toBe('abc::shell');
  });
});

describe('STATE_DOT', () => {
  it('draws the quiet states off muted-foreground, not off a border token', () => {
    // A border colour sits a hair above the background by design — it is there
    // to separate surfaces. A *dot* made of one reads as absent rather than as
    // quiet, which is how "closed" ended up at 1.2:1 against the app ground.
    for (const state of ['asleep', 'muted'] as const) {
      expect(STATE_DOT[state]).not.toMatch(/border-border/);
      expect(STATE_DOT[state]).toMatch(/border-muted-foreground\/\d+/);
    }
  });

  it('keeps the three quiet states in descending order', () => {
    const alpha = (cls: string) => Number(cls.match(/muted-foreground\/(\d+)/)?.[1]);
    expect(alpha(STATE_DOT.idle)).toBeGreaterThan(alpha(STATE_DOT.asleep));
    expect(alpha(STATE_DOT.asleep)).toBeGreaterThan(alpha(STATE_DOT.muted));
  });

  it('gives the two loud states a second cue beyond hue', () => {
    // 10% of readers cannot separate the green from the yellow; the pulse and
    // the ring are what carry the difference for them.
    expect(STATE_DOT.running).toContain('animate-pulse');
    expect(STATE_DOT.attention).toContain('ring-2');
  });
});

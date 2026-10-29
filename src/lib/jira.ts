/**
 * Jira issue keys, wherever they show up: session names, terminal output,
 * transcripts. One detector, one URL rule, one cached read-only lookup.
 * See docs/features/jira-links.md.
 */
import { useSyncExternalStore } from 'react';
import * as ipc from './ipc';
import type { JiraIssue, JiraIssueDetail } from './ipc';
import type { AppSettings } from '@/types';

/** `ABC-123`. The project part is 2–10 uppercase letters/digits starting with a
 *  letter; the number never starts with 0. */
const KEY_RE = /\b([A-Z][A-Z0-9]{1,9})-([1-9]\d{0,6})\b/g;

/** Whether Jira links and lookups are on: switched on, with a URL to go to. */
export function jiraOn(s: Pick<AppSettings, 'jiraEnabled' | 'jiraBaseUrl'>): boolean {
  return s.jiraEnabled && s.jiraBaseUrl !== '';
}

export interface IssueMatch {
  key: string;
  index: number;
}

/** Every issue key in `text` from one of `projects`. No projects, no keys:
 *  without the list, `UTF-8` and `SHA-256` are issue keys too — and every
 *  hover over one would be a wasted request to a rate-limited Jira. */
export function findIssueKeys(text: string, projects: string[]): IssueMatch[] {
  const out: IssueMatch[] = [];
  if (!projects.length) return out;
  for (const m of text.matchAll(KEY_RE)) {
    if (!projects.includes(m[1])) continue;
    out.push({ key: m[0], index: m.index! });
  }
  return out;
}

export function firstIssueKey(text: string, projects: string[]): string | null {
  return findIssueKeys(text, projects)[0]?.key ?? null;
}

/** A session name with its key lifted out, so the chip beside it isn't the
 *  same words twice: "PROJ-4821 · Fix alert noise" → "Fix alert noise". */
export function stripIssueKey(name: string, key: string): string {
  const rest = name.replace(key, '').replace(/^[\s·:|\-–—[\]()]+|[\s·:|\-–—[\]()]+$/g, '').trim();
  return rest || name;
}

export function issueUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/browse/${key}`;
}

/** A key typed or pasted into New session: a bare key, or any Jira URL that
 *  carries one (`/browse/KEY`, `selectedIssue=KEY`). */
export function parseIssueInput(input: string, projects: string[]): string | null {
  // Upper-cased so a key typed in lowercase still counts; a URL's own parts
  // never look like `ABC-123`.
  return firstIssueKey(input.trim().toUpperCase(), projects);
}

// --- lookups --------------------------------------------------------------

const TTL_MS = 10 * 60 * 1000;
/** A failure is remembered too, briefly — otherwise a 404 or an off-VPN
 *  timeout would cost a request on every hover of that key. */
const FAILURE_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; promise: Promise<JiraIssue> }>();

/** One issue, cached for ten minutes. Concurrent asks for the same key share
 *  one request (the promise is cached before it settles). Jira's rate limit is
 *  watched closely, so the backend also pauses all requests after a 429 or a
 *  refused token — see `src-tauri/src/jira.rs`. */
export function fetchIssue(key: string): Promise<JiraIssue> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const promise = ipc.jiraIssue(key);
  const entry = { at: Date.now(), ttl: TTL_MS, promise };
  cache.set(key, entry);
  promise.catch(() => { entry.ttl = FAILURE_TTL_MS; });
  return promise;
}

const details = new Map<string, { at: number; ttl: number; promise: Promise<JiraIssueDetail> }>();

/** An issue's description and latest comment, cached like `fetchIssue`. */
export function fetchIssueDetail(key: string): Promise<JiraIssueDetail> {
  const hit = details.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  const promise = ipc.jiraIssueDetail(key);
  const entry = { at: Date.now(), ttl: TTL_MS, promise };
  details.set(key, entry);
  promise.catch(() => { entry.ttl = FAILURE_TTL_MS; });
  return promise;
}

const MINE_TTL_MS = 5 * 60 * 1000;
/** Refresh can't ask more often than this, however fast it's clicked. */
const MINE_FLOOR_MS = 30 * 1000;
let mine: { at: number; tokenVar: string; promise: Promise<JiraIssue[]> } | null = null;

/** Your open issues: one search, reused for five minutes — 30 seconds when
 *  `fresh` (Refresh) — so opening the view again doesn't ask again. Keyed by
 *  the token variable: another token is another "you". Each result also fills
 *  the per-issue cache, so hovering a key from the list costs nothing. */
export function fetchMyIssues(tokenVar: string, fresh = false): Promise<JiraIssue[]> {
  const ttl = fresh ? MINE_FLOOR_MS : MINE_TTL_MS;
  if (mine && mine.tokenVar === tokenVar && Date.now() - mine.at < ttl) return mine.promise;
  const promise = ipc.jiraMyIssues();
  const entry = { at: Date.now(), tokenVar, promise };
  mine = entry;
  promise.then(
    (issues) => { for (const i of issues) cache.set(i.key, { at: entry.at, ttl: TTL_MS, promise: Promise.resolve(i) }); },
    // A failure isn't kept: the next open (or Refresh) asks again.
    () => { if (mine === entry) mine = null; },
  );
  return promise;
}

/** Test-only. */
export function clearIssueCache(): void {
  cache.clear();
  details.clear();
  mine = null;
}

// --- the hover card -------------------------------------------------------

export interface IssueCardState {
  key: string;
  x: number;
  y: number;
}

let card: IssueCardState | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** Ask for the card at a screen point. Waits 300ms like every other hover
 *  surface in the app — including when a card is already open for another
 *  key: each new key is a Jira request, so sweeping the pointer across a
 *  column of keys must only cost one for the key it stops on. */
export function showIssueCard(key: string, x: number, y: number): void {
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  if (card?.key === key) return;
  showTimer = setTimeout(() => { card = { key, x, y }; emit(); }, 300);
}

/** Close after a short grace, so the pointer can travel onto the card. */
export function hideIssueCard(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { card = null; emit(); }, 150);
}

/** The card's own hover keeps it open. */
export function holdIssueCard(): void {
  clearTimeout(hideTimer);
}

export function useIssueCard(): IssueCardState | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => card,
    () => card,
  );
}

// --- Markdown -------------------------------------------------------------

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/** A remark plugin turning issue keys in prose into links. Code spans and
 *  blocks carry `value`, not children, so they're never touched; neither is the
 *  text of an existing link. */
export function remarkIssueLinks({ base, projects }: { base: string; projects: string[] }) {
  const split = (text: string): MdNode[] => {
    const out: MdNode[] = [];
    let at = 0;
    for (const { key, index } of findIssueKeys(text, projects)) {
      if (index > at) out.push({ type: 'text', value: text.slice(at, index) });
      out.push({ type: 'link', url: issueUrl(base, key), children: [{ type: 'text', value: key }] });
      at = index + key.length;
    }
    if (at < text.length) out.push({ type: 'text', value: text.slice(at) });
    return out;
  };
  const walk = (node: MdNode) => {
    if (!node.children || node.type === 'link' || node.type === 'linkReference') return;
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text' && child.value) return split(child.value);
      walk(child);
      return [child];
    });
  };
  return () => (tree: MdNode) => { if (base) walk(tree); };
}

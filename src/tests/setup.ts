import '@testing-library/jest-dom/vitest';

// jsdom implements neither `PointerEvent` nor the pointer-capture API. Radix
// probes both before it will open a menu, so without this shim every dropdown
// and context menu in the app is untestable: the trigger receives the event
// and silently does nothing. `scrollIntoView` is the same story for any list
// that keeps its selection in view.
class PointerEventShim extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, props: PointerEventInit = {}) {
    super(type, props);
    this.pointerId = props.pointerId ?? 1;
    this.pointerType = props.pointerType ?? 'mouse';
    this.isPrimary = props.isPrimary ?? true;
  }
}

if (!('PointerEvent' in globalThis)) {
  (globalThis as { PointerEvent?: unknown }).PointerEvent = PointerEventShim;
}
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// Node 25 exposes an experimental `localStorage` global of its own, and it wins
// over jsdom's. Run without `--localstorage-file` it is a stub with no `clear`,
// which breaks any test that resets storage between cases. Swap in a real
// in-memory Storage when what we've got isn't one.
if (typeof localStorage === 'undefined' || typeof localStorage.clear !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => store.get(String(k)) ?? null,
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });
}

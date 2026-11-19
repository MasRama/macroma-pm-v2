import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STREAM_ENDED_EVENT, STREAM_READY_EVENT } from '../protocol';

/** A stand-in EventSource the test drives by hand. */
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;

  constructor() {
    super();
    FakeEventSource.opened.push(this);
  }

  emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

// The module keeps one stream per page, so every test loads a fresh copy.
let realtime: typeof import('../browser');
const latest = () => FakeEventSource.opened.at(-1)!;

beforeEach(async () => {
  FakeEventSource.opened = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.resetModules();
  realtime = await import('../browser');
});

afterEach(() => {
  realtime.disconnectServerEvents();
  vi.unstubAllGlobals();
});

describe('browser event stream', () => {
  it('runs every handler with resumed: true once a stream the server ended opens again', () => {
    const handler = vi.fn();
    realtime.onServerEvent('auth.tokens-changed', handler);
    realtime.connectServerEvents();
    latest().emit(STREAM_READY_EVENT);

    // A password change ends the stream; the application opens a new one once the session holds.
    latest().emit(STREAM_ENDED_EVENT);
    realtime.connectServerEvents();
    expect(FakeEventSource.opened).toHaveLength(2);
    latest().emit(STREAM_READY_EVENT);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ resumed: true });
  });

  it('runs no handler when the first stream of the page opens', () => {
    const handler = vi.fn();
    realtime.onServerEvent('auth.tokens-changed', handler);
    realtime.connectServerEvents();
    latest().emit(STREAM_READY_EVENT);

    expect(handler).not.toHaveBeenCalled();
  });
});

// SP1 chat — auto-scroll "stick to bottom" hook (multimedia-chat-sp1-plan §7).
//
// Chat streams tokens into a growing scroll container. While the user is pinned
// to the bottom, every new chunk should keep the latest text in view. The
// moment the user scrolls UP to read history, auto-follow disengages so we don't
// yank them back down mid-read. A "Jump to latest" affordance re-engages it.
//
// Usage:
//   const { scrollRef, isPinned, jumpToLatest, onScroll } = useStickToBottom([deps]);
//   <div ref={scrollRef} onScroll={onScroll}> … </div>
//   {!isPinned && <button onClick={jumpToLatest}>Jump to latest</button>}
//
// `deps` is whatever changes when content grows (e.g. the streaming text length
// + message count); the effect re-runs and, if pinned, scrolls to the bottom.

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

// Treat "within this many px of the bottom" as pinned — exact equality is
// fragile with sub-pixel layout + fractional scroll positions.
const BOTTOM_THRESHOLD_PX = 24;

export interface StickToBottom {
  /** Attach to the scrollable container. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** True when auto-follow is engaged (user is at/near the bottom). */
  isPinned: boolean;
  /** Re-engage auto-follow and scroll to the newest content. */
  jumpToLatest: () => void;
  /** Attach to the container's onScroll — updates pinned state on manual scroll. */
  onScroll: () => void;
}

function atBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
}

/**
 * Auto-scroll-to-bottom while pinned. `contentDeps` should change whenever the
 * content height grows (new token, new message) so the scroll effect re-runs.
 */
export function useStickToBottom(contentDeps: DependencyList): StickToBottom {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  // Mirror of isPinned readable synchronously inside the layout effect without
  // adding it to the dep array (which would re-run on every pin toggle).
  const pinnedRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pinned = atBottom(el);
    pinnedRef.current = pinned;
    setIsPinned(pinned);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setIsPinned(true);
  }, []);

  // After content grows, if the user is still pinned, follow to the bottom.
  // useEffect (post-paint) is fine here — the container is short and the visual
  // jump is imperceptible; useLayoutEffect would also work but isn't required.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, contentDeps);

  return { scrollRef, isPinned, jumpToLatest, onScroll };
}

import { useEffect, useRef, useState } from 'react';

interface ViewportMetrics {
  height: number | undefined;
  top: number;
}

// Tracks the visual viewport's size AND scroll offset. The visual viewport shrinks when the
// on-screen keyboard opens, and also *pans* (offsetTop changes) when iOS auto-scrolls to keep a
// newly focused input visible above the keyboard — independently of the document's own scroll
// position. A sheet pinned with `top-0` only accounts for the shrink, not the pan: once the
// visual viewport pans down, the sheet's box stays where it was in the layout viewport, so it
// visually "floats" above where the keyboard-adjusted screen actually is, exposing page content
// above it. Modals need both height and top from this hook to stay glued to the real visible area.
export function useVisualViewport(): ViewportMetrics {
  const [metrics, setMetrics] = useState<ViewportMetrics>(() => ({
    height: window.visualViewport?.height,
    top: window.visualViewport?.offsetTop ?? 0
  }));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => setMetrics({ height: vv.height, top: vv.offsetTop });
    update();

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    // iOS doesn't reliably fire visualViewport's own resize/scroll events right when the keyboard
    // first appears or when focus moves straight from one field to another with the keyboard
    // already up, which can leave this hook reporting stale (wrong height and/or offset) values.
    // Re-measure a few times as the keyboard animates in/out and the viewport pans on every focus
    // change, as a backstop.
    const clearTimers = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const onFocusChange = () => {
      clearTimers();
      update();
      timers.current = [50, 150, 350].map(delay => setTimeout(update, delay));
    };
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusin', onFocusChange);
      document.removeEventListener('focusout', onFocusChange);
      clearTimers();
    };
  }, []);

  return metrics;
}

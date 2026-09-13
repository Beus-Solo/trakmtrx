import { useEffect, useState } from 'react';

interface ViewportMetrics {
  height: number | undefined;
  top: number;
}

// How long to keep re-measuring after anything that could move the viewport. The keyboard
// animation plus Safari collapsing its toolbar can take well over half a second to settle.
const SETTLE_MS = 1000;

// Tracks the visual viewport's size AND scroll offset. The visual viewport shrinks when the
// on-screen keyboard opens, and also pans (offsetTop changes) when iOS scrolls a focused input
// into view on a page that can't scroll itself. Modals need both to stay glued to the visible area.
export function useVisualViewport(): ViewportMetrics {
  const [metrics, setMetrics] = useState<ViewportMetrics>(() => ({
    height: window.visualViewport?.height,
    top: window.visualViewport?.offsetTop ?? 0
  }));

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let rafId = 0;
    let settleUntil = 0;

    const measure = () =>
      setMetrics(prev =>
        prev.height === vv.height && prev.top === vv.offsetTop
          ? prev
          : { height: vv.height, top: vv.offsetTop }
      );

    // iOS fires visualViewport's events erratically while the keyboard animates, and frequently
    // stops firing before it has finished — leaving a stale, mid-animation height that renders the
    // sheet short of the keyboard with a gap under it. Sampling every frame for a moment after any
    // event that could move the viewport means the final resting measurement always wins.
    const tick = () => {
      measure();
      rafId = performance.now() < settleUntil ? requestAnimationFrame(tick) : 0;
    };
    const resettle = () => {
      settleUntil = performance.now() + SETTLE_MS;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    measure();
    vv.addEventListener('resize', resettle);
    vv.addEventListener('scroll', resettle);
    document.addEventListener('focusin', resettle);
    document.addEventListener('focusout', resettle);

    return () => {
      vv.removeEventListener('resize', resettle);
      vv.removeEventListener('scroll', resettle);
      document.removeEventListener('focusin', resettle);
      document.removeEventListener('focusout', resettle);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return metrics;
}

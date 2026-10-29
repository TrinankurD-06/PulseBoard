import { useEffect, useRef, useState } from 'react';

/**
 * Renders `children` only once the placeholder is near the viewport, so heavy
 * sections far below the fold (charts) don't cost anything until the reader
 * scrolls towards them. The placeholder keeps `minHeight` so the page doesn't
 * jump. Without IntersectionObserver (old browsers, tests) it renders at once.
 */
export default function LazyOnView({ children, minHeight = '24rem', rootMargin = '400px 0px' }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen, rootMargin]);

  if (seen) return children;
  return <div ref={ref} style={{ minHeight }} aria-hidden="true" />;
}

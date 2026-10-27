import { Suspense, lazy } from 'react';

const SignalField = lazy(() => import('./SignalField.jsx'));

/**
 * Loads the field in its own chunk, so the page text paints first. The
 * placeholder has the field's height, so nothing shifts when it arrives.
 */
export default function SignalFieldLazy({ height = 280, className = '', ...props }) {
  return (
    <Suspense
      fallback={<div className={`w-full ${className}`} style={{ height }} aria-hidden="true" />}
    >
      <SignalField height={height} className={className} {...props} />
    </Suspense>
  );
}

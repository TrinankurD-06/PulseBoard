import { Component } from 'react';
import ErrorPage from './ErrorPage.jsx';

/**
 * Catches a crash while rendering a page and shows the error screen instead of a
 * blank page. Resets when `resetKey` (the route) changes, so navigating away
 * recovers. The crash screen is the plain one: it must not rely on the session or
 * the app shell, which may be what failed.
 */
export default class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorPage
        plain
        code="500"
        title="Something went wrong."
        message="An unexpected error stopped this page from loading. Reloading usually fixes it."
        action={{ label: 'Reload PulseBoard', href: '/' }}
      />
    );
  }
}

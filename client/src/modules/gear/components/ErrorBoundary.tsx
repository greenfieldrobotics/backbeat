import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Per-page error boundary (§6.1 / convergence task 7). An app-wide boundary is separate,
// out-of-scope work — this wraps each Gear page individually so a render error on one
// page doesn't take down the rest of the app shell.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Gear page crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="alert alert-error">
          <p>Something went wrong loading this page.</p>
          <p>{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

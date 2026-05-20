import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="bg-surface-1 border border-border-subtle rounded-xl p-8 max-w-md text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
                <AlertTriangle size={24} className="text-error" />
              </div>
            </div>
            <h3 className="text-lg font-semibold text-gray-100">Something went wrong</h3>
            <p className="text-sm text-gray-400">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors text-sm font-medium"
            >
              <RotateCcw size={14} />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Route-level error component for TanStack Router */
export function RouteErrorComponent({ error, reset }) {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="bg-surface-1 border border-border-subtle rounded-xl p-8 max-w-md text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
            <AlertTriangle size={24} className="text-error" />
          </div>
        </div>
        <h3 className="text-lg font-semibold text-gray-100">Something went wrong</h3>
        <p className="text-sm text-gray-400">
          {error?.message || 'An unexpected error occurred while loading this page.'}
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors text-sm font-medium"
        >
          <RotateCcw size={14} />
          Try Again
        </button>
      </div>
    </div>
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  label: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  details: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, details: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ details: info.componentStack ?? null });
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null, details: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error, details } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <div className="crash" role="alert">
        <h2 className="crash__title">{this.props.label} stopped responding</h2>
        <p className="crash__message">{error.message || 'An unexpected error occurred.'}</p>

        <div className="crash__actions">
          <button type="button" onClick={this.reset}>
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(
                [`${this.props.label}: ${error.message}`, error.stack, details]
                  .filter(Boolean)
                  .join('\n\n'),
              );
            }}
          >
            Copy details
          </button>
        </div>

        {error.stack ? (
          <details className="crash__stack">
            <summary>Technical details</summary>
            <pre>{error.stack}</pre>
          </details>
        ) : null}
      </div>
    );
  }
}

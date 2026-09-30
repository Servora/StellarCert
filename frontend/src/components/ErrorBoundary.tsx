import { Component, ErrorInfo, ReactNode, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * Invoked after the boundary clears its own error state.
   *
   * A `React.lazy` import that rejects (chunk missing after a deploy, bad
   * module specifier, offline) is cached by React, so re-rendering the same
   * lazy component re-throws the original error. Callers that know their child
   * is a lazy chunk can use this hook to recover properly — e.g. reload the
   * page to pick up the current asset manifest.
   */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  message: string;
}

class ErrorBoundaryImpl extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  private reset = () => {
    const { onReset } = this.props;
    this.setState({ hasError: false, message: "" });
    onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
          <h2 className="text-2xl font-semibold text-red-600 mb-2">Something went wrong</h2>
          <p className="text-gray-500 mb-4">{this.state.message || "An unexpected error occurred."}</p>
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={this.reset}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children, fallback, onReset }: Props) {
  const location = useLocation();
  const [key, setKey] = useState(0);

  // Reset error boundary when route changes
  useEffect(() => {
    setKey((k) => k + 1);
  }, [location.pathname]);

  return (
    <ErrorBoundaryImpl key={key} fallback={fallback} onReset={onReset}>
      {children}
    </ErrorBoundaryImpl>
  );
}

export default ErrorBoundary;

import { Banner, FilledButton } from "@neo4j-ndl/react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "Unhandled error while rendering",
      error,
      info.componentStack,
    );
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="ndl-theme-light fatal-error">
        <Banner variant="danger" isAlert hasIcon>
          <Banner.Header>The app ran into a problem</Banner.Header>
          <Banner.Description>{error.message}</Banner.Description>
        </Banner>
        <FilledButton onClick={() => window.location.reload()}>
          Reload
        </FilledButton>
      </div>
    );
  }
}

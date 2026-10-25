import React from 'react';
import { AlertTriangle, Check, Copy, RotateCcw, X } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorText: string;
  copied: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorText: '',
      copied: false,
    };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    const msg =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack || ''}`
        : String(error);
    return { hasError: true, errorText: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const msg =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${info.componentStack || ''}`
        : String(error);
    this.setState({ hasError: true, errorText: msg });
  }

  handleCopy = () => {
    try {
      navigator.clipboard.writeText(this.state.errorText);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            paddingTop: 'max(env(safe-area-inset-top, 0px), 32px)',
            paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
            paddingLeft: 'max(env(safe-area-inset-left, 0px), 16px)',
            paddingRight: 'max(env(safe-area-inset-right, 0px), 16px)',
          }}
          className="h-[100dvh] w-full bg-[#070A10] text-slate-100 flex items-center justify-center overflow-y-auto"
        >
          <div className="w-full max-w-md bg-rose-950/95 border-2 border-rose-500 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-rose-200 font-bold text-base">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>ClipNova Runtime Error Caught</span>
            </div>
            <p className="text-xs text-rose-200/90 leading-relaxed">
              An unexpected error occurred. Your saved projects in device storage are safe.
            </p>
            <pre className="p-3 rounded-xl bg-black/60 border border-rose-500/40 text-xs font-mono text-rose-200 overflow-x-auto max-h-48 whitespace-pre-wrap break-words">
              {this.state.errorText}
            </pre>
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={this.handleCopy}
                aria-label="Copy error details"
                className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5"
              >
                {this.state.copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy error</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, errorText: '' })}
                aria-label="Recover application"
                className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-rose-400/40 text-rose-100 font-medium text-xs flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Try Recover</span>
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const GlobalRuntimeErrorBanner: React.FC = () => {
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      const msg = event.error?.stack || event.message || 'Unknown window.onerror';
      setRuntimeError(`Error: ${msg}`);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? `${event.reason.message}\n${event.reason.stack || ''}`
          : String(event.reason || 'Unhandled Promise Rejection');
      setRuntimeError(`Unhandled Rejection: ${reason}`);
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  if (!runtimeError) return null;

  return (
    <div className="fixed top-10 inset-x-3 z-[100] max-w-md mx-auto bg-rose-950/95 border-2 border-rose-500 text-rose-100 p-3.5 rounded-xl shadow-2xl space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-rose-300">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>Runtime Error Diagnostic</span>
        </div>
        <button
          type="button"
          onClick={() => setRuntimeError(null)}
          aria-label="Close error box"
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-rose-900/60 text-rose-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <pre className="p-2.5 rounded-lg bg-black/50 border border-rose-500/30 text-[11px] font-mono text-rose-200 max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
        {runtimeError}
      </pre>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            try {
              navigator.clipboard.writeText(runtimeError);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // ignore
            }
          }}
          aria-label="Copy error text"
          className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-rose-500 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied!' : 'Copy error'}</span>
        </button>
      </div>
    </div>
  );
};

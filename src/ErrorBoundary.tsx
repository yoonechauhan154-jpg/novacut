import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary: catches JavaScript errors anywhere in the child component tree
 * and displays a big red box with the error message + stack instead of a blank screen.
 * Also installs global window.onerror / unhandledrejection handlers.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: '#1a1a1a',
            color: '#ff4d4d',
            fontFamily: 'monospace',
            fontSize: '14px',
            lineHeight: '1.5',
            padding: '24px',
            overflow: 'auto',
            zIndex: 999999,
          }}
        >
          <h2 style={{ color: '#ff6b6b', marginBottom: '12px' }}>🚨 ClipNova Runtime Error</h2>
          <p style={{ marginBottom: '12px' }}><strong>Message:</strong></p>
          <pre style={{ marginBottom: '12px', whiteSpace: 'pre-wrap' }}>{this.state.error?.message ?? '(no message)'}</pre>
          {this.state.errorInfo && (
            <>
              <p style={{ marginBottom: '12px' }}><strong>Component stack:</strong></p>
              <pre style={{ marginBottom: '12px', whiteSpace: 'pre-wrap' }}>{this.state.errorInfo.componentStack}</pre>
            </>
          )}
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null, errorInfo: null });
              window.location.reload();
            }}
            style={{
              background: '#ff4d4d',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Refresh App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Install global error handlers that render errors to the DOM instead of
 * a blank page. Called once from main.tsx.
 */
export function installGlobalErrorHandlers(): void {
  const handleGlobalError = (reason: unknown, source?: string) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : '';
    const container = document.getElementById('error-global-root');

    if (container) {
      container.innerHTML = `
        <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#1a1a1a;color:#ff4d4d;font-family:monospace;font-size:14px;line-height:1.5;padding:24px;overflow:auto;zIndex:999999;">
          <h2 style="color:#ff6b6b;margin-bottom:12px;">🚨 ClipNova Uncaught Error</h2>
          ${source ? `<p style="margin-bottom:12px;"><strong>Source:</strong> ${source}</p>` : ''}
          <p style="margin-bottom:12px;"><strong>Message:</strong></p>
          <pre style="margin-bottom:12px;white-space:pre-wrap">${msg}</pre>
          ${stack ? `<p style="margin-bottom:12px;"><strong>Stack:</strong></p><pre style="white-space:pre-wrap">${stack}</pre>` : ''}
          <button onclick="location.reload()" style="background:#ff4d4d;color:#fff;border:none;padding:8px 16px;cursor:pointer;font-size:14px;">Refresh App</button>
        </div>
      `;
      return;
    }

    // Fallback: inject a root div if none exists yet
    const div = document.createElement('div');
    div.id = 'error-global-root';
    div.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#1a1a1a;color:#ff4d4d;font-family:monospace;font-size:14px;line-height:1.5;padding:24px;overflow:auto;zIndex:999999;';
    div.innerHTML = `
      <h2 style="color:#ff6b6b;margin-bottom:12px;">🚨 ClipNova Uncaught Error</h2>
      ${source ? `<p style="margin-bottom:12px;"><strong>Source:</strong> ${source}</p>` : ''}
      <p style="margin-bottom:12px;"><strong>Message:</strong></p>
      <pre style="margin-bottom:12px;white-space:pre-wrap">${msg}</pre>
      ${stack ? `<p style="margin-bottom:12px;"><strong>Stack:</strong></p><pre style="white-space:pre-wrap">${stack}</pre>` : ''}
      <button onclick="location.reload()" style="background:#ff4d4d;color:#fff;border:none;padding:8px 16px;cursor:pointer;font-size:14px;">Refresh App</button>
    `;
    document.body.appendChild(div);
  };

  window.addEventListener('error', (event) => {
    console.error('[GlobalError]', event.message, event.filename, event.lineno);
    handleGlobalError(event.error || new Error(event.message), event.filename);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[UnhandledRejection]', event.reason);
    handleGlobalError(event.reason, 'unhandledrejection');
  });
}

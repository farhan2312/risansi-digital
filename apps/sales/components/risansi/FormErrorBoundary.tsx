'use client';

import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; error: string }

export class FormErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error: error instanceof Error ? error.message : 'Unexpected error' };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('FormErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderRadius: 8, margin: '16px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--neg-strong)', marginBottom: 8 }}>
            Something went wrong in this section
          </div>
          <div style={{ fontSize: 12, color: 'var(--neg-strong)', marginBottom: 12 }}>
            {this.state.error}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: '' })}
            style={{ padding: '6px 14px', borderRadius: 5, background: '#9B1C1C', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

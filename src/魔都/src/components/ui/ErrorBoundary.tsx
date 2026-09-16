import React from 'react';
interface Props { children: React.ReactNode }
interface State { error: Error | null }
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo): void { console.error('[魔都] 渲染崩溃', error, info?.componentStack); }
  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return <div role="alert" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24, background: '#f6f3ef', color: '#261e29', textAlign: 'center' }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, letterSpacing: '.2em' }}>载入中断</h1>
      <button onClick={() => window.location.reload()} style={{ minHeight: 44, padding: '12px 36px', border: '1px solid #9d1831', background: '#9d1831', color: '#fffdf9', cursor: 'pointer' }}>重新载入</button>
    </div>;
  }
}

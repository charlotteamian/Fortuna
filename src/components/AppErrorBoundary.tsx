import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

function ErrorFallback({ message, onRetry, onReload }: { message: string; onRetry: () => void; onReload: () => void }) {
  const { t } = useTranslation();
  return <div className="startup-error app-ui-error" role="alert">
    <div className="empty-icon" aria-hidden="true">⚠️</div>
    <div className="empty-text">{t('app_ui_error_title')}</div>
    <div className="empty-hint">{t('app_ui_error_hint')}</div>
    {message && <details className="app-ui-error-details"><summary>{t('app_ui_error_details')}</summary><code>{message}</code></details>}
    <div className="app-ui-error-actions">
      <button type="button" className="btn btn-primary" onClick={onRetry}>{t('retry')}</button>
      <button type="button" className="btn btn-secondary" onClick={onReload}>{t('app_ui_error_reload')}</button>
    </div>
  </div>;
}

interface Props { children: ReactNode }
interface State { error: Error | null }

/** A render failure must never remove the whole app. Keep the tab bar and the
 * user's data intact, show the cause and offer a retry or a full reload. */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Fortuna page render failed', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });
  private reload = () => window.location.reload();

  render() {
    if (this.state.error) return <ErrorFallback message={this.state.error.message} onRetry={this.retry} onReload={this.reload} />;
    return <>{this.props.children}</>;
  }
}

import type { ReactNode } from 'react';

export default function SettingsMenu({ title, value, children }: { title: string; value?: string; children: ReactNode }) {
  return <details className="settings-section settings-menu" name="fortuna-settings-menu">
    <summary className="settings-menu-summary"><span>{title}</span><span className="settings-menu-value">{value}<span className="settings-menu-chevron" aria-hidden="true">›</span></span></summary>
    <div className="settings-menu-content">{children}</div>
  </details>;
}

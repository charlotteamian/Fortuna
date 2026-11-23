/**
 * Reusable in-app confirmation dialog, replacing native `confirm`/`alert` so the app
 * keeps a consistent look and stays usable on narrow screens (B11).
 */
export function ConfirmDialog(props: {
  open: boolean;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!props.open) return null;
  return (
    <div className="confirm-overlay" onClick={props.onCancel}>
      <div className="confirm-box" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="confirm-msg">{props.message}</div>
        <div className="confirm-actions">
          <button className="btn btn-secondary" onClick={props.onCancel}>{props.cancelLabel}</button>
          <button className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  /** Red confirm button for actions that delete things. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A modal "are you sure?" box. Shown by App whenever an action needs confirming. */
function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="confirm__actions">
          <button className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className={danger ? 'btn btn--danger' : 'btn btn--primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog

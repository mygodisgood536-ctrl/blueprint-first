import React, { useEffect, useState, ReactNode } from 'react'
import { useStore } from './store'
import { I } from './icons2'

/* ---------------- Modal ---------------- */
let modalZIndex = 200

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null
  const z = ++modalZIndex
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-overlay" style={{ zIndex: z }} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3 id="modal-title">{title}</h3><button className="modal-close" onClick={onClose} aria-label="Close"><I name="close" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------------- Toast host ---------------- */
export function ToastHost() {
  const { toasts } = useStore()
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {t.type === 'success' ? <I name="check" size={16} /> : t.type === 'error' ? <I name="alert" size={16} /> : null}
          {t.message}
        </div>
      ))}
    </div>
  )
}

/* ---------------- Status badge ---------------- */
export function Status({ status }: { status: string }) {
  const map: Record<string, string> = {
    RECORDED: 'badge-green', done: 'badge-green', passed: 'badge-green', connected: 'badge-green', active: 'badge-green',
    EXECUTED: 'badge-blue',
    PENDING: 'badge-yellow', queued: 'badge-yellow', running: 'badge-blue', inconclusive: 'badge-yellow',
    OUT_OF_SCOPE: 'badge-gray', notRun: 'badge-gray', paused: 'badge-gray', auth_required: 'badge-yellow',
    failed: 'badge-red', OPEN: 'badge-red', blocked: 'badge-red', unsupported: 'badge-red', rate_limited: 'badge-red',
    model_unavailable: 'badge-red', provider_unavailable: 'badge-red',
  }
  const cls = map[status] || 'badge-gray'
  return <span className={`badge ${cls}`}>{status.replace(/_/g, ' ').toLowerCase()}</span>
}

/* ---------------- Loading ---------------- */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-screen"><div className="spinner" /><div className="text-sm muted">{label}</div></div>
}

/* ---------------- Empty state ---------------- */
export function Empty({ icon = '📭', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

/* ---------------- Error state ---------------- */
export function ErrorState({ title = 'Something went wrong', onRetry }: { title?: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <h3>{title}</h3>
      <p className="muted text-sm mb-16">An error occurred while loading this content.</p>
      {onRetry && <button className="btn btn-primary" onClick={onRetry}>Try again</button>}
    </div>
  )
}

/* ---------------- Confirm modal ---------------- */
export function useConfirm() {
  const [state, setState] = useState<{ open: boolean; title: string; message: string; onConfirm?: () => void; confirmLabel?: string }>({ open: false, title: '', message: '' })
  const confirm = (title: string, message: string, onConfirm: () => void, confirmLabel = 'Confirm') => setState({ open: true, title, message, onConfirm, confirmLabel })
  const node = (
    <Modal open={state.open} onClose={() => setState(s => ({ ...s, open: false }))} title={state.title}
      footer={<>
        <button className="btn btn-ghost" onClick={() => setState(s => ({ ...s, open: false }))}>Cancel</button>
        <button className="btn btn-danger" onClick={() => { state.onConfirm?.(); setState(s => ({ ...s, open: false })) }}>{state.confirmLabel}</button>
      </>}>
      <p className="text-sm">{state.message}</p>
    </Modal>
  )
  return { confirm, node }
}

/* ---------------- Date formatting ---------------- */
export function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
export function fmtDateTime(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export function fmtBytes(n: number) {
  if (n < 1024) return n + ' B'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1048576).toFixed(1) + ' MB'
}

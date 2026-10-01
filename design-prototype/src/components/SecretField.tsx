/**
 * Sensitive-input controls.
 *
 * A single, professional implementation of the "show / hide" affordance used by
 * every credential field in the product, so password, confirm-password,
 * recovery answer, authenticator secret and API-key inputs all behave
 * identically.
 *
 * Security properties this component deliberately preserves:
 *  - It is PRESENTATION ONLY. It toggles the `type` attribute between `password`
 *    and `text`; it never rewrites, transforms, or stores the value anywhere new.
 *  - The default is HIDDEN for secrets. `defaultVisible` is only used where
 *    masking would make the field useless to the person filling it in.
 *  - Nothing is logged, and the reveal state lives in component state that is
 *    discarded on unmount.
 *  - The value is never placed in a URL, and no `name`/`data-*` attribute
 *    carries it.
 */
import React, { useRef, useState } from 'react'

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/**
 * A sensitive text input with a show/hide control and an optional copy action.
 *
 * `value` and `onChange` are passed straight through, so the component can never
 * alter what was typed.
 */
export function SecretField({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete,
  inputMode,
  disabled,
  allowCopy = false,
  defaultVisible = false,
  revealLabel = 'Show',
  hideLabel = 'Hide',
  onCopied,
  'data-testid': testId,
  className,
  ...rest
}: {
  /** Forwarded so a <label htmlFor> stays associated with this input. */
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  autoComplete?: string
  inputMode?: 'text' | 'numeric'
  disabled?: boolean
  /** Offers a copy-to-clipboard action (secrets the user must transcribe). */
  allowCopy?: boolean
  /** Secrets stay hidden unless the person deliberately reveals them. */
  defaultVisible?: boolean
  revealLabel?: string
  hideLabel?: string
  onCopied?: () => void
  'data-testid'?: string
  className?: string
  /** Any further attributes (aria-*, name, maxLength, ...) pass through. */
  [key: string]: unknown
}) {
  const [visible, setVisible] = useState(defaultVisible)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard access can be denied; selection-based copying still works and
      // the value is already visible, so this is a non-fatal convenience.
      return
    }
    setCopied(true)
    onCopied?.()
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className={`secret-input${visible ? ' is-visible' : ''}${className ? ' ' + className : ''}`}>
      <input
        {...rest}
        {...(id !== undefined ? { id } : {})}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete ?? 'off'}
        {...(inputMode ? { inputMode } : {})}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        {...(testId ? { 'data-testid': testId } : {})}
      />
      <div className="secret-input-actions">
        {allowCopy && value.length > 0 && (
          <button
            type="button"
            className="secret-input-btn"
            onClick={() => void copy()}
            title={copied ? 'Copied' : 'Copy to clipboard'}
            aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        <button
          type="button"
          className="secret-input-btn"
          onClick={() => setVisible((v) => !v)}
          title={visible ? hideLabel : revealLabel}
          aria-label={visible ? hideLabel : revealLabel}
          aria-pressed={visible}
        >
          <EyeIcon off={visible} />
        </button>
      </div>
    </div>
  )
}

/**
 * A read-only secret with show/hide and copy, used for the authenticator secret
 * during enrollment. The value is shown grouped for transcription and never
 * re-requested once the flow is complete.
 */
export function SecretDisplay({
  value,
  grouping = 4,
  'data-testid': testId,
}: {
  value: string
  grouping?: number
  'data-testid'?: string
}) {
  const [visible, setVisible] = useState(true)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  const text = value.length === 0
    ? ''
    : visible
      ? value.replace(new RegExp(`(.{${grouping}})`, 'g'), '$1 ').trim()
      : '•'.repeat(Math.min(32, Math.max(8, Math.ceil(value.length / 2))))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return
    }
    setCopied(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="secret-display">
      <code className="secret-display-value mono" {...(testId ? { 'data-testid': testId } : {})}>
        {text}
      </code>
      <div className="secret-input-actions">
        <button
          type="button"
          className="secret-input-btn"
          onClick={() => void copy()}
          disabled={value.length === 0}
          title={copied ? 'Copied' : 'Copy secret'}
          aria-label={copied ? 'Secret copied to clipboard' : 'Copy secret'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <button
          type="button"
          className="secret-input-btn"
          onClick={() => setVisible((v) => !v)}
          title={visible ? 'Hide secret' : 'Show secret'}
          aria-label={visible ? 'Hide secret' : 'Show secret'}
          aria-pressed={visible}
        >
          <EyeIcon off={visible} />
        </button>
      </div>
    </div>
  )
}

/** Full-screen-loading-free QR helper is intentionally NOT part of this module. */
export default SecretField

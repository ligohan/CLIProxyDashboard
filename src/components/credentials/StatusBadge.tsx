import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { AuthStatus, TestStatus } from '@/types/api'

interface StatusConfig {
  label: string
  bg: string
  text: string
}

type DisplayStatus = TestStatus | AuthStatus

const STATUS_CONFIG: Record<string, StatusConfig> = {
  valid:      { label: 'success', bg: '#10A37F', text: '#FFFFFF' },
  active:     { label: 'success', bg: '#10A37F', text: '#FFFFFF' },
  disabled:   { label: '已禁用',  bg: '#F2F1EF', text: '#9A948C' },
  testing:    { label: '测试中',  bg: '#FDF5E6', text: '#C4933A' },
  refreshing: { label: '刷新中',  bg: '#FDF5E6', text: '#C4933A' },
  pending:    { label: '等待中',  bg: '#FDF5E6', text: '#C4933A' },
  error:      { label: 'error',   bg: '#B94040', text: '#FFFFFF' },
  expired:    { label: '已过期',  bg: '#FCEAEA', text: '#B94040' },
  low:        { label: 'low',     bg: '#F59E0B', text: '#FFFFFF' },
  quota:      { label: '超限额',  bg: '#F5F3E6', text: '#7A6830' },
  unknown:    { label: '未知',    bg: '#F2F1EF', text: '#9A948C' },
}

interface StatusBadgeProps {
  status: DisplayStatus
  errorMessage?: string
}

function ErrorTooltip({ anchor, message }: { anchor: DOMRect; message: string }) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, visible: false })

  useEffect(() => {
    if (!tooltipRef.current) return
    const rect = tooltipRef.current.getBoundingClientRect()
    const top = anchor.top - rect.height - 6
    const left = anchor.left + anchor.width / 2 - rect.width / 2
    setPos({
      top: top < 4 ? anchor.bottom + 6 : top,
      left: Math.max(4, Math.min(left, window.innerWidth - rect.width - 4)),
      visible: true,
    })
  }, [anchor])

  return createPortal(
    <div
      ref={tooltipRef}
      className="fixed z-[9999] max-w-xs px-2.5 py-1.5 rounded-md text-2xs leading-relaxed shadow-lg pointer-events-none transition-opacity duration-150"
      style={{
        top: pos.top,
        left: pos.left,
        opacity: pos.visible ? 1 : 0,
        backgroundColor: '#1C1917',
        color: '#FAFAF9',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {message}
    </div>,
    document.body,
  )
}

export default function StatusBadge({ status, errorMessage }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown
  const spinning = status === 'testing' || status === 'refreshing' || status === 'pending'
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  const showTooltip = status === 'error' && !!errorMessage && hovered

  return (
    <>
      <span
        ref={ref}
        className="inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium cursor-default min-w-[3.5rem]"
        style={{ backgroundColor: config.bg, color: config.text }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {spinning && (
          <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {config.label}
      </span>
      {showTooltip && ref.current && (
        <ErrorTooltip anchor={ref.current.getBoundingClientRect()} message={errorMessage} />
      )}
    </>
  )
}

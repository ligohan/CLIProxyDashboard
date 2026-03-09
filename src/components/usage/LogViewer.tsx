import { useState, useEffect, useRef, useCallback } from 'react'
import { useCredStore } from '@/store/credStore'
import { fetchLogs, fetchLoggingEnabled } from '@/lib/management'

const POLL_INTERVAL = 5_000
const MAX_LINES = 500

export default function LogViewer() {
  const client = useCredStore((s) => s.client)
  const [lines, setLines] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loggingEnabled, setLoggingEnabled] = useState<boolean | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [polling, setPolling] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const latestTimestamp = useRef(0)
  const autoScrollRef = useRef(true)
  const prevLoggingEnabled = useRef<boolean | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    autoScrollRef.current = autoScroll
  }, [autoScroll])

  const scrollToBottom = useCallback(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  // Check if logging is enabled
  useEffect(() => {
    if (!client) return
    fetchLoggingEnabled(client)
      .then(setLoggingEnabled)
      .catch(() => setLoggingEnabled(false))
  }, [client])

  // Initial log load
  const loadLogs = useCallback(async () => {
    if (!client) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchLogs(client)
      setLines(res.lines.slice(-MAX_LINES))
      latestTimestamp.current = res['latest-timestamp'] ?? 0
    } catch (err) {
      if (err instanceof Error && err.message.includes('logging to file disabled')) {
        setError('文件日志未启用，请先在设置中启用 logging-to-file')
      } else {
        setError(err instanceof Error ? err.message : '加载日志失败')
      }
    } finally {
      setLoading(false)
    }
  }, [client])

  // Poll for new logs
  const pollLogs = useCallback(async () => {
    if (!client) return
    try {
      const currentAfter = latestTimestamp.current
      const res = await fetchLogs(client, currentAfter)
      const nextTimestamp = res['latest-timestamp'] ?? currentAfter

      if (nextTimestamp < currentAfter) {
        latestTimestamp.current = 0
        await loadLogs()
        return
      }

      if (res.lines.length > 0) {
        setLines((prev) => [...prev, ...res.lines].slice(-MAX_LINES))
        latestTimestamp.current = nextTimestamp
        requestAnimationFrame(scrollToBottom)
      } else {
        latestTimestamp.current = nextTimestamp
      }
    } catch {
      // silent poll failure
    }
  }, [client, loadLogs, scrollToBottom])

  useEffect(() => {
    if (!loggingEnabled) {
      prevLoggingEnabled.current = loggingEnabled
      return
    }

    if (prevLoggingEnabled.current !== true) {
      latestTimestamp.current = 0
    }

    loadLogs()
    prevLoggingEnabled.current = loggingEnabled
  }, [loggingEnabled, loadLogs])

  // Auto-scroll on lines change
  useEffect(() => {
    scrollToBottom()
  }, [lines, scrollToBottom])

  // Polling control
  useEffect(() => {
    if (polling && loggingEnabled) {
      pollTimer.current = setInterval(pollLogs, POLL_INTERVAL)
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current)
        pollTimer.current = null
      }
    }
  }, [polling, loggingEnabled, pollLogs])

  // Handle scroll - detect manual scroll up
  function handleScroll() {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(isAtBottom)
  }

  if (loggingEnabled === false) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6 text-center">
        <div className="text-subtle text-sm mb-2">
          文件日志未启用
        </div>
        <p className="text-2xs text-muted">
          这里读取的是 CPA 服务日志文件；若暂无日志，请先在“设置”启用 <code className="font-mono-key bg-border/50 px-1 rounded">logging-to-file</code>。
        </p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-ink">服务器日志</span>
          <span className="text-2xs text-muted">
            {lines.length} 条记录
          </span>
          <span className="text-2xs text-muted">读取 CPA 日志文件</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPolling((v) => !v)}
            className={`flex items-center gap-1 text-2xs px-2 py-1 rounded border transition-colors ${
              polling
                ? 'border-coral/50 bg-coral/10 text-coral'
                : 'border-border text-subtle hover:text-ink'
            }`}
            title={polling ? '停止自动刷新' : '启动自动刷新'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${polling ? 'bg-coral animate-pulse' : 'bg-muted'}`} />
            {polling ? '实时' : '自动刷新'}
          </button>
          <button
            onClick={loadLogs}
            disabled={loading}
            className="text-2xs text-subtle hover:text-coral transition-colors disabled:opacity-50 px-2 py-1"
          >
            刷新
          </button>
          <button
            onClick={() => setLines([])}
            className="text-2xs text-subtle hover:text-coral transition-colors px-2 py-1"
          >
            清空
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-[#FCEAEA] border-b border-[#EBC4C4] text-sm text-[#B94040]">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && lines.length === 0 && (
        <div className="px-4 py-4 space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 bg-border/40 rounded animate-pulse" style={{ width: `${60 + Math.random() * 40}%` }} />
          ))}
        </div>
      )}

      {/* Log lines */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto max-h-[400px] bg-[#1a1a1a] p-3 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 && !loading && !error && (
          <div className="text-muted text-center py-8 text-2xs">暂无日志记录</div>
        )}
        {lines.map((line, i) => (
          <LogLine key={i} line={line} />
        ))}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && lines.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true)
            scrollToBottom()
          }}
          className="w-full text-center py-1.5 bg-border/30 text-2xs text-subtle hover:text-ink transition-colors"
        >
          ↓ 滚动到底部
        </button>
      )}
    </div>
  )
}

function LogLine({ line }: { line: string }) {
  const level = detectLevel(line)

  const levelColors: Record<string, string> = {
    error: 'text-[#EF5350]',
    warn: 'text-[#FFA726]',
    info: 'text-[#66BB6A]',
    debug: 'text-[#42A5F5]',
    default: 'text-[#B0B0B0]',
  }

  return (
    <div className={`${levelColors[level]} whitespace-pre-wrap break-all hover:bg-white/5 px-1 rounded`}>
      {line}
    </div>
  )
}

function detectLevel(line: string): string {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('err ') || lower.includes(' err]')) return 'error'
  if (lower.includes('warn') || lower.includes('warning')) return 'warn'
  if (lower.includes('debug') || lower.includes('dbg ')) return 'debug'
  if (lower.includes('info') || lower.includes('inf ')) return 'info'
  return 'default'
}

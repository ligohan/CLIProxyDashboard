import { useState, useEffect, useRef, useCallback } from 'react'
import { useCredStore } from '@/store/credStore'
import { uploadAuthFile } from '@/lib/management'
import { useConnection } from '@/hooks/useConnection'

interface TokenInfo {
  fileName: string
  email: string
  type: string
  expired: string
  accountId: string
  createdAt: number
}

interface TokensResponse {
  scriptMissing?: boolean
  tokens?: TokenInfo[]
}

type RunStatus = 'idle' | 'running' | 'done' | 'error'

interface TokenRowState {
  uploading: boolean
  testing: boolean
  deleting: boolean
  status: 'pending' | 'uploading' | 'testing' | 'success' | 'failed'
  message?: string
}

export default function RegisterPanel() {
  // --- Registration state ---
  const [count, setCount] = useState(3)
  const [workers, setWorkers] = useState(3)
  const [proxy, setProxy] = useState('')
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const logsEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // --- Token list state ---
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [tokenStates, setTokenStates] = useState<Record<string, TokenRowState>>({})
  const [loadingTokens, setLoadingTokens] = useState(false)
  const [scriptMissing, setScriptMissing] = useState(false)

  // --- CPA connection ---
  const client = useCredStore((s) => s.client)
  const connected = useCredStore((s) => s.connected)
  const { refresh } = useConnection()

  // --- Load tokens ---
  const loadTokens = useCallback(async () => {
    setLoadingTokens(true)
    try {
      const res = await fetch('/api/register/tokens')
      const data = await res.json() as TokensResponse
      setScriptMissing(Boolean(data.scriptMissing))
      setTokens(data.tokens ?? [])
    } catch {
      setScriptMissing(false)
      setTokens([])
    } finally {
      setLoadingTokens(false)
    }
  }, [])

  useEffect(() => {
    loadTokens()
  }, [loadTokens])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // --- SSE connection ---
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    const es = new EventSource('/api/register/progress')
    eventSourceRef.current = es

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'init') {
          setRunStatus(msg.status)
          setLogs(msg.lines ?? [])
        } else if (msg.type === 'log') {
          setLogs((prev) => [...prev, msg.line])
        } else if (msg.type === 'status') {
          setRunStatus(msg.status)
          if (msg.status === 'done' || msg.status === 'error') {
            loadTokens()
          }
        }
      } catch {
        // malformed SSE
      }
    }

    es.onerror = () => {
      es.close()
      eventSourceRef.current = null
    }

    return es
  }, [loadTokens])

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
  }, [])

  // --- Start registration ---
  async function startRegistration() {
    setLogs([])
    setRunStatus('running')

    try {
      const res = await fetch('/api/register/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, workers, proxy: proxy || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        setRunStatus('error')
        setLogs((prev) => [...prev, `错误: ${data.error ?? '启动失败'}`])
        return
      }

      connectSSE()
    } catch (err) {
      setRunStatus('error')
      setLogs((prev) => [...prev, `启动失败: ${err instanceof Error ? err.message : '未知错误'}`])
    }
  }

  // --- Stop registration ---
  async function stopRegistration() {
    try {
      await fetch('/api/register/stop', { method: 'POST' })
    } catch {
      // ignore
    }
    setRunStatus('done')
  }

  // --- Add token to CPA ---
  async function addToCPA(token: TokenInfo) {
    if (!client) return

    const setState = (s: Partial<TokenRowState>) =>
      setTokenStates((prev) => ({
        ...prev,
        [token.fileName]: { ...prev[token.fileName], ...s } as TokenRowState,
      }))

    setState({ status: 'uploading', uploading: true, message: '上传中...' })

    try {
      // 1. Read token file content
      const readRes = await fetch(`/api/register/tokens/${encodeURIComponent(token.fileName)}`)
      if (!readRes.ok) throw new Error('读取Token文件失败')
      const { content } = await readRes.json()

      // 2. Create File object and upload to CPA
      const blob = new Blob([JSON.stringify(content)], { type: 'application/json' })
      const file = new File([blob], token.fileName, { type: 'application/json' })
      await uploadAuthFile(client, file)

      // 3. Test the uploaded auth file
      setState({ status: 'testing', testing: true, uploading: false, message: '验证中...' })
      await refresh()

      // 4. Delete local token file
      setState({ status: 'success', deleting: true, testing: false, message: '删除本地文件...' })
      await fetch(`/api/register/tokens/${encodeURIComponent(token.fileName)}`, {
        method: 'DELETE',
      })

      setState({
        status: 'success',
        uploading: false,
        testing: false,
        deleting: false,
        message: '已添加到 CPA',
      })

      // Remove from local list
      setTokens((prev) => prev.filter((t) => t.fileName !== token.fileName))
    } catch (err) {
      setState({
        status: 'failed',
        uploading: false,
        testing: false,
        deleting: false,
        message: err instanceof Error ? err.message : '操作失败',
      })
    }
  }

  // --- Batch add all to CPA ---
  async function addAllToCPA() {
    for (const token of tokens) {
      await addToCPA(token)
    }
  }

  // --- Delete token ---
  async function deleteToken(token: TokenInfo) {
    try {
      await fetch(`/api/register/tokens/${encodeURIComponent(token.fileName)}`, {
        method: 'DELETE',
      })
      setTokens((prev) => prev.filter((t) => t.fileName !== token.fileName))
    } catch {
      // ignore
    }
  }

  const isRunning = runStatus === 'running'

  if (scriptMissing && !loadingTokens) {
    return (
      <div className="bg-surface border border-border rounded-xl min-h-[460px] flex flex-col items-center justify-center text-center">
        <div className="text-5xl md:text-6xl text-subtle">( ´•̥×•̥` )</div>
        <p className="mt-4 text-sm text-subtle">脚本找不到</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink flex items-center gap-2">
          <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          注册机
        </h2>
        <button
          onClick={loadTokens}
          disabled={loadingTokens}
          className="flex items-center gap-1.5 text-xs text-subtle hover:text-coral transition-colors disabled:opacity-50"
        >
          <svg className={`w-3.5 h-3.5 ${loadingTokens ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.992 4.356v4.992" />
          </svg>
          刷新
        </button>
      </div>

      {/* Registration Config */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
        <h3 className="text-xs font-medium text-ink flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          新建注册任务
        </h3>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-2xs text-subtle">注册数量</label>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
              disabled={isRunning}
              className="w-full bg-canvas border border-border rounded-lg px-3 py-1.5 text-sm text-ink font-mono-key focus:outline-none focus:ring-1 focus:ring-coral/50 disabled:opacity-50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-2xs text-subtle">并发线程</label>
            <input
              type="number"
              min={1}
              max={10}
              value={workers}
              onChange={(e) => setWorkers(Math.max(1, Number(e.target.value) || 1))}
              disabled={isRunning}
              className="w-full bg-canvas border border-border rounded-lg px-3 py-1.5 text-sm text-ink font-mono-key focus:outline-none focus:ring-1 focus:ring-coral/50 disabled:opacity-50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-2xs text-subtle">代理 (可选)</label>
            <input
              type="text"
              placeholder="http://127.0.0.1:7890"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              disabled={isRunning}
              className="w-full bg-canvas border border-border rounded-lg px-3 py-1.5 text-sm text-ink font-mono-key placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-coral/50 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isRunning ? (
            <button
              onClick={startRegistration}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-coral text-white rounded-lg text-sm font-medium hover:bg-coral/90 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
              </svg>
              开始注册
            </button>
          ) : (
            <button
              onClick={stopRegistration}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#EF5350] text-white rounded-lg text-sm font-medium hover:bg-[#EF5350]/90 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              停止
            </button>
          )}

          {runStatus !== 'idle' && (
            <StatusIndicator status={runStatus} />
          )}
        </div>
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-xs font-medium text-subtle">注册日志</span>
            <span className="text-2xs text-muted">{logs.length} 行</span>
          </div>
          <div className="max-h-48 overflow-y-auto p-3 font-mono-key text-2xs leading-5 space-y-0.5 bg-canvas/50">
            {logs.map((line, i) => (
              <div key={i} className={getLogColor(line)}>
                {line}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* Token Files */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink flex items-center gap-2">
            <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
            Token 文件
            <span className="text-2xs text-subtle font-normal">({tokens.length})</span>
          </h3>

          {connected && tokens.length > 0 && (
            <button
              onClick={addAllToCPA}
              className="flex items-center gap-1.5 px-3 py-1 bg-[#4CAF50] text-white rounded-lg text-xs font-medium hover:bg-[#4CAF50]/90 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              全部添加到 CPA
            </button>
          )}
        </div>

        {tokens.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-6 text-center text-subtle text-sm">
            {loadingTokens ? '加载中...' : scriptMissing ? '脚本不存在～' : '暂无 Token 文件'}
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-canvas/50">
                  <th className="px-3 py-2.5 text-left font-medium text-subtle">邮箱</th>
                  <th className="px-3 py-2.5 text-left font-medium text-subtle">类型</th>
                  <th className="px-3 py-2.5 text-left font-medium text-subtle">过期时间</th>
                  <th className="px-3 py-2.5 text-left font-medium text-subtle">状态</th>
                  <th className="px-3 py-2.5 text-right font-medium text-subtle">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tokens.map((token) => (
                  <TokenRow
                    key={token.fileName}
                    token={token}
                    state={tokenStates[token.fileName]}
                    connected={connected}
                    onAddToCPA={() => addToCPA(token)}
                    onDelete={() => deleteToken(token)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// --- Sub-components ---

function StatusIndicator({ status }: { status: RunStatus }) {
  const configs: Record<RunStatus, { label: string; color: string; bg: string }> = {
    idle: { label: '空闲', color: 'text-subtle', bg: 'bg-border' },
    running: { label: '运行中', color: 'text-[#FF9800]', bg: 'bg-[#FF9800]/10' },
    done: { label: '完成', color: 'text-[#4CAF50]', bg: 'bg-[#4CAF50]/10' },
    error: { label: '失败', color: 'text-[#EF5350]', bg: 'bg-[#EF5350]/10' },
  }
  const c = configs[status]

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-medium ${c.bg} ${c.color}`}>
      {status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#FF9800] animate-pulse" />
      )}
      {status === 'done' && <span className="w-1.5 h-1.5 rounded-full bg-[#4CAF50]" />}
      {status === 'error' && <span className="w-1.5 h-1.5 rounded-full bg-[#EF5350]" />}
      {c.label}
    </span>
  )
}

function TokenRow({
  token,
  state,
  connected,
  onAddToCPA,
  onDelete,
}: {
  token: TokenInfo
  state?: TokenRowState
  connected: boolean
  onAddToCPA: () => void
  onDelete: () => void
}) {
  const isBusy = state?.uploading || state?.testing || state?.deleting
  const isSuccess = state?.status === 'success'
  const isFailed = state?.status === 'failed'

  return (
    <tr className="hover:bg-canvas/50 transition-colors">
      <td className="px-3 py-2 font-mono-key text-ink">{token.email || token.fileName}</td>
      <td className="px-3 py-2">
        <span className="px-1.5 py-0.5 rounded text-2xs bg-[#9B59B6]/10 text-[#9B59B6] font-medium">
          {token.type}
        </span>
      </td>
      <td className="px-3 py-2 text-subtle font-mono-key">
        {token.expired ? formatExpiry(token.expired) : '-'}
      </td>
      <td className="px-3 py-2">
        {state?.message ? (
          <span className={`text-2xs ${isSuccess ? 'text-[#4CAF50]' : isFailed ? 'text-[#EF5350]' : 'text-subtle'}`}>
            {isBusy && (
              <svg className="inline w-3 h-3 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {state.message}
          </span>
        ) : (
          <span className="text-2xs text-subtle">待处理</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {connected && !isSuccess && (
            <button
              onClick={onAddToCPA}
              disabled={!!isBusy}
              className="flex items-center gap-1 px-2 py-1 bg-coral text-white rounded text-2xs font-medium hover:bg-coral/90 transition-colors disabled:opacity-50"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              添加到 CPA
            </button>
          )}
          {!isBusy && !isSuccess && (
            <button
              onClick={onDelete}
              className="flex items-center gap-1 px-2 py-1 text-subtle hover:text-[#EF5350] rounded text-2xs transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// --- Helpers ---

function formatExpiry(expired: string): string {
  try {
    const d = new Date(expired)
    const now = new Date()
    const diff = d.getTime() - now.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    const dateStr = `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`

    if (days < 0) return `${dateStr} (已过期)`
    if (days === 0) return `${dateStr} (今天)`
    return `${dateStr} (${days}天)`
  } catch {
    return expired
  }
}

function getLogColor(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('失败') || l.includes('错误') || l.includes('error') || l.includes('❌')) return 'text-[#EF5350]'
  if (l.includes('成功') || l.includes('✓') || l.includes('✅')) return 'text-[#4CAF50]'
  if (l.includes('⚠') || l.includes('warn') || l.includes('警告')) return 'text-[#FF9800]'
  if (l.includes('🔄') || l.includes('正在') || l.includes('等待')) return 'text-subtle'
  return 'text-muted'
}

import { useCallback, useEffect, useState } from 'react'
import { useCredStore } from '@/store/credStore'
import { fetchLoggingEnabled, setLoggingEnabled } from '@/lib/management'

export default function SettingsPanel() {
  const client = useCredStore((s) => s.client)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loggingEnabled, setEnabled] = useState(false)

  const load = useCallback(async () => {
    if (!client) return
    setLoading(true)
    setError(null)
    try {
      const enabled = await fetchLoggingEnabled(client)
      setEnabled(enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取日志设置失败')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    load()
  }, [load])

  async function handleToggle() {
    if (!client || saving) return
    setSaving(true)
    setError(null)
    try {
      const next = await setLoggingEnabled(client, !loggingEnabled)
      setEnabled(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新日志设置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink flex items-center gap-2">
          <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 12h9.75M10.5 18h9.75M3.75 6h.008v.008H3.75V6zM3.75 12h.008v.008H3.75V12zM3.75 18h.008v.008H3.75V18z" />
          </svg>
          设置
        </h2>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-ink">日志文件</h3>
            <p className="text-2xs text-subtle mt-1">
              控制是否将服务日志保存到文件。开启后可在“使用统计”里查看重启前后的日志。
            </p>
          </div>

          {loading ? (
            <span className="text-2xs text-subtle">读取中…</span>
          ) : (
            <span className={`text-2xs px-2 py-1 rounded border ${loggingEnabled ? 'border-[#4CAF50]/40 text-[#4CAF50] bg-[#4CAF50]/10' : 'border-border text-subtle'}`}>
              {loggingEnabled ? '已启用' : '已禁用'}
            </span>
          )}
        </div>

        {error && (
          <div className="px-3 py-2 bg-[#FCEAEA] border border-[#EBC4C4] rounded text-sm text-[#B94040]">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggle}
            disabled={loading || saving || !client}
            className="px-3 py-1.5 rounded text-xs font-medium border border-border bg-canvas text-ink hover:border-coral hover:text-coral disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving
              ? '处理中…'
              : loggingEnabled
                ? '停止保存日志'
                : '开始保存日志'}
          </button>

          <button
            type="button"
            onClick={load}
            disabled={loading || saving || !client}
            className="px-2.5 py-1.5 rounded text-xs text-subtle hover:text-coral disabled:opacity-50 transition-colors"
          >
            刷新状态
          </button>
        </div>
      </div>
    </div>
  )
}

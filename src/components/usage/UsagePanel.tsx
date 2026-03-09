import { useState, useEffect, useCallback } from 'react'
import { useCredStore } from '@/store/credStore'
import { fetchUsage } from '@/lib/management'
import type { UsageResponse } from '@/types/api'
import UsageCharts from './UsageCharts'
import ModelStatusMonitor from './ModelStatusMonitor'
import RequestDetailTable from './RequestDetailTable'
import LogViewer from './LogViewer'

export default function UsagePanel() {
  const client = useCredStore((s) => s.client)
  const [data, setData] = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    setLoading(true)
    setError(null)
    try {
      const result = await fetchUsage(client)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage')
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    load()
  }, [load])

  const stats = data?.usage

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink flex items-center gap-2">
          <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          使用统计
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-subtle hover:text-coral transition-colors disabled:opacity-50"
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.992 4.356v4.992" />
          </svg>
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-4">
              <div className="h-4 w-16 bg-border/50 rounded animate-pulse mb-3" />
              <div className="h-8 w-24 bg-border/50 rounded animate-pulse mb-2" />
              <div className="h-3 w-32 bg-border/50 rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-surface border border-[#EF5350]/20 rounded-xl p-4">
          <p className="text-sm text-[#EF5350]">
            {error === 'Failed to load usage' ? '加载使用统计失败' : error}
          </p>
        </div>
      )}

      {stats && (
        <>
          {/* Section 1: Model status monitor */}
          <ModelStatusMonitor stats={stats} />

          {/* Section 2: Request event details table */}
          <RequestDetailTable stats={stats} />

          {/* Section 3: Summary metric cards */}
          <UsageCharts stats={stats} />

          <p className="text-2xs text-subtle pb-4">
            统计数据在服务器重启后重置。
          </p>
        </>
      )}

      {/* Server log viewer */}
      <LogViewer />
    </div>
  )
}

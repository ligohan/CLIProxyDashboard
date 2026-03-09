import { useMemo } from 'react'
import type { UsageStats, UsageRequestDetail } from '@/types/api'

interface ModelStatusMonitorProps {
  stats: UsageStats
}

interface ModelInfo {
  endpoint: string
  model: string
  totalRequests: number
  totalTokens: number
  successCount: number
  failureCount: number
  successRate: number
  /** Per-minute buckets: each has success/fail counts */
  minuteBuckets: MinuteBucket[]
}

interface MinuteBucket {
  label: string
  success: number
  failure: number
  total: number
}

export default function ModelStatusMonitor({ stats }: ModelStatusMonitorProps) {
  const models = useMemo(() => buildModelInfos(stats), [stats])

  if (models.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-6 text-center text-subtle text-sm">
        暂无模型调用数据
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-ink flex items-center gap-2">
        <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
        </svg>
        模型状态监控
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {models.map((m) => (
          <ModelCard key={`${m.endpoint}::${m.model}`} model={m} />
        ))}
      </div>
    </div>
  )
}

function ModelCard({ model }: { model: ModelInfo }) {
  const statusColor =
    model.successRate >= 90
      ? 'text-[#4CAF50]'
      : model.successRate >= 50
        ? 'text-[#FF9800]'
        : 'text-[#EF5350]'
  const statusBg =
    model.successRate >= 90
      ? 'bg-[#4CAF50]/10'
      : model.successRate >= 50
        ? 'bg-[#FF9800]/10'
        : 'bg-[#EF5350]/10'
  const statusLabel =
    model.successRate >= 90 ? '正常' : model.successRate >= 50 ? '警告' : '异常'

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3 transition-all duration-200 hover:shadow-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink truncate font-mono-key">
            {model.model}
          </div>
          <div className="text-2xs text-subtle truncate mt-0.5">{model.endpoint}</div>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-2xs font-medium ${statusBg} ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-2xs text-subtle">
        <span>
          成功率: <span className={`font-medium ${statusColor}`}>{model.successRate}%</span>
        </span>
        <span>请求: {model.totalRequests}</span>
        <span>Tokens: {formatTokens(model.totalTokens)}</span>
      </div>

      {/* Per-minute status bars */}
      {model.minuteBuckets.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-2xs text-subtle">最近请求状态</div>
          <div className="flex gap-[2px] items-end h-6">
            {model.minuteBuckets.map((bucket, i) => {
              const barHeight = bucket.total > 0 ? Math.max(4, (bucket.total / Math.max(...model.minuteBuckets.map(b => b.total), 1)) * 24) : 2
              const color = bucket.total === 0
                ? 'bg-border'
                : bucket.failure === 0
                  ? 'bg-[#4CAF50]'
                  : bucket.success === 0
                    ? 'bg-[#EF5350]'
                    : 'bg-[#FF9800]'

              return (
                <div
                  key={i}
                  className={`flex-1 rounded-sm ${color} transition-all min-w-[3px]`}
                  style={{ height: `${barHeight}px` }}
                  title={`${bucket.label}: ${bucket.success}成功, ${bucket.failure}失败`}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-[9px] text-muted">
            <span>{model.minuteBuckets[0]?.label}</span>
            <span>{model.minuteBuckets[model.minuteBuckets.length - 1]?.label}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Helpers ---

function formatTokens(n: number): string {
  if (n > 999_999) return `${(n / 1_000_000).toFixed(1)}M`
  if (n > 999) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function buildModelInfos(stats: UsageStats): ModelInfo[] {
  const result: ModelInfo[] = []

  if (!stats.apis) return result

  for (const [endpoint, apiStats] of Object.entries(stats.apis)) {
    for (const [model, modelStats] of Object.entries(apiStats.models)) {
      const successCount = modelStats.details.filter(d => !d.failed).length
      const failureCount = modelStats.details.filter(d => d.failed).length
      const totalReqs = modelStats.total_requests || modelStats.details.length
      const successRate = totalReqs > 0 ? Math.round((successCount / totalReqs) * 100) : 100

      const minuteBuckets = buildMinuteBuckets(modelStats.details)

      result.push({
        endpoint,
        model,
        totalRequests: totalReqs,
        totalTokens: modelStats.total_tokens,
        successCount,
        failureCount,
        successRate,
        minuteBuckets,
      })
    }
  }

  // Sort: most requests first
  result.sort((a, b) => b.totalRequests - a.totalRequests)
  return result
}

function buildMinuteBuckets(details: UsageRequestDetail[]): MinuteBucket[] {
  if (details.length === 0) return []

  const sorted = [...details].sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  // Group by minute
  const bucketMap = new Map<string, MinuteBucket>()
  for (const d of sorted) {
    // timestamp format: "2024-01-15 14:30:45" or ISO-like
    const minuteKey = d.timestamp.slice(0, 16) // "2024-01-15 14:30"
    const existing = bucketMap.get(minuteKey)
    if (existing) {
      if (d.failed) {
        existing.failure++
      } else {
        existing.success++
      }
      existing.total++
    } else {
      bucketMap.set(minuteKey, {
        label: minuteKey.slice(11) || minuteKey, // show "14:30"
        success: d.failed ? 0 : 1,
        failure: d.failed ? 1 : 0,
        total: 1,
      })
    }
  }

  const buckets = Array.from(bucketMap.values())

  // Keep last 30 buckets max for display
  return buckets.slice(-30)
}

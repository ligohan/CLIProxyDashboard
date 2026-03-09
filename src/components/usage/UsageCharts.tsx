import type { UsageStats } from '@/types/api'

interface UsageChartsProps {
  stats: UsageStats
}

export default function UsageCharts({ stats }: UsageChartsProps) {
  const successRate =
    stats.total_requests > 0
      ? ((stats.success_count / stats.total_requests) * 100).toFixed(1)
      : '0'

  // Compute aggregated token breakdown from details
  const tokenBreakdown = computeTokenBreakdown(stats)

  // Sparkline data
  const requestsByDay = Object.entries(stats.requests_by_day).sort(([a], [b]) => a.localeCompare(b))
  const tokensByDay = Object.entries(stats.tokens_by_day).sort(([a], [b]) => a.localeCompare(b))

  // Compute TPM from hourly data
  const hourEntries = Object.entries(stats.tokens_by_hour).sort(([a], [b]) => a.localeCompare(b))
  const totalHourlyTokens = hourEntries.reduce((s, [, v]) => s + v, 0)
  const activeHours = hourEntries.filter(([, v]) => v > 0).length
  const tpm = activeHours > 0 ? Math.round(totalHourlyTokens / (activeHours * 60)) : 0

  // Compute RPM
  const reqHourEntries = Object.entries(stats.requests_by_hour).sort(([a], [b]) => a.localeCompare(b))
  const totalHourlyReqs = reqHourEntries.reduce((s, [, v]) => s + v, 0)
  const activeReqHours = reqHourEntries.filter(([, v]) => v > 0).length
  const rpm = activeReqHours > 0 ? (totalHourlyReqs / (activeReqHours * 60)).toFixed(2) : '0'

  return (
    <div className="space-y-4">
      {/* Top metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <MetricCard
          label="总请求数"
          value={stats.total_requests.toLocaleString()}
          icon={<RequestIcon />}
          iconBg="bg-subtle/10"
          iconColor="text-subtle"
          subtitle={
            <span className="flex items-center gap-3 text-2xs">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4CAF50]" />
                成功: {stats.success_count.toLocaleString()}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#EF5350]" />
                失败: {stats.failure_count.toLocaleString()}
              </span>
            </span>
          }
          sparkData={requestsByDay.map(([, v]) => v)}
          sparkColor="#888"
        />
        <MetricCard
          label="总 Token 数"
          value={formatTokens(stats.total_tokens)}
          icon={<TokenIcon />}
          iconBg="bg-[#9B59B6]/10"
          iconColor="text-[#9B59B6]"
          subtitle={
            <span className="text-2xs">
              缓存: {formatTokens(tokenBreakdown.cached)}
              <span className="mx-1.5 opacity-30">·</span>
              思考: {formatTokens(tokenBreakdown.reasoning)}
            </span>
          }
          sparkData={tokensByDay.map(([, v]) => v)}
          sparkColor="#9B59B6"
        />
        <MetricCard
          label="RPM"
          value={rpm}
          icon={<ClockIcon />}
          iconBg="bg-[#4CAF50]/10"
          iconColor="text-[#4CAF50]"
          subtitle={<span className="text-2xs">总请求数: {stats.total_requests.toLocaleString()}</span>}
          sparkData={reqHourEntries.map(([, v]) => v)}
          sparkColor="#4CAF50"
        />
        <MetricCard
          label="TPM"
          value={tpm.toLocaleString()}
          icon={<TrendIcon />}
          iconBg="bg-coral/10"
          iconColor="text-coral"
          subtitle={<span className="text-2xs">总Token数: {formatTokens(stats.total_tokens)}</span>}
          sparkData={hourEntries.map(([, v]) => v)}
          sparkColor="#E8704A"
        />
        <MetricCard
          label="成功率"
          value={`${successRate}%`}
          icon={<CheckIcon />}
          iconBg="bg-[#4CAF50]/10"
          iconColor="text-[#4CAF50]"
          subtitle={
            <span className="text-2xs">
              {stats.success_count}/{stats.total_requests}
            </span>
          }
        />
      </div>
    </div>
  )
}

// --- MetricCard ---

function MetricCard({
  label,
  value,
  icon,
  iconBg,
  iconColor,
  subtitle,
  sparkData,
  sparkColor,
}: {
  label: string
  value: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  subtitle?: React.ReactNode
  sparkData?: number[]
  sparkColor?: string
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 transition-all duration-200 hover:shadow-card hover:-translate-y-0.5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-subtle">{label}</span>
        <div className={`flex items-center justify-center w-7 h-7 rounded-lg ${iconBg} ${iconColor}`}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-semibold text-ink font-mono-key tracking-tight mb-1">
        {value}
      </div>
      <div className="text-subtle mb-3">{subtitle}</div>
      {sparkData && sparkData.length > 1 && (
        <Sparkline data={sparkData} color={sparkColor ?? '#888'} />
      )}
    </div>
  )
}

// --- Sparkline ---

function Sparkline({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  const width = 200
  const max = Math.max(...data, 1)
  const padding = 2

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - (v / max) * (height - padding * 2)
    return `${x},${y}`
  })

  const areaPoints = [
    `${padding},${height - padding}`,
    ...points,
    `${width - padding},${height - padding}`,
  ]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={areaPoints.join(' ')}
        fill={`url(#spark-${color.replace('#', '')})`}
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// --- Icons ---

function RequestIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
    </svg>
  )
}

function TokenIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function TrendIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

// --- Helpers ---

function formatTokens(n: number): string {
  if (n > 999_999) return `${(n / 1_000_000).toFixed(1)}M`
  if (n > 999) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString()
}

function computeTokenBreakdown(stats: UsageStats) {
  let cached = 0
  let reasoning = 0

  if (stats.apis) {
    for (const api of Object.values(stats.apis)) {
      for (const model of Object.values(api.models)) {
        for (const detail of model.details) {
          cached += detail.tokens.cached_tokens
          reasoning += detail.tokens.reasoning_tokens
        }
      }
    }
  }

  return { cached, reasoning }
}

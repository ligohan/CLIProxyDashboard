import { useMemo, useState } from 'react'
import type { UsageStats, UsageRequestDetail } from '@/types/api'

interface RequestDetailTableProps {
  stats: UsageStats
}

interface FlatDetail extends UsageRequestDetail {
  model: string
  endpoint: string
}

const PAGE_SIZE = 10

export default function RequestDetailTable({ stats }: RequestDetailTableProps) {
  const allDetails = useMemo(() => flattenDetails(stats), [stats])
  const [page, setPage] = useState(0)

  const totalPages = Math.ceil(allDetails.length / PAGE_SIZE)
  const pageDetails = allDetails.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-ink flex items-center gap-2">
        <svg className="w-4 h-4 text-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
        请求事件明细
        <span className="text-2xs text-subtle font-normal">({allDetails.length} 条)</span>
      </h3>

      {allDetails.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-6 text-center text-subtle text-sm">
          暂无请求记录
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-canvas/50">
                  <Th>时间</Th>
                  <Th>模型名称</Th>
                  <Th>来源</Th>
                  <Th>认证索引</Th>
                  <Th>结果</Th>
                  <Th align="right">输入</Th>
                  <Th align="right">输出</Th>
                  <Th align="right">思考</Th>
                  <Th align="right">缓存</Th>
                  <Th align="right">总Token</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageDetails.map((d, i) => (
                  <tr
                    key={`${d.timestamp}-${d.model}-${i}`}
                    className="hover:bg-canvas/50 transition-colors"
                  >
                    <Td className="font-mono-key whitespace-nowrap text-subtle">
                      {formatTimestamp(d.timestamp)}
                    </Td>
                    <Td className="font-mono-key font-medium text-ink max-w-[160px] truncate">
                      {d.model}
                    </Td>
                    <Td className="text-subtle">{d.source || '-'}</Td>
                    <Td className="font-mono-key text-subtle">{d.auth_index || '-'}</Td>
                    <Td>
                      {d.failed ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs bg-[#EF5350]/10 text-[#EF5350] font-medium">
                          <span className="w-1 h-1 rounded-full bg-[#EF5350]" />
                          失败
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs bg-[#4CAF50]/10 text-[#4CAF50] font-medium">
                          <span className="w-1 h-1 rounded-full bg-[#4CAF50]" />
                          成功
                        </span>
                      )}
                    </Td>
                    <TdNum>{d.tokens.input_tokens.toLocaleString()}</TdNum>
                    <TdNum>{d.tokens.output_tokens.toLocaleString()}</TdNum>
                    <TdNum>{d.tokens.reasoning_tokens.toLocaleString()}</TdNum>
                    <TdNum>{d.tokens.cached_tokens.toLocaleString()}</TdNum>
                    <TdNum className="font-medium text-ink">
                      {d.tokens.total_tokens.toLocaleString()}
                    </TdNum>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border text-2xs text-subtle">
              <span>第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-1">
                <PagBtn disabled={page === 0} onClick={() => setPage(0)}>
                  «
                </PagBtn>
                <PagBtn disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  ‹
                </PagBtn>
                <PagBtn disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  ›
                </PagBtn>
                <PagBtn disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                  »
                </PagBtn>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- Sub-components ---

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2.5 font-medium text-subtle whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>
}

function TdNum({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-right font-mono-key text-subtle tabular-nums ${className}`}>
      {children}
    </td>
  )
}

function PagBtn({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-2 py-1 rounded border border-border bg-surface text-subtle hover:bg-canvas disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

// --- Helpers ---

function flattenDetails(stats: UsageStats): FlatDetail[] {
  const result: FlatDetail[] = []

  if (!stats.apis) return result

  for (const [endpoint, apiStats] of Object.entries(stats.apis)) {
    for (const [model, modelStats] of Object.entries(apiStats.models)) {
      for (const detail of modelStats.details) {
        result.push({ ...detail, model, endpoint })
      }
    }
  }

  // Sort by timestamp descending (most recent first)
  result.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return result
}

function formatTimestamp(ts: string): string {
  // Input may be "2024-01-15 14:30:45" or ISO format
  // Show: "01-15 14:30:45"
  if (ts.length >= 19) {
    return ts.slice(5, 19)
  }
  return ts
}

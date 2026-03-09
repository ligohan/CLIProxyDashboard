import type { AuthFile, AuthStatus, TestResult, TestStatus } from '@/types/api'

export type EffectiveStatus = TestStatus | AuthStatus

function parseTime(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function getRemainingPercent(testResult: TestResult): number | null {
  const pw = testResult.quota?.rate_limit.primary_window
  if (pw) return Math.max(0, 100 - (pw.used_percent ?? 100))

  const snap = testResult.copilotQuota?.quota_snapshots?.premium_interactions
  if (snap?.unlimited) return 100
  const entitlement = snap?.entitlement ?? 0
  const remaining = snap?.remaining ?? snap?.quota_remaining ?? 0
  if (entitlement > 0) return Math.max(0, Math.round((remaining / entitlement) * 100))

  return null
}

export function getEffectiveStatus(file: AuthFile, testResult: TestResult | undefined): EffectiveStatus {
  if (!testResult) return file.status

  if (file.disabled && (testResult.status === 'quota' || testResult.status === 'expired')) {
    return testResult.status
  }

  const fileTime = parseTime(file.last_refresh ?? file.updated_at ?? file.modtime)
  if (fileTime !== null && testResult.testedAt < fileTime) {
    return file.status
  }

  const baseStatus = testResult.status
  if (baseStatus === 'valid') {
    const pct = getRemainingPercent(testResult)
    if (pct !== null && pct <= 30) return 'low'
  }

  return baseStatus
}

export function isExpiredStatus(status: EffectiveStatus): boolean {
  return status === 'expired'
}

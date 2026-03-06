import { useRef, useState } from 'react'
import { useCredStore } from '@/store/credStore'
import { uploadAuthFile } from '@/lib/management'
import { useConnection } from '@/hooks/useConnection'

interface UploadModalProps {
  onClose: () => void
}

interface UploadProgress {
  total: number
  done: number
  running: number
  activeNames: string[]
  uploaded: number
  errors: string[]
}

const CONCURRENCY_OPTIONS = [1, 2, 3, 5, 10]

export default function UploadModal({ onClose }: UploadModalProps) {
  const client = useCredStore((s) => s.client)
  const { refresh } = useConnection()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<File[]>([])
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [done, setDone] = useState(false)
  const [concurrency, setConcurrency] = useState(3)
  const [failedFiles, setFailedFiles] = useState<File[]>([])

  function addFiles(newFiles: FileList | File[]) {
    const arr = Array.from(newFiles)
    setPending((prev) => {
      const names = new Set(prev.map((f) => f.name))
      return [...prev, ...arr.filter((f) => !names.has(f.name))]
    })
  }

  function removeFile(name: string) {
    setPending((prev) => prev.filter((f) => f.name !== name))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }

  async function runUploadBatch(targetFiles: File[]) {
    if (!client || targetFiles.length === 0) return
    setDone(false)
    setFailedFiles([])

    const total = targetFiles.length
    const errors: string[] = []
    const failed: File[] = []
    const activeNames = new Set<string>()
    let uploaded = 0

    let doneCount = 0
    let cursor = 0

    const updateProgress = () => {
      setProgress({
        total,
        done: doneCount,
        running: activeNames.size,
        activeNames: Array.from(activeNames),
        uploaded,
        errors: [...errors],
      })
    }

    updateProgress()

    const worker = async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= total) return

        const file = targetFiles[index]
        activeNames.add(file.name)
        updateProgress()

        try {
          await uploadAuthFile(client, file)
          uploaded += 1
        } catch (err) {
          failed.push(file)
          errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          activeNames.delete(file.name)
          doneCount += 1
          updateProgress()
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, total) }, () => worker())
    )

    setFailedFiles(failed)
    setProgress({
      total,
      done: total,
      running: 0,
      activeNames: [],
      uploaded,
      errors,
    })

    setDone(true)
    setPending([])
    if (uploaded > 0) {
      await refresh()
    }
  }

  async function handleUpload() {
    await runUploadBatch(pending)
  }

  async function handleRetryFailed() {
    await runUploadBatch(failedFiles)
  }

  const uploading = progress !== null && !done
  const percent = progress ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-canvas border border-border rounded-lg shadow-modal w-[480px] max-w-[95vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-sm font-semibold text-ink">上传凭证文件</span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-subtle hover:text-ink hover:bg-black/5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {!uploading && !done && (
            <>
              <div
                className={`border-2 border-dashed rounded-lg px-6 py-8 text-center cursor-pointer transition-colors ${
                  dragging
                    ? 'border-coral bg-coral/5'
                    : 'border-border hover:border-coral/50 hover:bg-coral/3'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
                <UploadIcon />
                <p className="mt-2 text-sm text-ink font-medium">点击或拖拽文件到此处</p>
                <p className="mt-1 text-2xs text-subtle">支持批量上传多个凭证文件</p>
              </div>

              {pending.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-2xs text-subtle mb-1">
                    <span>待上传文件 ({pending.length})</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1">
                        <span>并发</span>
                        <select
                          value={concurrency}
                          onChange={(e) => setConcurrency(Number(e.target.value))}
                          className="text-2xs text-ink bg-canvas border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-coral"
                        >
                          {CONCURRENCY_OPTIONS.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <button onClick={() => setPending([])} className="hover:text-ink transition-colors">清空</button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                    {pending.map((f) => (
                      <div key={f.name} className="flex items-center justify-between px-3 py-1.5 bg-surface rounded border border-border">
                        <span className="text-2xs text-ink truncate flex-1 mr-2">{f.name}</span>
                        <span className="text-2xs text-muted mr-2 flex-shrink-0">{formatBytes(f.size)}</span>
                        <button
                          onClick={() => removeFile(f.name)}
                          className="text-subtle hover:text-ink transition-colors flex-shrink-0"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {uploading && progress && (
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-center justify-between text-2xs text-subtle">
                <span className="truncate max-w-[280px]">
                  {progress.activeNames.length > 0
                    ? `上传中：${progress.activeNames.slice(0, 2).join('、')}${progress.activeNames.length > 2 ? ` 等 ${progress.activeNames.length} 个` : ''}`
                    : '准备中'}
                </span>
                <span className="tabular-nums flex-shrink-0 ml-2">{progress.done} / {progress.total}</span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-coral rounded-full transition-all duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="text-2xs text-subtle text-center">并发中：{progress.running}</p>
              <p className="text-2xs text-muted text-center">{percent}%</p>
            </div>
          )}

          {done && progress && (
            <div className="px-3 py-3 bg-surface rounded border border-border text-2xs">
              <p className="text-ink font-medium mb-1">上传完成</p>
              <p className="text-subtle">
                成功：<span className="text-ink">{progress.uploaded}</span> 个
                {progress.errors.length > 0 && (
                  <span className="ml-2">失败：<span className="text-[#B94040]">{progress.errors.length}</span> 个</span>
                )}
              </p>
              {progress.errors.length > 0 && (
                <button
                  onClick={handleRetryFailed}
                  className="mt-2 px-2.5 py-1 text-2xs font-medium text-coral border border-coral/40 rounded hover:bg-coral/10 transition-colors"
                >
                  一键重试失败项 ({progress.errors.length})
                </button>
              )}
              {progress.errors.length > 0 && (
                <div className="mt-2 flex flex-col gap-0.5 max-h-28 overflow-y-auto">
                  {progress.errors.map((e, i) => (
                    <p key={i} className="text-[#B94040] break-all">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-2xs font-medium text-subtle rounded hover:bg-black/5 hover:text-ink transition-colors"
          >
            {done ? '关闭' : '取消'}
          </button>
          {!done && (
            <button
              onClick={handleUpload}
              disabled={pending.length === 0 || uploading}
              className="px-4 py-1.5 text-2xs font-medium text-white bg-coral rounded hover:bg-coral/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {uploading && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {uploading ? `上传中 ${progress?.done ?? 0}/${progress?.total ?? 0}` : `上传${pending.length > 0 ? ` (${pending.length})` : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function UploadIcon() {
  return (
    <svg className="w-8 h-8 mx-auto text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

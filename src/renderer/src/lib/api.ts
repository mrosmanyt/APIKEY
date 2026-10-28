import type { AppErrorInfo, IpcResult } from '@shared/types'

/** Error thrown in the renderer when an IPC call fails. Carries the redacted error info. */
export class ApiError extends Error {
  constructor(readonly info: AppErrorInfo) {
    super(info.message)
  }
}

export async function call<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const res = await promise
  if (!res.ok) throw new ApiError(res.error)
  return res.data
}

export function errorInfo(err: unknown): AppErrorInfo {
  if (err instanceof ApiError) return err.info
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) }
}

export const api = () => window.aihub

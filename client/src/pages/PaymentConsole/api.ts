import type { BaseContext } from './base-context'
import type { BatchPreview, CurrentUser, SubmitResult } from './types'
import { demoPreview } from './demo'
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const response = await axiosForBackend({
      url,
      method: init?.method || 'GET',
      data: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: { 'Content-Type': 'application/json' },
    })
    return response.data as T
  } catch (cause) {
    const error = cause as { response?: { status?: number; data?: { message?: string; error?: { message?: string } } } }
    const payload = error.response?.data
    throw new Error(payload?.message || payload?.error?.message || `请求失败（${error.response?.status || '网络异常'}）`)
  }
}

export const api = {
  completeOAuth: (code: string, state: string) => request<{ ok: boolean }>('/api/oauth/callback', {
    method: 'POST',
    body: JSON.stringify({ code, state }),
  }),
  currentUser: () => new URLSearchParams(window.location.search).has('demo')
    ? Promise.resolve<CurrentUser>({ name: '早晚', openId: 'demo', authMode: 'oauth', verified: true, authorized: true })
    : request<CurrentUser>('/api/auth/me'),
  preview: (context: BaseContext) => new URLSearchParams(window.location.search).has('demo')
    ? Promise.resolve(demoPreview)
    : request<BatchPreview>(`/api/batches/preview?${new URLSearchParams({
      tableId: context.tableId || '',
      viewId: context.viewId || '',
    })}`),
  submit: (input: { reason: string; paymentEntity: string; expectedPaymentDate: string }) =>
    request<SubmitResult>('/api/batches/submit', {
      method: 'POST',
      body: JSON.stringify({ ...input, confirmed: true }),
    }),
  sync: () => request<unknown>('/api/approvals/sync', {
    method: 'POST',
    body: JSON.stringify({ confirmed: true }),
  }),
}

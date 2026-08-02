import type { BaseContext } from './base-context'
import type { BatchPreview, ClosurePreview, ClosureSubmitInput, ClosureSubmitResult, CurrentUser, SubmitResult } from './types'
import { demoClosurePreview, demoPreview } from './demo'
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const paymentSession = window.localStorage.getItem('payment_feishu_session')
    const isFormData = init?.body instanceof FormData
    const response = await axiosForBackend({
      url,
      method: init?.method || 'GET',
      data: isFormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(paymentSession ? { 'X-Payment-Session': paymentSession } : {}),
      },
    })
    const refreshedSession = response.headers?.['x-payment-session']
    if (typeof refreshedSession === 'string' && refreshedSession) {
      window.localStorage.setItem('payment_feishu_session', refreshedSession)
    }
    return response.data as T
  } catch (cause) {
    const error = cause as { response?: { status?: number; data?: { message?: string; error?: { message?: string } } } }
    if (error.response?.status === 401) window.localStorage.removeItem('payment_feishu_session')
    const payload = error.response?.data
    throw new Error(payload?.message || payload?.error?.message || `请求失败（${error.response?.status || '网络异常'}）`)
  }
}

export const api = {
  completeOAuth: async (code: string, state: string) => {
    const result = await request<{ ok: boolean; session: string }>('/api/oauth/callback', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    })
    window.localStorage.setItem('payment_feishu_session', result.session)
    return result
  },
  currentUser: () => new URLSearchParams(window.location.search).has('demo')
    ? Promise.resolve<CurrentUser>({ name: '演示用户', openId: 'demo', authMode: 'oauth', verified: true, authorized: true })
    : request<CurrentUser>('/api/auth/me'),
  preview: (context: BaseContext) => new URLSearchParams(window.location.search).has('demo')
    ? Promise.resolve(demoPreview)
    : request<BatchPreview>(`/api/batches/preview?${new URLSearchParams({
      tableId: context.tableId || '',
      viewId: context.viewId || '',
    })}`),
  closurePreview: (context: BaseContext) => new URLSearchParams(window.location.search).has('demo')
    ? Promise.resolve(demoClosurePreview)
    : request<ClosurePreview>(`/api/closures/preview?${new URLSearchParams({
      tableId: context.tableId || '',
      viewId: context.viewId || '',
    })}`),
  submit: (
    input: { reason: string; paymentEntity: string; expectedPaymentDate: string; allowValidationErrors: boolean },
    files: { detailScreenshot: File; qrFile?: File | null; supportingFiles?: File[] },
  ) => {
    if (new URLSearchParams(window.location.search).has('demo')) {
      return Promise.resolve<SubmitResult>({
        Action: 'Submit',
        BatchId: 'DEMO-20260731-001',
        ApprovalType: 'Cloud',
        ExecutionMode: 'Approval',
        Submitted: true,
        InstanceCode: 'demo-instance-7f3c2d91',
        RecordCount: demoPreview.RecordCount,
        BaseAmount: demoPreview.TotalAmount,
        AmountWithServiceFee: demoPreview.ApprovalAmount,
        Next: '演示模式：已模拟生成审批实例，并回填审批编号、链接和状态字段。',
      })
    }
    const body = new FormData()
    body.append('payload', JSON.stringify({ ...input, confirmed: true }))
    body.append('detailScreenshot', files.detailScreenshot)
    if (files.qrFile) body.append('qrFile', files.qrFile)
    for (const file of files.supportingFiles || []) body.append('supportingFiles', file)
    return request<SubmitResult>('/api/batches/submit', {
      method: 'POST',
      body,
    })
  },
  submitClosure: (input: ClosureSubmitInput) => new URLSearchParams(window.location.search).has('demo')
    ? Promise.resolve<ClosureSubmitResult>({
      Action: 'ClosureSubmit',
      ClosureId: 'CLOSE-DEMO-20260731-001',
      Submitted: true,
      InstanceCode: 'demo-closure-instance-7f3c2d91',
      InstanceLink: 'https://example.com/demo-closure',
      SerialNumber: '202607310099',
      RecordCount: 1,
    })
    : request<ClosureSubmitResult>('/api/closures/submit', {
      method: 'POST',
      body: JSON.stringify({ ...input, confirmed: true }),
    }),
  sync: () => new URLSearchParams(window.location.search).has('demo')
    ? Promise.resolve({ ok: true })
    : request<unknown>('/api/approvals/sync', {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    }),
}

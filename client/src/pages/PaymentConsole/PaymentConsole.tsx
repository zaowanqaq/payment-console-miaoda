import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  WalletCards,
  FileCheck2,
  Link2,
  LoaderCircle,
  PanelRight,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import { api } from './api'
import { resolveBaseContext, subscribeToActiveTableChanges, type BaseContext } from './base-context'
import type { BatchPreview, ClosurePreview, ClosureSubmitResult, CurrentUser, SubmitResult } from './types'
import './payment-console.css'

function defaultPaymentDate() {
  const date = new Date()
  date.setDate(date.getDate() + 3)
  return date.toISOString().slice(0, 10)
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(value ?? 0)
}

function StatusDot({ valid }: { valid: boolean }) {
  return <span className={valid ? 'status-dot valid' : 'status-dot invalid'} />
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <div className="empty-symbol"><FileCheck2 size={27} /></div>
      <strong>暂无待提审明细</strong>
      <span>{message}</span>
    </div>
  )
}

function App() {
  const oauthParams = new URLSearchParams(window.location.search)
  const isDemo = oauthParams.has('demo')
  const isOAuthCallback = oauthParams.has('code') && oauthParams.has('state')
  const [oauthStatus, setOAuthStatus] = useState<'working' | 'done' | 'error'>('working')
  const [oauthError, setOAuthError] = useState('')
  const [authorizationPending, setAuthorizationPending] = useState(false)
  const [mode, setMode] = useState<'payment' | 'closure'>('payment')
  const [preview, setPreview] = useState<BatchPreview | null>(null)
  const [closurePreview, setClosurePreview] = useState<ClosurePreview | null>(null)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [baseContext, setBaseContext] = useState<BaseContext>({ embedded: false })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [paymentEntity, setPaymentEntity] = useState('')
  const [expectedPaymentDate, setExpectedPaymentDate] = useState(defaultPaymentDate)
  const [allowValidationErrors, setAllowValidationErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitStage, setSubmitStage] = useState(0)
  const [result, setResult] = useState<SubmitResult | ClosureSubmitResult | null>(null)
  const [supplierSource, setSupplierSource] = useState('外部供应商')
  const [qrFile, setQrFile] = useState<File | null>(null)
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([])
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const [deliverableFiles, setDeliverableFiles] = useState<File[]>([])
  const [counterpartyAmount, setCounterpartyAmount] = useState<number | null>(null)
  const captureRef = useRef<HTMLDivElement | null>(null)
  const refreshPromiseRef = useRef<Promise<void> | null>(null)
  const loadedOnceRef = useRef(false)
  const submittingRef = useRef(false)
  const paymentDefaultsKeyRef = useRef('')

  const refresh = useCallback((options: { sync?: boolean; showLoading?: boolean } = {}) => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current
    const showLoading = options.showLoading ?? !loadedOnceRef.current
    if (showLoading) setLoading(true)
    else setRefreshing(true)
    setError('')
    const request = (async () => {
      try {
        const context = await resolveBaseContext()
        const nextUser = await api.currentUser()
        setUser(nextUser)
        if (nextUser.authorized) setAuthorizationPending(false)
        setBaseContext(context)
        if (!nextUser.authorized) {
          setPreview(null)
          setClosurePreview(null)
          return
        }
        if (options.sync) await api.sync().catch(() => undefined)
        if (mode === 'closure') {
          const nextPreview = await api.closurePreview(context)
          setClosurePreview(nextPreview)
        } else {
          const nextPreview = await api.preview(context)
          setPreview(nextPreview)
          const defaultsKey = nextPreview.Records.map((record) => record.RecordId).join('|')
          if (paymentDefaultsKeyRef.current !== defaultsKey) {
            paymentDefaultsKeyRef.current = defaultsKey
            const currentEntity = nextPreview.Records[0]?.PaymentEntity || ''
            const normalizedEntity = ['新枝', '火勺', '游鸟'].includes(currentEntity)
              ? '新枝/火勺/游鸟'
              : currentEntity
            setPaymentEntity(normalizedEntity)
          }
          setReason((current) => {
            if (current || nextPreview.RecordCount === 0) return current
            const project = nextPreview.Records[0]?.ProjectName
            return project ? `${project}付款` : '项目费用付款'
          })
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : mode === 'closure' ? '读取结项申请失败' : '读取付款明细失败')
      } finally {
        loadedOnceRef.current = true
        if (showLoading) setLoading(false)
        else setRefreshing(false)
      }
    })()
    refreshPromiseRef.current = request.finally(() => {
      refreshPromiseRef.current = null
    })
    return refreshPromiseRef.current
  }, [mode])

  useEffect(() => {
    if (isOAuthCallback) {
      void api.completeOAuth(oauthParams.get('code') || '', oauthParams.get('state') || '')
        .then((result) => {
          setOAuthStatus('done')
          if (window.opener) {
            window.opener.postMessage({ type: 'payment-oauth-complete', session: result.session }, window.location.origin)
            window.setTimeout(() => window.close(), 500)
          } else {
            window.setTimeout(() => window.location.replace(window.location.pathname), 800)
          }
        })
        .catch((cause) => {
          setOAuthStatus('error')
          setOAuthError(cause instanceof Error ? cause.message : '飞书授权失败')
        })
      return
    }
    void refresh({ sync: true, showLoading: true })
  }, [])

  useEffect(() => {
    const handleOAuth = (event: MessageEvent) => {
      const message = event.data as { type?: string; session?: string } | string
      if (event.origin === window.location.origin && typeof message === 'object' && message?.type === 'payment-oauth-complete' && message.session) {
        window.localStorage.setItem('payment_feishu_session', message.session)
        void refresh({ sync: true })
      }
    }
    window.addEventListener('message', handleOAuth)
    return () => window.removeEventListener('message', handleOAuth)
  }, [refresh])

  useEffect(() => {
    if (isOAuthCallback || user?.authorized) return
    const checkAuthorization = () => {
      if (!document.hidden) void refresh()
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'payment_feishu_session' && event.newValue) void refresh()
    }
    const pollTimer = window.setInterval(checkAuthorization, authorizationPending ? 1200 : 5000)
    window.addEventListener('focus', checkAuthorization)
    window.addEventListener('storage', handleStorage)
    document.addEventListener('visibilitychange', checkAuthorization)
    return () => {
      window.clearInterval(pollTimer)
      window.removeEventListener('focus', checkAuthorization)
      window.removeEventListener('storage', handleStorage)
      document.removeEventListener('visibilitychange', checkAuthorization)
    }
  }, [authorizationPending, isOAuthCallback, refresh, user?.authorized])

  useEffect(() => {
    if (isOAuthCallback) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let refreshTimer: number | undefined
    void subscribeToActiveTableChanges(() => {
      if (submittingRef.current) return
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void refresh(), 900)
    }).then((dispose) => {
      if (disposed) dispose()
      else unsubscribe = dispose
    }).catch(() => undefined)
    return () => {
      disposed = true
      window.clearTimeout(refreshTimer)
      unsubscribe?.()
    }
  }, [isOAuthCallback, refresh])

  useEffect(() => {
    if (!isOAuthCallback && loadedOnceRef.current) void refresh({ showLoading: true })
  }, [isOAuthCallback, mode, refresh])

  const submitLabel = '生成材料并发起审批'
  const hasValidationErrors = Boolean(preview?.Errors.length)
  const hasBlockingErrors = Boolean(preview?.BlockingErrors.length)
  const approvalType = preview?.ApprovalType
  const requiredQr = Boolean(preview?.RequiredUploads.some((upload) => upload.Key === 'qr' && upload.Required))
  const requiredCorporateUploads = approvalType !== 'Corporate' || (invoiceFiles.length > 0 && evidenceFiles.length > 0)
  const requiredCounterpartyAmount = approvalType !== 'Cloud' || Number(counterpartyAmount) > 0
  const paymentEntityReady = approvalType !== 'Corporate' || paymentEntity.trim()
  const uploadsReady = (!requiredQr || Boolean(qrFile)) && requiredCorporateUploads && requiredCounterpartyAmount
  const isReady = Boolean(preview?.RecordCount && !hasBlockingErrors && uploadsReady && (preview.CanSubmit || allowValidationErrors) && reason.trim() && paymentEntityReady && expectedPaymentDate && !submitting)
  const rowErrorCount = useMemo(
    () => preview?.Records.filter((record) => record.Errors.length > 0).length ?? 0,
    [preview],
  )
  const selectedRecordKey = preview?.Records.map((record) => record.RecordId).join('|') || ''
  const closureReady = Boolean(
    closurePreview?.CanSubmit
    && supplierSource
    && !submitting,
  )

  useEffect(() => {
    setQrFile(null)
    setInvoiceFiles([])
    setEvidenceFiles([])
    setDeliverableFiles([])
    setCounterpartyAmount(null)
  }, [selectedRecordKey])

  if (isOAuthCallback) {
    return (
      <div className="oauth-callback">
        {oauthStatus === 'working' && <LoaderCircle className="spin" size={28} />}
        {oauthStatus === 'done' && <CheckCircle2 size={30} />}
        {oauthStatus === 'error' && <AlertCircle size={30} />}
        <h1>{oauthStatus === 'working' ? '正在完成飞书授权' : oauthStatus === 'done' ? '授权完成' : '授权未完成'}</h1>
        <p>{oauthStatus === 'error' ? oauthError : oauthStatus === 'done' ? '窗口即将自动关闭' : '请稍候'}</p>
      </div>
    )
  }

  async function submit() {
    setSubmitting(true)
    submittingRef.current = true
    setSubmitStage(1)
    const timer = window.setInterval(() => {
      setSubmitStage((stage) => Math.min(stage + 1, 4))
    }, 1200)
    try {
      if (!captureRef.current) throw new Error('付款执行明细截图区域尚未准备好，请刷新后重试')
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const screenshotBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('付款执行明细截图生成失败')), 'image/png')
      })
      const screenshot = new File([screenshotBlob], '付款执行明细.png', { type: 'image/png' })
      const nextResult = await api.submit(
        { reason, paymentEntity, expectedPaymentDate, counterpartyAmount, allowValidationErrors },
        { detailScreenshot: screenshot, qrFile, invoiceFiles, evidenceFiles, deliverableFiles },
      )
      setSubmitStage(5)
      setResult(nextResult)
      setQrFile(null)
      setInvoiceFiles([])
      setEvidenceFiles([])
      setDeliverableFiles([])
      setCounterpartyAmount(null)
      void refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提审失败')
    } finally {
      window.clearInterval(timer)
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  async function submitClosure() {
    setSubmitting(true)
    submittingRef.current = true
    setSubmitStage(1)
    const timer = window.setInterval(() => setSubmitStage((stage) => Math.min(stage + 1, 4)), 900)
    try {
      const nextResult = await api.submitClosure({
        supplierSource,
      })
      setSubmitStage(5)
      setResult(nextResult)
      void refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目结项提审失败')
    } finally {
      window.clearInterval(timer)
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  return (
    <div className={`app-shell ${baseContext.embedded ? 'embedded-shell' : ''}`}>
      {error && (
        <div className="floating-error" role="alert" aria-live="assertive">
          <AlertCircle size={18} />
          <div><strong>操作未完成</strong><span>{error}</span></div>
          <button onClick={() => setError('')} title="关闭"><X size={16} /></button>
        </div>
      )}

      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark"><WalletCards size={20} /></span>
          <div>
            <h1>付款提审台</h1>
            <p>媒介项目费控</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="mode-switch" aria-label="业务流程切换">
            <button className={mode === 'payment' ? 'active' : ''} onClick={() => setMode('payment')}>
              <CircleDollarSign size={14} />付款
            </button>
            <button className={mode === 'closure' ? 'active' : ''} onClick={() => setMode('closure')}>
              <ClipboardCheck size={14} />项目结项
            </button>
          </div>
          <div className="context-pill">
            <Link2 size={14} />
            {isDemo ? '演示模式 · 脱敏数据' : baseContext.embedded ? '已连接当前 Base' : '本地联调'}
          </div>
          <button className="icon-button" onClick={() => void refresh({ sync: true })} disabled={loading || refreshing} title="刷新">
            <RefreshCw size={17} className={loading || refreshing ? 'spin' : ''} />
          </button>
          <div className="identity">
            <span className="avatar">{user?.name?.slice(0, 1) || '早'}</span>
            <div>
              <strong>{user?.name || '正在识别'}</strong>
              <span>{user?.authorized ? '飞书登录用户' : '待授权'}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="workspace">
        {mode === 'payment' ? <>
        <section className="records-pane">
          <div className="section-heading">
            <div>
              <span className="eyebrow">本次批次</span>
              <h2>待提交明细</h2>
            </div>
            <div className="batch-meta">
              <div><strong>{preview?.RecordCount ?? 0}</strong><span>条明细</span></div>
              <div><strong>{money(preview?.TotalAmount)}</strong><span>{preview?.ApprovalType === 'Wallet' ? '价格合计' : '实际成本'}</span></div>
              <div><strong>{preview?.DefinitionName || '待识别'}</strong><span>审批定义</span></div>
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button onClick={() => setError('')} title="关闭"><X size={16} /></button>
            </div>
          )}

          <div className="records-table-wrap">
            {loading ? (
              <div className="loading-state"><LoaderCircle className="spin" /><span>正在核对付款明细</span></div>
            ) : preview?.Records.length ? (
              <table className="records-table">
                <thead>
                  <tr>
                    <th>明细</th>
                    <th>项目 / 资源</th>
                    <th>付款状态</th>
                    <th>附件</th>
                    <th className="number-cell">实际成本</th>
                    <th aria-label="校验结果" />
                  </tr>
                </thead>
                <tbody>
                  {preview.Records.map((record) => {
                    const valid = record.Errors.length === 0
                    return (
                      <tr key={record.RecordId} className={valid ? '' : 'row-invalid'}>
                        <td>
                          <strong className="record-name">{record.Name}</strong>
                          <span className="record-sub">{record.Recipient || '未填写收款人'}</span>
                        </td>
                        <td>
                          <span className="primary-text">{record.ProjectName || '未关联项目'}</span>
                          <span className="record-sub">
                            {record.ProjectLinked && record.ResourceLinked ? '审批关联已校验' : record.ResourceAccount || '未关联资源'}
                          </span>
                        </td>
                        <td>
                          <div className="condition-line"><StatusDot valid={record.PaymentProgress === '已对账'} />{record.PaymentProgress || '未对账'}</div>
                          <div className="condition-line"><StatusDot valid={Boolean(record.PaymentMethod)} />{record.PaymentMethod || '付款形式未带出'}</div>
                        </td>
                        <td><span className="attachment-count"><FileCheck2 size={15} />{record.AttachmentCount}</span></td>
                        <td className="number-cell"><strong>{money(record.Cost)}</strong></td>
                        <td>
                          <span className={valid ? 'result-icon valid' : 'result-icon invalid'} title={record.Errors.join('\n')}>
                            {valid ? <Check size={15} /> : <AlertCircle size={15} />}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState message="付款执行明细中尚未勾选可提交记录" />
            )}
          </div>
        </section>

        <aside className="submit-pane">
          <div className="panel-heading">
            <div><PanelRight size={17} /><h2>提交设置</h2></div>
            <span className={preview?.CanSubmit ? 'readiness ready' : 'readiness blocked'}>
              {preview?.CanSubmit ? '校验通过' : `${preview?.Errors.length ?? 0} 项待处理`}
            </span>
          </div>

          <div className="validation-summary">
            <div className="validation-title">
              {preview?.CanSubmit ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
              <strong>{preview?.CanSubmit ? '批次条件完整' : hasBlockingErrors ? '审批必填项待补充' : allowValidationErrors ? '已允许带问题提交' : '批次暂不可提交'}</strong>
            </div>
            <span>{rowErrorCount > 0 ? `${rowErrorCount} 条明细存在问题` : '资源、项目及付款条件已核对'}</span>
            {preview?.Errors.slice(0, 4).map((item) => <p key={item}>{item}</p>)}
          </div>

          {hasValidationErrors && !hasBlockingErrors && preview?.RecordCount ? (
            <label className="override-toggle">
              <input type="checkbox" checked={allowValidationErrors} onChange={(event) => setAllowValidationErrors(event.target.checked)} />
              <span>
                <strong>允许带问题提交</strong>
                <small>仅跳过本次预检拦截，具体审批仍由飞书流程审核</small>
              </span>
            </label>
          ) : null}

          {hasBlockingErrors && preview?.RecordCount ? (
            <div className="account-notice">
              <AlertCircle size={18} />
              <span>{preview.BlockingErrors[0]} 必填项不能通过“允许带问题提交”跳过。</span>
            </div>
          ) : null}

          {preview?.ExecutionMode === 'Approval' && !preview?.AutoSubmitEnabled && preview?.RecordCount > 0 && (
            <div className="account-notice">
              <ShieldCheck size={18} />
              <span>当前审批定义的 Code、名称或可自动填写控件尚未配置完整，请联系插件管理员检查。</span>
            </div>
          )}

          <div className="form-stack">
            <label>
              <span>付款事由</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="请输入付款事由" />
              <small className="file-hint">四种付款形式均必填</small>
            </label>

            {approvalType === 'Cloud' && (<>
              <label>
                <span>对方收款金额</span>
                <input type="number" min="0.01" step="0.01" value={counterpartyAmount ?? ''} onChange={(event) => setCounterpartyAmount(event.target.value ? Number(event.target.value) : null)} placeholder="请输入对方实际收款金额" />
                <small className="file-hint">手动填写，不使用付款执行明细的实际成本</small>
              </label>
              <label>
                <span>期望付款日期</span>
                <input type="date" value={expectedPaymentDate} onChange={(event) => setExpectedPaymentDate(event.target.value)} />
              </label>
            </>)}

            {approvalType === 'Corporate' && (<>
              <label>
                <span>付款主体</span>
                <select value={paymentEntity} onChange={(event) => setPaymentEntity(event.target.value)}>
                  <option value="">请选择付款主体</option>
                  {preview.PaymentEntityOptions.map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span>付款日期</span>
                <input type="date" value={expectedPaymentDate} onChange={(event) => setExpectedPaymentDate(event.target.value)} />
              </label>
              <label>
                <span>发票（必填）</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(event) => setInvoiceFiles(Array.from(event.target.files || []))} />
                {invoiceFiles.length > 0 && <small className="file-hint">已选择 {invoiceFiles.length} 个文件</small>}
              </label>
              <label>
                <span>对账凭证（必填）</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []))} />
                {evidenceFiles.length > 0 && <small className="file-hint">已选择 {evidenceFiles.length} 个文件</small>}
              </label>
              <label>
                <span>交付物（可选）</span>
                <input type="file" multiple onChange={(event) => setDeliverableFiles(Array.from(event.target.files || []))} />
              </label>
            </>)}

            {approvalType === 'CloudSingle' && (
              <label>
                <span>交付物（可选）</span>
                <input type="file" multiple onChange={(event) => setDeliverableFiles(Array.from(event.target.files || []))} />
                <small className="file-hint">银行卡号、身份证号、真实姓名、联系电话从资源入库自动带出</small>
              </label>
            )}

            {approvalType === 'Wallet' && (
              <label>
                <span>收款二维码（必填）</span>
                <input type="file" accept="image/*" onChange={(event) => setQrFile(event.target.files?.[0] || null)} />
                {qrFile && <small className="file-hint">{qrFile.name}</small>}
              </label>
            )}
          </div>

          <div className="submit-footer">
            <div className="initiator-line">
              <UserRound size={15} />
              <span>发起人</span>
              <strong>{user?.name || '未识别'}</strong>
            </div>
            {!user?.authorized && user?.authorizeUrl ? (
              <a
                className="primary-button"
                href={user.authorizeUrl}
                target="_blank"
                rel="opener"
                onClick={() => setAuthorizationPending(true)}
              >
                <ShieldCheck size={18} />{authorizationPending ? '等待授权完成' : '授权飞书后继续'}<ChevronRight size={17} />
              </a>
            ) : <button className={`primary-button ${allowValidationErrors && hasValidationErrors ? 'warning-button' : ''}`} disabled={!isReady} onClick={() => void submit()}>
              {submitting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
              {submitting ? '正在处理' : submitLabel}
              {!submitting && <ChevronRight size={17} />}
            </button>}
          </div>
        </aside>
        </> : <>
          <section className="records-pane closure-records-pane">
            <div className="section-heading">
              <div>
                <span className="eyebrow">结项留档</span>
                <h2>待发起项目</h2>
              </div>
              <div className="batch-meta">
                <div><strong>{closurePreview?.RecordCount ?? 0}</strong><span>条勾选</span></div>
                <div><strong>{money(closurePreview?.TotalAmount)}</strong><span>共计金额</span></div>
                <div><strong>{closurePreview?.DefinitionName || '【测试】用于成本结项'}</strong><span>审批定义</span></div>
              </div>
            </div>

            <div className="records-table-wrap">
              {loading ? (
                <div className="loading-state"><LoaderCircle className="spin" /><span>正在核对结项申请</span></div>
              ) : closurePreview?.Records.length ? (
                <table className="records-table closure-table">
                  <thead>
                    <tr>
                      <th>执行明细</th>
                      <th>关联项目</th>
                      <th>项目 PM</th>
                      <th className="number-cell">实际成本</th>
                      <th aria-label="校验结果" />
                    </tr>
                  </thead>
                  <tbody>
                    {closurePreview.Records.map((record) => {
                      const valid = record.Errors.length === 0
                      return (
                        <tr key={record.RecordId} className={valid ? '' : 'row-invalid'}>
                          <td><strong className="record-name">{record.Name}</strong><span className="record-sub">结项审批留档</span></td>
                          <td><span className="primary-text">{record.ProjectName || '未关联项目'}</span><span className="record-sub">{record.ProjectCode || '未带出项目编号'}</span></td>
                          <td><span className="primary-text">{record.ProjectPm || '未带出项目 PM'}</span></td>
                          <td className="number-cell"><strong>{money(record.Cost)}</strong></td>
                          <td>
                            <span className={valid ? 'result-icon valid' : 'result-icon invalid'} title={record.Errors.join('\n')}>
                              {valid ? <Check size={15} /> : <AlertCircle size={15} />}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : <EmptyState message="请在付款执行明细中勾选“申请结项选择框”" />}
            </div>
          </section>

          <aside className="submit-pane">
            <div className="panel-heading">
              <div><ClipboardCheck size={17} /><h2>结项信息</h2></div>
              <span className={closurePreview?.CanSubmit ? 'readiness ready' : 'readiness blocked'}>
                {closurePreview?.CanSubmit ? '校验通过' : `${closurePreview?.BlockingErrors.length ?? 0} 项待处理`}
              </span>
            </div>

            <div className="validation-summary">
              <div className="validation-title">
                {closurePreview?.CanSubmit ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
                <strong>{closurePreview?.CanSubmit ? '可发起结项审批' : '结项申请暂不可提交'}</strong>
              </div>
              <span>可勾选同一立项下的一条或多条执行明细；项目字段及 CSV 由系统自动生成。</span>
              {closurePreview?.BlockingErrors.slice(0, 4).map((item) => <p key={item}>{item}</p>)}
            </div>

            <div className="form-stack closure-form">
              <label>
                <span>供应商来源</span>
                <select value={supplierSource} onChange={(event) => setSupplierSource(event.target.value)}>
                  {(closurePreview?.SupplierSourceOptions || ['外部供应商', '内部供应商']).map((option) => <option key={option}>{option}</option>)}
                </select>
              </label>
            </div>

            <div className="submit-footer">
              <div className="initiator-line"><UserRound size={15} /><span>发起人</span><strong>{user?.name || '未识别'}</strong></div>
              {!user?.authorized && user?.authorizeUrl ? (
                <a className="primary-button" href={user.authorizeUrl} target="_blank" rel="opener" onClick={() => setAuthorizationPending(true)}>
                  <ShieldCheck size={18} />{authorizationPending ? '等待授权完成' : '授权飞书后继续'}<ChevronRight size={17} />
                </a>
              ) : (
                <button className="primary-button" disabled={!closureReady} onClick={() => void submitClosure()}>
                  {submitting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
                  {submitting ? '正在发起' : '发起项目结项审批'}
                  {!submitting && <ChevronRight size={17} />}
                </button>
              )}
            </div>
          </aside>
        </>}
      </main>

      {mode === 'payment' && preview && (
        <div className="capture-stage" aria-hidden="true">
          <div className="capture-sheet" ref={captureRef}>
            <div className="capture-header">
              <div>
                <span>媒介项目费控</span>
                <h2>付款执行明细</h2>
                <p>{preview.DefinitionName}</p>
              </div>
              <div className="capture-summary">
                <div><span>付款事由</span><strong>{reason || '—'}</strong></div>
                <div><span>付款主体</span><strong>{paymentEntity}</strong></div>
                <div><span>期望付款日期</span><strong>{expectedPaymentDate}</strong></div>
                <div><span>记录数</span><strong>{preview.RecordCount}</strong></div>
                <div><span>{preview.ApprovalType === 'Wallet' ? '价格合计' : '实际成本'}</span><strong>{money(preview.TotalAmount)}</strong></div>
                <div>
                  <span>{preview.ServiceFeeRate ? '审批金额（含6.65%）' : '审批金额'}</span>
                  <strong>{money(preview.ApprovalAmount)}</strong>
                </div>
              </div>
            </div>
            <table className="capture-table">
              <thead>
                <tr>
                  <th>项目编号</th>
                  <th>项目名称</th>
                  <th>承接主体</th>
                  <th>资源账号 / 收款人</th>
                  <th>平台 / 内容</th>
                  <th>付款形式</th>
                  <th>实际成本</th>
                  {preview.ApprovalType === 'CloudSingle' ? <>
                    <th>真实姓名</th>
                    <th>银行卡号</th>
                    <th>身份证号</th>
                    <th>联系电话</th>
                  </> : <>
                    <th>收款户名</th>
                    <th>收款账号</th>
                    <th>开户银行</th>
                    <th>开户支行</th>
                    <th>开户省</th>
                    <th>开户市</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {preview.Records.map((record) => (
                  <tr key={record.RecordId}>
                    <td>{record.ProjectCode || '—'}</td>
                    <td>{record.ProjectName || '—'}</td>
                    <td>{record.RecipientEntity || '—'}</td>
                    <td>{record.ResourceAccount || '—'}<small>{record.Recipient || '—'}</small></td>
                    <td>
                      {record.Platform || '—'}
                      <small>{[record.Account, record.Topic, record.Link].filter(Boolean).join(' · ') || '—'}</small>
                    </td>
                    <td>{record.PaymentMethod || '—'}<small>{record.TaxRate ? `税点：${record.TaxRate}` : '—'}</small></td>
                    <td className="capture-money">{money(record.Cost)}</td>
                    {preview.ApprovalType === 'CloudSingle' ? <>
                      <td>{record.PayeeAccountName || '—'}</td>
                      <td>{record.PayeeAccountNumber || '—'}</td>
                      <td>{record.PersonalIdNumber || '—'}</td>
                      <td>{record.Phone || '—'}</td>
                    </> : <>
                      <td>{record.PayeeAccountName || '—'}<small>{record.AccountType || '—'}</small></td>
                      <td>{record.PayeeAccountNumber || '—'}</td>
                      <td>{record.BankName || '—'}</td>
                      <td>{record.BankBranch || '—'}</td>
                      <td>{record.Province || '—'}</td>
                      <td>{record.City || '—'}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="capture-all-fields">
              <h3>付款执行明细全部字段</h3>
              {preview.Records.map((record) => (
                <section key={`${record.RecordId}-all-fields`}>
                  <h4>{record.Name}</h4>
                  <table className="capture-table capture-fields-table">
                    <thead><tr><th>字段</th><th>值</th></tr></thead>
                    <tbody>
                      {(record.AllFields || []).map((field) => (
                        <tr key={`${record.RecordId}-${field.Name}`}><td>{field.Name}</td><td>{field.Value || '—'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
            <div className="capture-footer">
              <span>截图由付款提审台根据付款执行明细自动生成</span>
              <span>{new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
            </div>
          </div>
        </div>
      )}

      {submitting && (
        <div className="progress-dock">
          <LoaderCircle className="spin" size={19} />
          <div>
            <strong>{mode === 'closure' ? '正在处理项目结项' : '正在处理付款批次'}</strong>
            <span>{(mode === 'closure'
              ? ['校验结项信息', '组装审批表单', '发起审批', '读取审批编号', '回填 Base']
              : ['生成明细截图', '上传截图与附件', '组装审批表单', '发起审批', '回填 Base'])[Math.max(0, submitStage - 1)]}</span>
          </div>
          <div className="progress-track"><span style={{ width: `${Math.max(12, submitStage * 20)}%` }} /></div>
        </div>
      )}

      {result && !submitting && (
        <div className="modal-backdrop">
          <div className="dialog result-dialog" role="dialog" aria-modal="true">
            <button className="dialog-close" onClick={() => setResult(null)} title="关闭"><X size={17} /></button>
            <span className="dialog-icon success"><CheckCircle2 size={24} /></span>
            <h3>审批已发起</h3>
            <p>{result.Action === 'ClosureSubmit' ? `项目结项 ${result.SerialNumber || result.ClosureId}` : `付款批次 ${result.BatchId}`}</p>
            {result.InstanceCode && <code>{result.InstanceCode}</code>}
            {result.Action === 'Submit' && result.Blocker && <div className="result-note">{result.Blocker}</div>}
            {result.Action === 'Submit' && result.Next && <div className="result-note demo-result-note">{result.Next}</div>}
            <div className="dialog-actions single">
              {(result.InstanceLink || (result.Action === 'Submit' && result.ApprovalLink)) && (
                <a className="primary-button compact" href={result.InstanceLink || (result.Action === 'Submit' ? result.ApprovalLink : undefined)} target="_blank" rel="noreferrer">
                  打开审批<ArrowUpRight size={17} />
                </a>
              )}
              <button className="secondary-button" onClick={() => setResult(null)}>完成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App



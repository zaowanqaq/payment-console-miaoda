import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
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
import type { BatchPreview, CurrentUser, SubmitResult } from './types'
import './payment-console.css'

const paymentEntities = ['游鸟科技', '游鸟文化', '新枝', '火勺', '回山', '悉多']

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
  const isOAuthCallback = oauthParams.has('code') && oauthParams.has('state')
  const [oauthStatus, setOAuthStatus] = useState<'working' | 'done' | 'error'>('working')
  const [oauthError, setOAuthError] = useState('')
  const [authorizationPending, setAuthorizationPending] = useState(false)
  const [preview, setPreview] = useState<BatchPreview | null>(null)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [baseContext, setBaseContext] = useState<BaseContext>({ embedded: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [paymentEntity, setPaymentEntity] = useState('游鸟科技')
  const [expectedPaymentDate, setExpectedPaymentDate] = useState(defaultPaymentDate)
  const [allowValidationErrors, setAllowValidationErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitStage, setSubmitStage] = useState(0)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [qrFile, setQrFile] = useState<File | null>(null)
  const [supportingFiles, setSupportingFiles] = useState<File[]>([])
  const captureRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const context = await resolveBaseContext()
      const nextUser = await api.currentUser()
      setUser(nextUser)
      if (nextUser.authorized) setAuthorizationPending(false)
      setBaseContext(context)
      if (!nextUser.authorized) {
        setPreview(null)
        return
      }
      // Best-effort backfill: connector-synced native approvals and API-created
      // approvals are reconciled whenever the console opens or refreshes.
      await api.sync().catch(() => undefined)
      const nextPreview = await api.preview(context)
      setPreview(nextPreview)
      if (!reason && nextPreview.RecordCount > 0) {
        const project = nextPreview.Records[0]?.ProjectName
        setReason(project ? `${project}付款` : '项目费用付款')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取付款明细失败')
    } finally {
      setLoading(false)
    }
  }, [reason])

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
    void refresh()
  }, [])

  useEffect(() => {
    const handleOAuth = (event: MessageEvent) => {
      const message = event.data as { type?: string; session?: string } | string
      if (event.origin === window.location.origin && typeof message === 'object' && message?.type === 'payment-oauth-complete' && message.session) {
        window.localStorage.setItem('payment_feishu_session', message.session)
        void refresh()
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
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void refresh(), 350)
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

  const submitLabel = '生成材料并发起审批'
  const hasValidationErrors = Boolean(preview?.Errors.length)
  const hasBlockingErrors = Boolean(preview?.BlockingErrors.length)
  const requiredQr = Boolean(preview?.RequiredUploads.some((upload) => upload.Key === 'qr' && upload.Required))
  const requiredSupporting = Boolean(preview?.RequiredUploads.some(
    (upload) => upload.Key === 'supporting' && upload.Required && !upload.SatisfiedByBase,
  ))
  const uploadsReady = (!requiredQr || Boolean(qrFile)) && (!requiredSupporting || supportingFiles.length > 0)
  const isReady = Boolean(preview?.RecordCount && !hasBlockingErrors && uploadsReady && (preview.CanSubmit || allowValidationErrors) && reason.trim() && expectedPaymentDate && !submitting)
  const rowErrorCount = useMemo(
    () => preview?.Records.filter((record) => record.Errors.length > 0).length ?? 0,
    [preview],
  )
  const selectedRecordKey = preview?.Records.map((record) => record.RecordId).join('|') || ''

  useEffect(() => {
    setQrFile(null)
    setSupportingFiles([])
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
        { reason, paymentEntity, expectedPaymentDate, allowValidationErrors },
        { detailScreenshot: screenshot, qrFile, supportingFiles },
      )
      setSubmitStage(5)
      setResult(nextResult)
      setQrFile(null)
      setSupportingFiles([])
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提审失败')
    } finally {
      window.clearInterval(timer)
      setSubmitting(false)
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
          <div className="context-pill">
            <Link2 size={14} />
            {baseContext.embedded ? '已连接当前 Base' : '本地联调'}
          </div>
          <button className="icon-button" onClick={() => void refresh()} disabled={loading} title="刷新">
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
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
        <section className="records-pane">
          <div className="section-heading">
            <div>
              <span className="eyebrow">本次批次</span>
              <h2>待提交明细</h2>
            </div>
            <div className="batch-meta">
              <div><strong>{preview?.RecordCount ?? 0}</strong><span>条明细</span></div>
              <div><strong>{money(preview?.TotalAmount)}</strong><span>实际成本</span></div>
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
                    <th>付款条件</th>
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
                          <div className="condition-line"><StatusDot valid={record.AcceptanceStatus === '已验收'} />{record.AcceptanceStatus || '待验收'}</div>
                          <div className="condition-line"><StatusDot valid={['已签署', '无需合同'].includes(record.ContractStatus || '')} />{record.ContractStatus || '合同未填写'}</div>
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
            </label>
            <label>
              <span>付款主体</span>
              <select value={paymentEntity} onChange={(event) => setPaymentEntity(event.target.value)}>
                {paymentEntities.map((entity) => <option key={entity}>{entity}</option>)}
              </select>
            </label>
            <label>
              <span>期望付款日期</span>
              <input type="date" value={expectedPaymentDate} onChange={(event) => setExpectedPaymentDate(event.target.value)} />
            </label>
            {preview?.RequiredUploads.some((upload) => upload.Key === 'supporting') && (
              <label>
                <span>
                  补充审批附件
                  {preview.RequiredUploads.some((upload) => upload.Key === 'supporting' && upload.SatisfiedByBase)
                    ? '（付款明细已有凭证，可选）'
                    : '（必填）'}
                </span>
                <input
                  type="file"
                  multiple
                  onChange={(event) => setSupportingFiles(Array.from(event.target.files || []))}
                />
                {supportingFiles.length > 0 && <small className="file-hint">已选择 {supportingFiles.length} 个文件</small>}
              </label>
            )}
            {preview?.RequiredUploads.some((upload) => upload.Key === 'qr') && (
              <label>
                <span>收款二维码（必填）</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => setQrFile(event.target.files?.[0] || null)}
                />
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
      </main>

      {preview && (
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
                <div><span>实际成本</span><strong>{money(preview.TotalAmount)}</strong></div>
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
                  <th>付款明细</th>
                  <th>资源账号 / 收款人</th>
                  <th>平台 / 内容</th>
                  <th>付款形式</th>
                  <th>实际成本</th>
                  <th>收款户名</th>
                  <th>收款账号</th>
                  <th>开户银行</th>
                  <th>开户支行</th>
                  <th>开户省</th>
                  <th>开户市</th>
                </tr>
              </thead>
              <tbody>
                {preview.Records.map((record) => (
                  <tr key={record.RecordId}>
                    <td>{record.ProjectCode || '—'}</td>
                    <td>{record.ProjectName || '—'}</td>
                    <td>{record.Name}</td>
                    <td>{record.ResourceAccount || '—'}<small>{record.Recipient || '—'}</small></td>
                    <td>
                      {record.Platform || '—'}
                      <small>{[record.Account, record.Topic, record.Link].filter(Boolean).join(' · ') || '—'}</small>
                    </td>
                    <td>{record.PaymentMethod || '—'}<small>{record.TaxRate ? `税点：${record.TaxRate}` : '—'}</small></td>
                    <td className="capture-money">{money(record.Cost)}</td>
                    <td>{record.PayeeAccountName || '—'}<small>{record.AccountType || '—'}</small></td>
                    <td>{record.PayeeAccountNumber || '—'}</td>
                    <td>{record.BankName || '—'}</td>
                    <td>{record.BankBranch || '—'}</td>
                    <td>{record.Province || '—'}</td>
                    <td>{record.City || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <div><strong>正在处理付款批次</strong><span>{['生成明细截图', '上传截图与附件', '组装审批表单', '发起审批', '回填 Base'][Math.max(0, submitStage - 1)]}</span></div>
          <div className="progress-track"><span style={{ width: `${Math.max(12, submitStage * 20)}%` }} /></div>
        </div>
      )}

      {result && !submitting && (
        <div className="modal-backdrop">
          <div className="dialog result-dialog" role="dialog" aria-modal="true">
            <button className="dialog-close" onClick={() => setResult(null)} title="关闭"><X size={17} /></button>
            <span className="dialog-icon success"><CheckCircle2 size={24} /></span>
            <h3>{result.Submitted ? '审批已发起' : '审批材料已准备'}</h3>
            <p>付款批次 {result.BatchId}</p>
            {result.InstanceCode && <code>{result.InstanceCode}</code>}
            {result.Blocker && <div className="result-note">{result.Blocker}</div>}
            <div className="dialog-actions single">
              {(result.InstanceLink || result.ApprovalLink) && (
                <a className="primary-button compact" href={result.InstanceLink || result.ApprovalLink} target="_blank" rel="noreferrer">
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

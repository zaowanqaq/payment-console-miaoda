import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
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
import { resolveBaseContext, type BaseContext } from './base-context'
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
  const [preview, setPreview] = useState<BatchPreview | null>(null)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [baseContext, setBaseContext] = useState<BaseContext>({ embedded: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [paymentEntity, setPaymentEntity] = useState('游鸟科技')
  const [expectedPaymentDate, setExpectedPaymentDate] = useState(defaultPaymentDate)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitStage, setSubmitStage] = useState(0)
  const [result, setResult] = useState<SubmitResult | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const context = await resolveBaseContext()
      const nextUser = await api.currentUser()
      setUser(nextUser)
      setBaseContext(context)
      if (!nextUser.authorized) {
        setPreview(null)
        return
      }
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

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    const handleOAuth = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data === 'payment-oauth-complete') void refresh()
    }
    window.addEventListener('message', handleOAuth)
    return () => window.removeEventListener('message', handleOAuth)
  }, [refresh])

  const submitLabel = preview?.ApprovalType === 'Project' ? '准备审批附件' : '确认发起审批'
  const isReady = Boolean(preview?.CanSubmit && reason.trim() && expectedPaymentDate && !submitting)
  const rowErrorCount = useMemo(
    () => preview?.Records.filter((record) => record.Errors.length > 0).length ?? 0,
    [preview],
  )

  async function submit() {
    setConfirming(false)
    setSubmitting(true)
    setSubmitStage(1)
    const timer = window.setInterval(() => {
      setSubmitStage((stage) => Math.min(stage + 1, 4))
    }, 1200)
    try {
      const nextResult = await api.submit({ reason, paymentEntity, expectedPaymentDate })
      setSubmitStage(5)
      setResult(nextResult)
      if (!nextResult.Submitted && nextResult.ApprovalLink) {
        window.open(nextResult.ApprovalLink, '_blank', 'noopener,noreferrer')
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提审失败')
    } finally {
      window.clearInterval(timer)
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark"><CircleDollarSign size={20} /></span>
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
                          <span className="record-sub">{record.ResourceAccount || '未关联资源'}</span>
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
              <strong>{preview?.CanSubmit ? '批次条件完整' : '批次暂不可提交'}</strong>
            </div>
            <span>{rowErrorCount > 0 ? `${rowErrorCount} 条明细存在问题` : '资源、项目及付款条件已核对'}</span>
            {preview?.Errors.slice(0, 4).map((item) => <p key={item}>{item}</p>)}
          </div>

          {preview?.ApprovalType === 'Project' && preview.RecordCount > 0 && (
            <div className="account-notice">
              <ShieldCheck size={18} />
              <span>该审批包含银行账户控件，本次将自动完成明细及附件准备。</span>
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
          </div>

          <div className="submit-footer">
            <div className="initiator-line">
              <UserRound size={15} />
              <span>发起人</span>
              <strong>{user?.name || '未识别'}</strong>
            </div>
            {!user?.authorized && user?.authorizeUrl ? (
              <a className="primary-button" href={user.authorizeUrl} target="_blank" rel="noreferrer">
                <ShieldCheck size={18} />授权飞书后继续<ChevronRight size={17} />
              </a>
            ) : <button className="primary-button" disabled={!isReady} onClick={() => setConfirming(true)}>
              {submitting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
              {submitting ? '正在处理' : submitLabel}
              {!submitting && <ChevronRight size={17} />}
            </button>}
          </div>
        </aside>
      </main>

      {confirming && preview && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirming(false)}>
          <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button className="dialog-close" onClick={() => setConfirming(false)} title="关闭"><X size={17} /></button>
            <span className="dialog-icon"><Send size={22} /></span>
            <h3>{preview.ApprovalType === 'Project' ? '确认准备审批' : '确认发起付款审批'}</h3>
            <p>{preview.RecordCount} 条付款明细，合计 {money(preview.TotalAmount)}</p>
            <dl>
              <div><dt>审批定义</dt><dd>{preview.DefinitionName}</dd></div>
              <div><dt>发起人</dt><dd>{user?.name}</dd></div>
              <div><dt>付款主体</dt><dd>{paymentEntity}</dd></div>
              <div><dt>期望付款</dt><dd>{expectedPaymentDate}</dd></div>
            </dl>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setConfirming(false)}>取消</button>
              <button className="primary-button compact" onClick={() => void submit()}><Send size={17} />确认执行</button>
            </div>
          </div>
        </div>
      )}

      {submitting && (
        <div className="progress-dock">
          <LoaderCircle className="spin" size={19} />
          <div><strong>正在处理付款批次</strong><span>{['读取记录', '生成明细', '上传附件', '发起审批', '回填 Base'][Math.max(0, submitStage - 1)]}</span></div>
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

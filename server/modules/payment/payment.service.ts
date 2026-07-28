import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { FeishuService } from './feishu.service';
import { PaymentConfig } from './payment.config';
import type { AttachmentEntry, BaseRecord, BatchPreview } from './payment.types';

type BaseListResponse = {
  data: unknown[][];
  fields: string[];
  record_id_list: string[];
  has_more: boolean;
};

type ApprovalType = 'Cloud' | 'Corporate' | 'Wallet' | 'Unknown';

type ParsedResourceAccount = {
  sourceInstanceCode: string;
  status: string;
  accountName: string | null;
  accountNumber: string | null;
  bankName: string | null;
  bankBranch: string | null;
  province: string | null;
  city: string | null;
  accountType: string | null;
};

@Injectable()
export class PaymentService {
  constructor(private readonly feishu: FeishuService, private readonly config: PaymentConfig) {}

  private scalar(value: unknown): unknown {
    if (value == null) return null;
    if (Array.isArray(value)) {
      if (!value.length) return null;
      if (value.length === 1) return this.scalar(value[0]);
      return value.map((item) => this.scalar(item)).filter((item) => item != null).join(',');
    }
    if (typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text);
    return value;
  }

  private text(value: unknown): string | null {
    const result = this.scalar(value);
    return result == null || result === '' ? null : String(result);
  }

  private number(value: unknown): number | null {
    const result = Number(this.scalar(value));
    return Number.isFinite(result) ? result : null;
  }

  private hasOption(value: unknown, allowed: string[]): boolean {
    const items = Array.isArray(value) ? value : [value];
    return items.some((item) => allowed.includes(String(this.scalar(item))));
  }

  private linkIds(value: unknown): string[] {
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item) => typeof item === 'object' && item && 'id' in item ? [String((item as { id: unknown }).id)] : []);
  }

  private userIds(value: unknown): string[] {
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item.trim()];
      if (item && typeof item === 'object' && 'id' in item) {
        const id = String((item as { id: unknown }).id || '').trim();
        return id ? [id] : [];
      }
      return [];
    });
  }

  private attachmentEntries(value: unknown): AttachmentEntry[] {
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const object = item as Record<string, unknown>;
      const fileToken = String(object.file_token || object.token || '');
      return fileToken ? [{ fileToken, name: String(object.name || object.file_name || fileToken), size: Number(object.size || 0) }] : [];
    });
  }

  private normalized(value: unknown): string {
    return (this.text(value) || '').trim().replace(/\s+/g, '').toLowerCase();
  }

  private paymentMethod(record: BaseRecord): string {
    return this.text(record.fields['付款形式']) || '';
  }

  private nestedText(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() || null;
    if (Array.isArray(value)) {
      const values = value.map((item) => this.nestedText(item)).filter((item): item is string => Boolean(item));
      return values.length ? values.join(',') : null;
    }
    if (!value || typeof value !== 'object') return null;
    const object = value as Record<string, unknown>;
    if (typeof object.text === 'string' && object.text.trim()) return object.text.trim();
    if ('value' in object) return this.nestedText(object.value);
    return null;
  }

  private approvalInstanceCode(value: unknown): string | null {
    const source = this.text(value);
    if (!source) return null;
    const candidates = [source];
    try {
      candidates.push(Buffer.from(source, 'base64').toString('utf8'));
    } catch {
      // SourceID is normally base64, but older connector rows may contain plain text.
    }
    const pattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const candidate of candidates) {
      const match = candidate.match(pattern);
      if (match) return match[0];
    }
    return null;
  }

  private bankArea(value: unknown): { province: string | null; city: string | null } {
    const raw = this.nestedText(value);
    if (!raw) return { province: null, city: null };
    try {
      const parsed = JSON.parse(raw) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let province: string | null = null;
      let city: string | null = null;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const object = item as Record<string, unknown>;
        const name = this.nestedText(object.name);
        const level = this.nestedText(object.level)?.toLowerCase() || '';
        if (level.includes('province')) province = name;
        if (level.includes('city')) city = name;
      }
      return { province, city };
    } catch {
      return { province: null, city: null };
    }
  }

  private resourceAccountFromFields(fields: Record<string, unknown>): ParsedResourceAccount | null {
    const sourceInstanceCode = this.text(fields['账户审批实例Code（插件解析）']);
    const status = this.text(fields['账户校验状态（插件解析）']);
    if (!sourceInstanceCode || status !== '已解析') return null;
    return {
      sourceInstanceCode,
      status,
      accountName: this.text(fields['收款户名（插件解析）']),
      accountNumber: this.text(fields['收款账号（插件解析）']),
      bankName: this.text(fields['开户银行（插件解析）']),
      bankBranch: this.text(fields['开户支行（插件解析）']),
      province: this.text(fields['开户省（插件解析）']),
      city: this.text(fields['开户市（插件解析）']),
      accountType: this.text(fields['账户类型（插件解析）']),
    };
  }

  private resourceAccountPatch(account: ParsedResourceAccount): Record<string, unknown> {
    return {
      '收款户名（插件解析）': account.accountName,
      '收款账号（插件解析）': account.accountNumber,
      '开户银行（插件解析）': account.bankName,
      '开户支行（插件解析）': account.bankBranch,
      '开户省（插件解析）': account.province,
      '开户市（插件解析）': account.city,
      '账户类型（插件解析）': account.accountType,
      '账户校验状态（插件解析）': account.status,
      '账户审批实例Code（插件解析）': account.sourceInstanceCode,
    };
  }

  private paymentAccountPatch(account: ParsedResourceAccount | null): Record<string, unknown> {
    return {
      '收款户名（自动带出）': account?.accountName || null,
      '收款账号（自动带出）': account?.accountNumber || null,
      '开户银行（自动带出）': account?.bankName || null,
      '开户支行（自动带出）': account?.bankBranch || null,
      '开户省（自动带出）': account?.province || null,
      '开户市（自动带出）': account?.city || null,
      '账户类型（自动带出）': account?.accountType || null,
      '账户校验状态（自动带出）': account?.status || '未解析',
    };
  }

  private async resolveResourceAccount(token: string, resourceRecord: BaseRecord): Promise<ParsedResourceAccount | null> {
    const sourceInstanceCode = this.approvalInstanceCode(resourceRecord.fields.SourceID);
    const cached = this.resourceAccountFromFields(resourceRecord.fields);
    if (cached && (!sourceInstanceCode || cached.sourceInstanceCode === sourceInstanceCode)) return cached;
    if (!sourceInstanceCode) return cached;
    try {
      const detail = await this.feishu.api<{ form?: string }>(
        `approval/v4/instances/detail?${new URLSearchParams({ instance_code: sourceInstanceCode, locale: 'zh-CN', user_id_type: 'open_id' })}`,
        token,
      );
      const rawForm = detail.form;
      const form = typeof rawForm === 'string' ? JSON.parse(rawForm) as unknown : rawForm;
      const accountWidget = Array.isArray(form)
        ? form.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'account') as Record<string, unknown> | undefined
        : undefined;
      const value = accountWidget?.value;
      if (!value || typeof value !== 'object') {
        return {
          sourceInstanceCode,
          status: '未找到收款账户',
          accountName: null,
          accountNumber: null,
          bankName: null,
          bankBranch: null,
          province: null,
          city: null,
          accountType: null,
        };
      }
      const account = value as Record<string, unknown>;
      const area = this.bankArea(account.widgetAccountBankArea);
      return {
        sourceInstanceCode,
        status: '已解析',
        accountName: this.nestedText(account.widgetAccountName),
        accountNumber: this.nestedText(account.widgetAccountNumber),
        bankName: this.nestedText(account.widgetAccountBankName),
        bankBranch: this.nestedText(account.widgetAccountBankBranch),
        province: area.province,
        city: area.city,
        accountType: this.nestedText(account.widgetAccountType),
      };
    } catch {
      return {
        sourceInstanceCode,
        status: '解析失败',
        accountName: null,
        accountNumber: null,
        bankName: null,
        bankBranch: null,
        province: null,
        city: null,
        accountType: null,
      };
    }
  }

  private resolveApprovalType(records: BaseRecord[]): ApprovalType {
    const methods = [...new Set(records.map((record) => this.paymentMethod(record)).filter(Boolean))];
    if (methods.length !== 1) return 'Unknown';
    if (methods[0] === '云账户支付') return 'Cloud';
    if (methods[0] === '小荷包支付') return 'Wallet';
    if (methods[0] === '对公支付') return 'Corporate';
    return 'Unknown';
  }

  private recordErrors(record: BaseRecord): string[] {
    const errors: string[] = [];
    const name = this.text(record.fields['付款明细名称']) || record.recordId;
    if (!this.hasOption(record.fields['付款进度'], ['待申请'])) errors.push(`${name}：付款进度不是待申请。`);
    if (!this.hasOption(record.fields['验收状态'], ['已验收'])) errors.push(`${name}：尚未验收。`);
    if (!this.hasOption(record.fields['合同/订单状态'], ['已签署', '无需合同'])) errors.push(`${name}：合同/订单状态不允许付款。`);
    if (!this.hasOption(record.fields['发票/凭证状态'], ['已审核', '无需发票'])) errors.push(`${name}：发票/凭证尚未审核。`);
    if (!this.attachmentEntries(record.fields['验收/凭证附件']).length) errors.push(`${name}：缺少验收/凭证附件。`);
    const cost = this.number(record.fields['实际成本']);
    if (cost == null || cost <= 0) errors.push(`${name}：实际成本必须大于 0。`);
    if (this.resolveApprovalType([record]) === 'Unknown') errors.push(`${name}：资源入库未带出有效付款形式。`);
    const linkageError = this.text(record.fields['校验错误']);
    if (linkageError) errors.push(...linkageError.split('\n').filter(Boolean));
    const selectedPayment = this.paymentMethod(record);
    const sourcePayment = this.text(record.fields['资源支付形式（自动带出）']);
    if (!['对公支付', '小荷包支付', '云账户支付'].includes(selectedPayment)) errors.push(`${name}：请选择付款形式。`);
    if (sourcePayment && selectedPayment && sourcePayment !== selectedPayment) {
      errors.push(`${name}：人工选择的付款形式与资源入库审批不一致（资源审批为${sourcePayment}）。`);
    }
    if (selectedPayment === '小荷包支付' && !this.attachmentEntries(record.fields['收款二维码']).length) {
      errors.push(`${name}：小荷包支付缺少收款二维码。`);
    }
    if (selectedPayment === '对公支付') {
      const accountStatus = this.text(record.fields['账户校验状态（自动带出）']);
      const province = this.text(record.fields['开户省（自动带出）']);
      const city = this.text(record.fields['开户市（自动带出）']);
      if (accountStatus !== '已解析') errors.push(`${name}：收款银行账户尚未从资源入库审批解析完成。`);
      if (!province || !city) errors.push(`${name}：收款银行账户缺少开户省/市，无法完成批量付款校验。`);
    }
    return errors;
  }

  private validate(records: BaseRecord[], approvalType: ApprovalType): string[] {
    if (!records.length) return ['未勾选任何付款明细。'];
    const errors: string[] = [];
    const approvalTypes = [...new Set(records.map((record) => this.resolveApprovalType([record])))];
    if (approvalTypes.length !== 1) errors.push('不同付款方式不能混合提审。');
    if (approvalType === 'Unknown') errors.push('付款形式为空、未识别或同一批次包含多种付款形式。');
    if (approvalType === 'Corporate') {
      const payeeKeys = [...new Set(records.map((record) => [
        this.normalized(record.fields['收款户名（自动带出）'] || record.fields['收款账户（自动带出）']),
        this.normalized(record.fields['收款账号（自动带出）'] || record.fields['银行卡号（自动带出）']),
        this.normalized(record.fields['开户省（自动带出）']),
        this.normalized(record.fields['开户市（自动带出）']),
      ].join('|')))];
      if (payeeKeys.length !== 1) errors.push('普通付款必须按同一收款账户分批。');
    }
    if (approvalType === 'Wallet') {
      const resourceIds = [...new Set(records.flatMap(({ fields }) => this.linkIds(fields['关联资源'])))];
      if (resourceIds.length !== 1) errors.push('小荷包付款一个二维码只能对应一个批次。');
    }
    errors.push(...records.flatMap((record) => this.recordErrors(record)));
    return [...new Set(errors)];
  }

  private async listTableRecords(token: string, tableId: string, filter?: Record<string, unknown>): Promise<BaseRecord[]> {
    const records: BaseRecord[] = [];
    let offset = 0;
    while (true) {
      const query = new URLSearchParams({ limit: '200', offset: String(offset) });
      if (filter) query.set('filter', JSON.stringify(filter));
      const payload = await this.feishu.api<BaseListResponse>(
        `base/v3/bases/${this.config.baseToken}/tables/${tableId}/records?${query}`,
        token,
      );
      records.push(...payload.record_id_list.map((recordId, row) => ({
        recordId,
        fields: Object.fromEntries(payload.fields.map((field, column) => [field, payload.data[row]?.[column]])),
      })));
      if (!payload.has_more || payload.record_id_list.length === 0) break;
      offset += payload.record_id_list.length;
    }
    return records;
  }

  private listRecords(token: string, filter: Record<string, unknown>): Promise<BaseRecord[]> {
    return this.listTableRecords(token, this.config.paymentTableId, filter);
  }

  private approved(records: BaseRecord[]): BaseRecord[] {
    return records.filter((record) => this.hasOption(record.fields['申请状态'], ['已通过']));
  }

  private async resolveLinkages(token: string, records: BaseRecord[]): Promise<BaseRecord[]> {
    if (!records.length) return records;
    const [projects, resources, closures] = await Promise.all([
      this.listTableRecords(token, this.config.projectSyncTableId),
      this.listTableRecords(token, this.config.resourceSyncTableId),
      this.listTableRecords(token, this.config.closureSyncTableId),
    ]);
    const approvedClosures = this.approved(closures);
    const nowText = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
    const enriched: BaseRecord[] = [];
    const accountCache = new Map<string, ParsedResourceAccount | null>();

    for (const record of records) {
      const errors: string[] = [];
      const projectIds = this.linkIds(record.fields['关联项目']);
      const resourceIds = this.linkIds(record.fields['关联资源']);
      const projectRecord = projectIds.length === 1 ? projects.find((item) => item.recordId === projectIds[0]) : undefined;
      const resourceRecord = resourceIds.length === 1 ? resources.find((item) => item.recordId === resourceIds[0]) : undefined;
      let resourceAccount: ParsedResourceAccount | null = null;
      if (resourceRecord) {
        resourceAccount = accountCache.get(resourceRecord.recordId) || null;
        if (!accountCache.has(resourceRecord.recordId)) {
          resourceAccount = await this.resolveResourceAccount(token, resourceRecord);
          accountCache.set(resourceRecord.recordId, resourceAccount);
        }
        if (resourceAccount) {
          await this.updateTableRecords(token, this.config.resourceSyncTableId, [resourceRecord.recordId], this.resourceAccountPatch(resourceAccount)).catch(() => undefined);
        }
      }

      if (projectIds.length !== 1) errors.push('请先关联一条立项审批。');
      else if (!projectRecord) errors.push('关联项目不在立项同步表中。');
      else if (!this.approved([projectRecord]).length) errors.push('关联项目审批尚未通过。');

      if (resourceIds.length !== 1) errors.push('请先关联一条资源入库审批。');
      else if (!resourceRecord) errors.push('关联资源不在资源入库同步表中。');
      else if (!this.approved([resourceRecord]).length) errors.push('关联资源审批尚未通过。');

      const projectCode = this.normalized(projectRecord?.fields['项目编号']);
      const projectName = this.normalized(projectRecord?.fields['项目名称']);
      const resourceAlias = this.normalized(resourceRecord?.fields['资源代称']);
      const expectedResourcePayment = this.text(resourceRecord?.fields['资源支付形式']) || '';
      const projectInitiatorId = this.userIds(projectRecord?.fields['发起人'])[0] || null;
      const effectiveFields = {
        ...record.fields,
        '项目编号（自动带出）': projectRecord?.fields['项目编号'] ?? record.fields['项目编号（自动带出）'],
        '项目名称': projectRecord?.fields['项目名称'] ?? record.fields['项目名称'],
        '资源账号（自动带出）': resourceRecord?.fields['资源代称'] ?? record.fields['资源账号（自动带出）'],
        '收款人（自动带出）': resourceRecord?.fields['真实姓名'] ?? record.fields['收款人（自动带出）'],
        '资源支付形式（自动带出）': resourceRecord?.fields['资源支付形式'] ?? record.fields['资源支付形式（自动带出）'],
        '收款账户（自动带出）': resourceRecord?.fields['收款账户'],
        '银行卡号（自动带出）': resourceRecord?.fields['银行卡号'],
        '付款联系人OpenId（自动带出）': projectInitiatorId,
        ...this.paymentAccountPatch(resourceAccount),
      };

      const closureMatches = approvedClosures.filter((closure) => projectCode
        ? this.normalized(closure.fields['项目编号']) === projectCode
        : projectName && this.normalized(closure.fields['项目名称']) === projectName);
      if (closureMatches.length) errors.push('项目已有已通过的结项审批，新增付款需人工确认。');

      const closureRecord = closureMatches.length === 1 ? closureMatches[0] : undefined;
      const sourceTimes = [projectRecord, resourceRecord, closureRecord]
        .map((item) => this.text(item?.fields['完成时间']))
        .filter((item): item is string => Boolean(item))
        .sort();
      const patch: Record<string, unknown> = {
        '校验状态': errors.length ? (errors.some((error) => error.includes('人工确认')) ? '需人工确认' : '阻断') : '通过',
        '校验错误': errors.join('\n') || null,
        '最后校验时间': nowText,
        '审批源最后更新时间': sourceTimes.at(-1) || nowText,
        ...this.paymentAccountPatch(resourceAccount),
      };
      if (closureRecord) patch['关联项目结项'] = [{ id: closureRecord.recordId }];
      try {
        await this.updateRecords(token, [record.recordId], patch);
      } catch (error) {
        errors.push(`关联回写失败：${error instanceof Error ? error.message : String(error)}`);
        patch['校验状态'] = '阻断';
        patch['校验错误'] = errors.join('\n');
      }
      enriched.push({ recordId: record.recordId, fields: { ...effectiveFields, ...patch } });
    }
    return enriched;
  }

  private selectedFilter() {
    return { logic: 'and', conditions: [['申请付款选择框', '==', true]] };
  }

  async preview(req: Request, res: Response, tableId?: string): Promise<BatchPreview> {
    if (tableId && tableId !== this.config.paymentTableId) {
      throw new HttpException('请切换到【付款执行明细】后再使用插件', HttpStatus.BAD_REQUEST);
    }
    const token = await this.feishu.userToken(req, res) as string;
    const records = await this.resolveLinkages(token, await this.listRecords(token, this.selectedFilter()));
    const approvalType = this.resolveApprovalType(records);
    const errors = this.validate(records, approvalType);
    const items = records.map((record) => ({
      RecordId: record.recordId,
      Name: this.text(record.fields['付款明细名称']) || record.recordId,
      ProjectName: this.text(record.fields['项目名称']),
      ProjectCode: this.text(record.fields['项目编号（自动带出）']),
      ResourceAccount: this.text(record.fields['资源账号（自动带出）']),
      Recipient: this.text(record.fields['收款人（自动带出）']),
      PaymentMethod: this.text(record.fields['付款形式']),
      Cost: this.number(record.fields['实际成本']),
      AcceptanceStatus: this.text(record.fields['验收状态']),
      ContractStatus: this.text(record.fields['合同/订单状态']),
      InvoiceStatus: this.text(record.fields['发票/凭证状态']),
      AttachmentCount: this.attachmentEntries(record.fields['验收/凭证附件']).length,
      ProjectLinked: this.linkIds(record.fields['关联项目']).length === 1,
      ResourceLinked: this.linkIds(record.fields['关联资源']).length === 1,
      Errors: this.recordErrors(record),
    }));
    return {
      Action: 'Preview',
      ApprovalType: approvalType,
      ExecutionMode: 'Approval',
      DefinitionName: approvalType === 'Cloud'
        ? '✳️【其他】供应商云账户付款【多收款人】'
        : approvalType === 'Wallet'
          ? '【测试】小荷包'
          : approvalType === 'Corporate'
            ? '【测试】付款'
            : '待识别付款审批',
      AutoSubmitEnabled: approvalType === 'Cloud'
        ? Object.values(this.config.cloudWidgets).every(Boolean)
        : approvalType === 'Corporate'
          ? this.config.corporateAutoSubmitEnabled
          : Object.values(this.config.walletWidgets).every(Boolean),
      RecordCount: records.length,
      TotalAmount: items.reduce((sum, item) => sum + (item.Cost || 0), 0),
      CanSubmit: records.length > 0 && errors.length === 0,
      Errors: errors,
      Records: items,
    };
  }

  private batchId(): string {
    const now = new Date();
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now).replace(/[-: ]/g, '');
    return `PAY-${stamp.slice(0, 8)}-${stamp.slice(8)}-${randomBytes(2).toString('hex').toUpperCase()}`;
  }

  private csv(records: BaseRecord[], batchId: string): Buffer {
    const columns = [
      '付款批次号', '付款记录ID', '付款明细名称', '项目编号', '项目名称', '资源账号', '收款人',
      '收款账户', '银行卡号', '收款户名', '收款账号', '开户银行', '开户支行', '开户省', '开户市', '账户类型',
      '对应合同', '平台类型', '账号', '话题内容', '链接', '实际成本', '税点', '付款方式',
    ];
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = records.map((record) => [
      batchId, record.recordId, this.text(record.fields['付款明细名称']), this.text(record.fields['项目编号（自动带出）']),
      this.text(record.fields['项目名称']), this.text(record.fields['资源账号（自动带出）']), this.text(record.fields['收款人（自动带出）']),
      this.text(record.fields['收款账户（自动带出）']), this.text(record.fields['银行卡号（自动带出）']), this.text(record.fields['对应合同（自动带出）']),
      this.text(record.fields['收款户名（自动带出）']), this.text(record.fields['收款账号（自动带出）']),
      this.text(record.fields['开户银行（自动带出）']), this.text(record.fields['开户支行（自动带出）']),
      this.text(record.fields['开户省（自动带出）']), this.text(record.fields['开户市（自动带出）']),
      this.text(record.fields['账户类型（自动带出）']),
      this.text(record.fields['平台/合作需求类型']), this.text(record.fields['账号']), this.text(record.fields['话题/内容']), this.text(record.fields['链接']),
      this.number(record.fields['实际成本']), this.text(record.fields['税点']), this.text(record.fields['付款形式']),
    ]);
    return Buffer.from(`\uFEFF${[columns, ...rows].map((row) => row.map(quote).join(',')).join('\r\n')}`, 'utf8');
  }

  private async resolvedAttachments(token: string, records: BaseRecord[], fieldName = '验收/凭证附件'): Promise<AttachmentEntry[]> {
    const payload = await this.feishu.api<{ attachments: Record<string, Record<string, AttachmentEntry[] & { extra_info?: string }>> }>(
      `base/v3/bases/${this.config.baseToken}/tables/${this.config.paymentTableId}/get_attachments`,
      token,
      { method: 'POST', body: JSON.stringify({ record_id_list: records.map((record) => record.recordId) }) },
    );
    const expected = new Set(records.flatMap((record) => this.attachmentEntries(record.fields[fieldName]).map((item) => item.fileToken)));
    const result: AttachmentEntry[] = [];
    for (const fields of Object.values(payload.attachments || {})) {
      for (const items of Object.values(fields || {})) {
        for (const item of items as unknown as Array<Record<string, unknown>>) {
          const fileToken = String(item.file_token || item.fileToken || '');
          if (expected.has(fileToken) && !result.some((existing) => existing.fileToken === fileToken)) {
            result.push({ fileToken, name: String(item.name || fileToken), size: Number(item.size || 0), extraInfo: String(item.extra_info || '') });
          }
        }
      }
    }
    if (result.length !== expected.size) throw new Error(`部分${fieldName}无法解析，请刷新记录后重试`);
    return result;
  }

  private async uploadApprovalFile(buffer: Buffer, name: string, contentType = 'application/octet-stream', uploadType = 'attachment'): Promise<string> {
    const tenantToken = await this.feishu.tenantAccessToken();
    const boundary = `----PaymentConsole${randomBytes(12).toString('hex')}`;
    const safeName = name.replace(/["]/g, '_');
    // 飞书审批旧版上传接口要求 name/type/content 为三个独立的 multipart 字段，
    // 不能把 name 和 type 包进 data JSON，否则接口会返回 invalid type。
    const namePart = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`, 'utf8');
    const typePart = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${uploadType}\r\n`, 'utf8');
    const contentHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="content"; filename="${safeName}"\r\nContent-Type: ${contentType}\r\n\r\n`, 'utf8');
    const ending = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const filePart = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const body = Buffer.concat([namePart, typePart, contentHeader, filePart, ending]);
    const response = await fetch('https://open.feishu.cn/approval/openapi/v2/file/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const payload = await response.json() as { code?: number; msg?: string; data?: { code?: string } };
    const fileCode = payload.data?.code;
    if (!response.ok || payload.code || !fileCode) throw new Error(payload.msg || `审批附件上传失败：${name}`);
    return fileCode;
  }

  private async approvalSerialNumber(token: string, instanceCode: string): Promise<string | null> {
    const delays = [0, 400, 800, 1600];
    for (const delay of delays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const detail = await this.feishu.api<{ serial_number?: string }>(
          `approval/v4/instances/detail?${new URLSearchParams({ instance_code: instanceCode, locale: 'zh-CN' })}`,
          token,
        );
        if (detail.serial_number) return detail.serial_number;
      } catch {
        // 流水编号回填是补充信息，不能反向导致已经创建成功的审批被标记为失败。
      }
    }
    return null;
  }

  private async updateTableRecords(token: string, tableId: string, recordIds: string[], patch: Record<string, unknown>): Promise<void> {
    const datetimeFields = new Set([
      '期望付款日期',
      '审批附件上传时间',
      '批次提交时间',
      '审批回填时间',
      '审批完成时间',
      '最后校验时间',
      '审批源最后更新时间',
    ]);
    const fields = Object.fromEntries(Object.entries(patch).map(([field, value]) => {
      if (field === '付款审批链接' && typeof value === 'string') {
        return [field, { link: value, text: '打开付款审批' }];
      }
      if (datetimeFields.has(field) && typeof value === 'string') {
        const timestamp = Date.parse(`${value.replace(' ', 'T')}+08:00`);
        if (!Number.isNaN(timestamp)) return [field, timestamp];
      }
      return [field, value];
    }));
    // The Base v3 batch-update method is restricted for this app. Update records
    // one at a time through the generally available Bitable v1 endpoint instead.
    // Keep the writes sequential because a table rejects concurrent mutations.
    for (const recordId of recordIds) {
      await this.feishu.api(
        `bitable/v1/apps/${this.config.baseToken}/tables/${tableId}/records/${recordId}`,
        token,
        { method: 'PUT', body: JSON.stringify({ fields }) },
      );
    }
  }

  private updateRecords(token: string, recordIds: string[], patch: Record<string, unknown>): Promise<void> {
    return this.updateTableRecords(token, this.config.paymentTableId, recordIds, patch);
  }

  private async discoverSyncedInstance(token: string, batchId: string, definitionName: string) {
    const isCloud = definitionName.includes('云账户');
    const isWallet = definitionName.includes('小荷包');
    const tableId = isCloud
      ? this.config.cloudSyncTableId
      : isWallet
        ? this.config.walletSyncTableId
        : this.config.paymentSyncTableId;
    const records = await this.listTableRecords(token, tableId);
    const candidates = records.filter((record) => {
      const reason = this.text(record.fields['付款事由']) || '';
      const detail = JSON.stringify(record.fields['项目明细表'] || '');
      return reason.includes(batchId) || detail.includes(batchId);
    });
    if (candidates.length !== 1) return null;
    const candidate = candidates[0];
    return {
      instanceCode: this.text(candidate.fields.SourceID),
      approvalLink: this.text(candidate.fields['申请编号']),
      approvalStatus: this.text(candidate.fields['申请状态']),
      linkField: isCloud ? '匹配云账户审批' : isWallet ? '匹配小荷包审批' : '匹配付款审批',
      recordId: candidate.recordId,
    };
  }

  async submit(req: Request, res: Response, input: { reason?: string; paymentEntity?: string; expectedPaymentDate?: string; confirmed?: boolean; allowValidationErrors?: boolean }) {
    if (input.confirmed !== true) throw new HttpException('提交前需要明确确认', HttpStatus.BAD_REQUEST);
    if (!input.reason?.trim()) throw new HttpException('付款事由不能为空', HttpStatus.BAD_REQUEST);
    if (!input.paymentEntity?.trim()) throw new HttpException('付款主体不能为空', HttpStatus.BAD_REQUEST);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedPaymentDate || '')) throw new HttpException('期望付款日期格式不正确', HttpStatus.BAD_REQUEST);
    const token = await this.feishu.userToken(req, res) as string;
    const records = await this.resolveLinkages(token, await this.listRecords(token, this.selectedFilter()));
    const approvalType = this.resolveApprovalType(records);
    const errors = this.validate(records, approvalType);
    if (errors.length && input.allowValidationErrors !== true) throw new HttpException(errors.join('\n'), HttpStatus.BAD_REQUEST);

    const batchId = this.batchId();
    const recordIds = records.map((record) => record.recordId);
    const totalAmount = records.reduce((sum, record) => sum + (this.number(record.fields['实际成本']) || 0), 0);
    const reason = `${input.reason.trim()} [${batchId}]`;
    if (approvalType === 'Unknown') throw new HttpException('付款形式无法从关联资源自动带出，请先关联资源入库审批。', HttpStatus.BAD_REQUEST);
    const definitionName = approvalType === 'Cloud'
      ? '✳️【其他】供应商云账户付款【多收款人】'
      : approvalType === 'Wallet'
        ? '【测试】小荷包'
        : '【测试】付款';
    const approvalLink = approvalType === 'Cloud'
      ? this.config.cloudApprovalLink
      : approvalType === 'Wallet'
        ? this.config.walletApprovalLink
      : this.config.corporateApprovalLink;
    try {
      const nowText = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());

      const attachments = await this.resolvedAttachments(token, records);
      const detailCode = await this.uploadApprovalFile(this.csv(records, batchId), `${batchId}-payment-details.csv`, 'text/csv');
      const evidenceCodes: string[] = [];
      for (const attachment of attachments) {
        const query = new URLSearchParams();
        if (attachment.extraInfo) query.set('extra', attachment.extraInfo);
        const downloaded = await this.feishu.download(`drive/v1/medias/${attachment.fileToken}/download?${query}`, token);
        evidenceCodes.push(await this.uploadApprovalFile(downloaded.buffer, attachment.name, downloaded.contentType));
      }
      const qrCodes: string[] = [];
      if (approvalType === 'Wallet') {
        const qrAttachments = await this.resolvedAttachments(token, records, '收款二维码');
        for (const attachment of qrAttachments) {
          const downloaded = await this.feishu.download(`drive/v1/medias/${attachment.fileToken}/download`, token);
          qrCodes.push(await this.uploadApprovalFile(downloaded.buffer, attachment.name, downloaded.contentType, 'image'));
        }
      }
      await this.updateRecords(token, recordIds, {
        '付款批次号': batchId,
        '批量提交状态': '待提单',
        '审批定义': definitionName,
        '付款事由': reason,
        '付款主体': input.paymentEntity.trim(),
        '期望付款日期': `${input.expectedPaymentDate} 00:00:00`,
        '付款审批链接': approvalLink,
        '审批附件Codes': JSON.stringify({ detail: detailCode, evidence: evidenceCodes, qr: qrCodes }),
        '审批附件上传时间': nowText,
        '提交失败原因': null,
        '申请付款选择框': false,
      });

      const autoSubmitEnabled = approvalType === 'Cloud'
        ? Object.values(this.config.cloudWidgets).every(Boolean)
        : approvalType === 'Corporate'
          ? this.config.corporateAutoSubmitEnabled
          : Object.values(this.config.walletWidgets).every(Boolean);
      if (!autoSubmitEnabled) {
        const blocker = approvalType === 'Cloud'
          ? '云账户审批控件配置不完整，已准备付款明细及附件，请检查云账户审批定义后重试。'
          : approvalType === 'Corporate'
          ? `普通付款流程仍含 API 无法自动填写的必填控件（收款银行账户${this.config.corporateAccountControlRequired ? '、关联合同' : ''}）。已自动准备付款明细和附件；请将这些控件改为非必填或移除，并把 PROJECT_ACCOUNT_CONTROL_REQUIRED / PROJECT_CONTRACT_CONTROL_REQUIRED 设为 false 后，插件会直接提审。`
          : '小荷包审批控件配置不完整，已准备付款明细及附件，请检查审批定义后重试。';
        await this.updateRecords(token, recordIds, {
          '付款进度': '待申请',
          '批量提交状态': '待提单',
          '提交失败原因': null,
        });
        return {
          Action: 'Submit', BatchId: batchId, ApprovalType: approvalType, Submitted: false, ApprovalLink: approvalLink,
          Blocker: blocker,
        };
      }

      let form: Array<Record<string, unknown>>;
      if (approvalType === 'Cloud') {
        const widgets = this.config.cloudWidgets;
        form = [
          { id: widgets.reason, type: 'textarea', value: reason },
          { id: widgets.detail, type: 'attachmentV2', value: [detailCode] },
          { id: widgets.settlement, type: 'attachmentV2', value: evidenceCodes },
          { id: widgets.amount, type: 'amount', value: totalAmount, currency: 'CNY' },
          { id: widgets.date, type: 'date', value: `${input.expectedPaymentDate}T00:00:00+08:00` },
        ];
      } else if (approvalType === 'Wallet') {
        const widgets = this.config.walletWidgets;
        form = [
          { id: widgets.department, type: 'department', value: [{ open_id: this.config.walletDepartmentOpenId }] },
          { id: widgets.detail, type: 'attachmentV2', value: [detailCode] },
          { id: widgets.amount, type: 'amount', value: totalAmount, currency: 'CNY' },
          { id: widgets.qr, type: 'image', value: qrCodes },
        ];
      } else {
        const widgets = this.config.corporateWidgets;
        const contactId = this.userIds(records[0]?.fields['付款联系人OpenId（自动带出）'])[0];
        if (!contactId) {
          throw new Error('普通付款审批的“联系人”控件无法自动带出项目发起人，请先检查立项同步表的发起人字段。');
        }
        form = [
          { id: widgets.department, type: 'department', value: [{ open_id: this.config.walletDepartmentOpenId }] },
          { id: widgets.contact, type: 'contact', value: [contactId] },
          { id: widgets.reason, type: 'textarea', value: reason },
          { id: widgets.detail, type: 'attachmentV2', value: [detailCode] },
          { id: widgets.amount, type: 'amount', value: totalAmount, currency: 'CNY' },
          { id: widgets.method, type: 'radioV2', value: this.config.corporatePaymentMethodValue },
          { id: widgets.date, type: 'date', value: `${input.expectedPaymentDate}T00:00:00+08:00` },
        ];
        if (widgets.evidence && evidenceCodes.length) {
          form.splice(2, 0, { id: widgets.evidence, type: 'attachmentV2', value: evidenceCodes });
        }
      }
      const approvalCode = approvalType === 'Cloud'
        ? this.config.cloudApprovalCode
        : approvalType === 'Wallet'
          ? this.config.walletApprovalCode
          : this.config.corporateApprovalCode;
      const created = await this.feishu.api<{ instance_code: string; instance_link?: string }>(
        'approval/v4/instances/initiate?user_id_type=open_id', token,
        { method: 'POST', body: JSON.stringify({ approval_code: approvalCode, form: JSON.stringify(form), uuid: batchId }) },
      );
      const finalLink = created.instance_link || approvalLink;
      const serialNumber = await this.approvalSerialNumber(token, created.instance_code);
      await this.updateRecords(token, recordIds, {
        '审批实例Code': created.instance_code,
        '付款流程编号': serialNumber,
        '付款审批链接': finalLink,
        '付款进度': '审批中',
        '审批状态': 'PENDING',
        '批量提交状态': '已提交',
        '批次提交时间': nowText,
        '提交失败原因': null,
      });
      return {
        Action: 'Submit', BatchId: batchId, ApprovalType: approvalType, ExecutionMode: 'Approval', Submitted: true,
        InstanceCode: created.instance_code, InstanceLink: finalLink, SerialNumber: serialNumber, RecordCount: records.length,
        BaseAmount: totalAmount,
      };
    } catch (error) {
      await this.updateRecords(token, recordIds, {
        '付款批次号': batchId,
        '批量提交状态': '校验失败',
        '提交失败原因': `提审失败：${error instanceof Error ? error.message : String(error)}`,
        '申请付款选择框': true,
      }).catch(() => undefined);
      const detail = error instanceof Error ? error.message : String(error);
      throw new HttpException(`提审失败：${detail}`, HttpStatus.BAD_GATEWAY);
    }
  }

  async sync(req: Request, res: Response, confirmed: boolean) {
    if (confirmed !== true) throw new HttpException('同步前需要明确确认', HttpStatus.BAD_REQUEST);
    const token = await this.feishu.userToken(req, res) as string;
    const records = await this.listRecords(token, {
      logic: 'and', conditions: [['付款批次号', 'non_empty'], ['批量提交状态', 'intersects', ['待提单', '已提交', '已回填']]],
    });
    const groups = new Map<string, BaseRecord[]>();
    for (const record of records) {
      const batchId = this.text(record.fields['付款批次号']);
      if (batchId) groups.set(batchId, [...(groups.get(batchId) || []), record]);
    }
    const results: unknown[] = [];
    for (const [batchId, group] of groups) {
      const definitionName = this.text(group[0]?.fields['审批定义']) || '';
      let instanceCode = [...new Set(group.map((record) => this.text(record.fields['审批实例Code'])).filter(Boolean))][0];
      if (!instanceCode) {
        const discovered = await this.discoverSyncedInstance(token, batchId, definitionName);
        if (discovered?.instanceCode) {
          instanceCode = discovered.instanceCode;
          await this.updateRecords(token, group.map((record) => record.recordId), {
            '审批实例Code': instanceCode,
            '付款审批链接': discovered.approvalLink || null,
            '审批状态': discovered.approvalStatus || null,
            [discovered.linkField]: [{ id: discovered.recordId }],
          });
        } else {
          results.push({ BatchId: batchId, Result: '同步表中尚未找到对应审批实例', Records: group.length });
          continue;
        }
      }
      const detail = await this.feishu.api<{ status: string; serial_number?: string }>(
        `approval/v4/instances/detail?${new URLSearchParams({ instance_code: instanceCode, locale: 'zh-CN' })}`, token,
      );
      const paymentStatus = detail.status === 'APPROVED' ? '待付款' : ['REJECTED', 'CANCELED', 'DELETED'].includes(detail.status) ? '已驳回' : '审批中';
      const nowText = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
      await this.updateRecords(token, group.map((record) => record.recordId), {
        '付款流程编号': detail.serial_number || null,
        '付款进度': paymentStatus,
        '审批状态': detail.status,
        '批量提交状态': '已回填',
        '审批回填时间': nowText,
        '审批完成时间': ['APPROVED', 'REJECTED', 'CANCELED', 'DELETED'].includes(detail.status) ? nowText : null,
        '申请付款选择框': false,
        '提交失败原因': null,
      });
      results.push({ BatchId: batchId, Result: '已回填', InstanceCode: instanceCode, SerialNumber: detail.serial_number, ApprovalStatus: detail.status, PaymentStatus: paymentStatus, Records: group.length });
    }
    return results;
  }
}

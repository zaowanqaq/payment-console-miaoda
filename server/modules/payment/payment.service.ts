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
    return this.text(record.fields['默认收款方式（自动带出）']) || '';
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
        this.normalized(record.fields['收款账户（自动带出）']),
        this.normalized(record.fields['银行卡号（自动带出）']),
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
    const query = new URLSearchParams({ limit: '500', offset: '0' });
    if (filter) query.set('filter', JSON.stringify(filter));
    const payload = await this.feishu.api<BaseListResponse>(
      `base/v3/bases/${this.config.baseToken}/tables/${tableId}/records?${query}`,
      token,
    );
    return payload.record_id_list.map((recordId, row) => ({
      recordId,
      fields: Object.fromEntries(payload.fields.map((field, column) => [field, payload.data[row]?.[column]])),
    }));
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

    for (const record of records) {
      const errors: string[] = [];
      const projectIds = this.linkIds(record.fields['关联项目']);
      const resourceIds = this.linkIds(record.fields['关联资源']);
      const projectRecord = projectIds.length === 1 ? projects.find((item) => item.recordId === projectIds[0]) : undefined;
      const resourceRecord = resourceIds.length === 1 ? resources.find((item) => item.recordId === resourceIds[0]) : undefined;

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
      const effectiveFields = {
        ...record.fields,
        '项目编号（自动带出）': projectRecord?.fields['项目编号'] ?? record.fields['项目编号（自动带出）'],
        '项目名称': projectRecord?.fields['项目名称'] ?? record.fields['项目名称'],
        '资源账号（自动带出）': resourceRecord?.fields['资源代称'] ?? record.fields['资源账号（自动带出）'],
        '收款人（自动带出）': resourceRecord?.fields['真实姓名'] ?? record.fields['收款人（自动带出）'],
        '默认收款方式（自动带出）': resourceRecord?.fields['资源支付形式'] ?? record.fields['默认收款方式（自动带出）'],
        '收款账户（自动带出）': resourceRecord?.fields['收款账户'],
        '银行卡号（自动带出）': resourceRecord?.fields['银行卡号'],
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
        '项目关联键': projectCode || projectName,
        '资源关联键': `${projectCode || projectName}|${resourceAlias}|${expectedResourcePayment}`,
        '校验状态': errors.length ? (errors.some((error) => error.includes('人工确认')) ? '需人工确认' : '阻断') : '通过',
        '校验错误': errors.join('\n') || null,
        '最后校验时间': nowText,
        '审批源最后更新时间': sourceTimes.at(-1) || nowText,
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
      PaymentMethod: this.text(record.fields['默认收款方式（自动带出）']),
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
      DefinitionName: approvalType === 'Cloud'
        ? '【测试】云账户批量付款资源（仅达人）'
        : approvalType === 'Wallet'
          ? '【测试】小荷包'
          : approvalType === 'Corporate'
            ? '【测试】付款'
            : '待识别付款审批',
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
    const columns = ['付款批次号', '付款记录ID', '付款明细名称', '项目编号', '项目名称', '资源账号', '收款人', '平台类型', '账号', '话题内容', '链接', '实际成本', '税点', '付款方式'];
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = records.map((record) => [
      batchId, record.recordId, this.text(record.fields['付款明细名称']), this.text(record.fields['项目编号（自动带出）']),
      this.text(record.fields['项目名称']), this.text(record.fields['资源账号（自动带出）']), this.text(record.fields['收款人（自动带出）']),
      this.text(record.fields['平台/合作需求类型']), this.text(record.fields['账号']), this.text(record.fields['话题/内容']), this.text(record.fields['链接']),
      this.number(record.fields['实际成本']), this.text(record.fields['资源税点（自动带出）']), this.text(record.fields['默认收款方式（自动带出）']),
    ]);
    return Buffer.from(`\uFEFF${[columns, ...rows].map((row) => row.map(quote).join(',')).join('\r\n')}`, 'utf8');
  }

  private async resolvedAttachments(token: string, records: BaseRecord[]): Promise<AttachmentEntry[]> {
    const payload = await this.feishu.api<{ attachments: Record<string, Record<string, AttachmentEntry[] & { extra_info?: string }>> }>(
      `base/v3/bases/${this.config.baseToken}/tables/${this.config.paymentTableId}/get_attachments`,
      token,
      { method: 'POST', body: JSON.stringify({ record_id_list: records.map((record) => record.recordId) }) },
    );
    const expected = new Set(records.flatMap((record) => this.attachmentEntries(record.fields['验收/凭证附件']).map((item) => item.fileToken)));
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
    if (result.length !== expected.size) throw new Error('部分验收附件无法解析，请刷新记录后重试');
    return result;
  }

  private async uploadApprovalFile(buffer: Buffer, name: string, contentType = 'application/octet-stream'): Promise<string> {
    const tenantToken = await this.feishu.tenantAccessToken();
    const boundary = `----PaymentConsole${randomBytes(12).toString('hex')}`;
    const safeName = name.replace(/["]/g, '_');
    // 飞书审批旧版上传接口要求 name/type/content 为三个独立的 multipart 字段，
    // 不能把 name 和 type 包进 data JSON，否则接口会返回 invalid type。
    const namePart = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`, 'utf8');
    const typePart = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nattachment\r\n`, 'utf8');
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

  private async updateRecords(token: string, recordIds: string[], patch: Record<string, unknown>): Promise<void> {
    await this.feishu.api(
      `base/v3/bases/${this.config.baseToken}/tables/${this.config.paymentTableId}/records/batch_update`,
      token,
      { method: 'POST', body: JSON.stringify({ record_id_list: recordIds, patch }) },
    );
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
      ? '【测试】云账户批量付款资源（仅达人）'
      : approvalType === 'Wallet'
        ? '【测试】小荷包'
        : '【测试】付款';
    const approvalLink = approvalType === 'Cloud'
      ? this.config.cloudApprovalLink
      : approvalType === 'Wallet'
        ? this.config.walletApprovalLink
      : this.config.corporateApprovalLink;
    try {
      const attachments = await this.resolvedAttachments(token, records);
      const detailCode = await this.uploadApprovalFile(this.csv(records, batchId), `${batchId}-payment-details.csv`, 'text/csv');
      const evidenceCodes: string[] = [];
      for (const attachment of attachments) {
        const query = new URLSearchParams();
        if (attachment.extraInfo) query.set('extra', attachment.extraInfo);
        const downloaded = await this.feishu.download(`drive/v1/medias/${attachment.fileToken}/download?${query}`, token);
        evidenceCodes.push(await this.uploadApprovalFile(downloaded.buffer, attachment.name, downloaded.contentType));
      }
      const nowText = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
      await this.updateRecords(token, recordIds, {
        '付款批次号': batchId,
        '批量提交状态': '待提单',
        '审批定义': definitionName,
        '付款事由': reason,
        '付款主体': input.paymentEntity.trim(),
        '期望付款日期': `${input.expectedPaymentDate} 00:00:00`,
        '付款审批链接': approvalLink,
        '付款批次键': [
          approvalType,
          input.paymentEntity.trim(),
          this.text(records[0]?.fields['资源账号（自动带出）']) || this.text(records[0]?.fields['收款人（自动带出）']),
          input.expectedPaymentDate,
        ].join('|'),
        '审批附件Codes': JSON.stringify({ detail: detailCode, evidence: evidenceCodes }),
        '审批附件上传时间': nowText,
        '提交失败原因': null,
        '申请付款选择框': false,
      });

      if (approvalType !== 'Cloud' || !this.config.cloudAutoSubmitEnabled) {
        const blocker = approvalType === 'Corporate'
          ? `普通付款包含飞书 API 暂不支持的收款银行账户控件。附件已自动上传，请打开审批补选账户，并在付款事由中保留 [${batchId}] 后提交。`
          : approvalType === 'Wallet'
            ? '小荷包审批需要选择审批人并确认收款二维码。附件已准备，请打开原生审批完成提交。'
            : `云账户审批当前未暴露可用控件 ID。为避免写入错误审批，已准备材料，请在付款事由中保留 [${batchId}] 并通过原生审批提交。`;
        await this.updateRecords(token, recordIds, {
          '付款进度': approvalType === 'Corporate' ? '待补充账户' : '待申请',
          '批量提交状态': '待提单',
          '提交失败原因': null,
        });
        return {
          Action: 'Submit', BatchId: batchId, ApprovalType: approvalType, Submitted: false, ApprovalLink: approvalLink,
          Blocker: blocker,
        };
      }

      const amountWithServiceFee = Math.round(totalAmount * 1.062 * 100) / 100;
      const form = [
        { id: this.config.cloudWidgets.reason, type: 'textarea', value: reason },
        { id: this.config.cloudWidgets.detail, type: 'attachmentV2', value: [detailCode] },
        { id: this.config.cloudWidgets.evidence, type: 'attachmentV2', value: evidenceCodes },
        { id: this.config.cloudWidgets.amount, type: 'amount', value: amountWithServiceFee, currency: 'CNY' },
        { id: this.config.cloudWidgets.date, type: 'date', value: `${input.expectedPaymentDate}T00:00:00+08:00` },
      ];
      const created = await this.feishu.api<{ instance_code: string; instance_link?: string }>(
        'approval/v4/instances/initiate?user_id_type=open_id', token,
        { method: 'POST', body: JSON.stringify({ approval_code: this.config.cloudApprovalCode, form: JSON.stringify(form), uuid: batchId }) },
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
        Action: 'Submit', BatchId: batchId, ApprovalType: approvalType, Submitted: true,
        InstanceCode: created.instance_code, InstanceLink: finalLink, SerialNumber: serialNumber, RecordCount: records.length,
        BaseAmount: totalAmount, AmountWithServiceFee: amountWithServiceFee,
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
      let instanceCode = [...new Set(group.map((record) => this.text(record.fields['审批实例Code'])).filter(Boolean))][0];
      if (!instanceCode) {
        const definitionName = this.text(group[0]?.fields['审批定义']) || '';
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

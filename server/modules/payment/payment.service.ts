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

  private resolveApprovalType(records: BaseRecord[]): 'Cloud' | 'Project' {
    const methods = [...new Set(records.map(({ fields }) => this.text(fields['默认收款方式（自动带出）']) || this.text(fields['付款方式'])).filter(Boolean))];
    return methods.length === 1 && methods[0] === '云账户' ? 'Cloud' : 'Project';
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
    return errors;
  }

  private validate(records: BaseRecord[], approvalType: 'Cloud' | 'Project'): string[] {
    if (!records.length) return ['未勾选任何付款明细。'];
    const errors: string[] = [];
    const resourceIds = [...new Set(records.flatMap(({ fields }) => this.linkIds(fields['关联资源'])))];
    if (resourceIds.length !== 1) errors.push('批量付款必须关联同一个资源。');
    if (approvalType === 'Project') {
      const projectIds = [...new Set(records.flatMap(({ fields }) => this.linkIds(fields['关联项目'])))];
      if (projectIds.length !== 1) errors.push('项目费用付款必须关联同一个项目。');
    }
    errors.push(...records.flatMap((record) => this.recordErrors(record)));
    return [...new Set(errors)];
  }

  private async listRecords(token: string, filter: Record<string, unknown>): Promise<BaseRecord[]> {
    const query = new URLSearchParams({ filter: JSON.stringify(filter), limit: '200', offset: '0' });
    const payload = await this.feishu.api<BaseListResponse>(
      `base/v3/bases/${this.config.baseToken}/tables/${this.config.paymentTableId}/records?${query}`,
      token,
    );
    return payload.record_id_list.map((recordId, row) => ({
      recordId,
      fields: Object.fromEntries(payload.fields.map((field, column) => [field, payload.data[row]?.[column]])),
    }));
  }

  private selectedFilter() {
    return { logic: 'and', conditions: [['申请付款选择框', '==', true]] };
  }

  async preview(req: Request, res: Response, tableId?: string): Promise<BatchPreview> {
    if (tableId && tableId !== this.config.paymentTableId) {
      throw new HttpException('请切换到【付款执行明细】后再使用插件', HttpStatus.BAD_REQUEST);
    }
    const token = await this.feishu.userToken(req, res) as string;
    const records = await this.listRecords(token, this.selectedFilter());
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
      Errors: this.recordErrors(record),
    }));
    return {
      Action: 'Preview',
      ApprovalType: approvalType,
      DefinitionName: approvalType === 'Cloud' ? '云账户多收款人' : '项目费用付款',
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
    const form = new FormData();
    form.append('data', JSON.stringify({ name, type: 'attachment' }));
    const fileBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    form.append('content', new Blob([fileBytes], { type: contentType }), name);
    const response = await fetch('https://open.feishu.cn/approval/openapi/v2/file/upload', {
      method: 'POST', headers: { Authorization: `Bearer ${tenantToken}` }, body: form,
    });
    const payload = await response.json() as { code?: number; msg?: string; data?: { code?: string } };
    const fileCode = payload.data?.code;
    if (!response.ok || payload.code || !fileCode) throw new Error(payload.msg || `审批附件上传失败：${name}`);
    return fileCode;
  }

  private async updateRecords(token: string, recordIds: string[], patch: Record<string, unknown>): Promise<void> {
    await this.feishu.api(
      `base/v3/bases/${this.config.baseToken}/tables/${this.config.paymentTableId}/records/batch_update`,
      token,
      { method: 'POST', body: JSON.stringify({ record_id_list: recordIds, patch }) },
    );
  }

  async submit(req: Request, res: Response, input: { reason?: string; paymentEntity?: string; expectedPaymentDate?: string; confirmed?: boolean }) {
    if (input.confirmed !== true) throw new HttpException('提交前需要明确确认', HttpStatus.BAD_REQUEST);
    if (!input.reason?.trim()) throw new HttpException('付款事由不能为空', HttpStatus.BAD_REQUEST);
    if (!input.paymentEntity?.trim()) throw new HttpException('付款主体不能为空', HttpStatus.BAD_REQUEST);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedPaymentDate || '')) throw new HttpException('期望付款日期格式不正确', HttpStatus.BAD_REQUEST);
    const token = await this.feishu.userToken(req, res) as string;
    const records = await this.listRecords(token, this.selectedFilter());
    const approvalType = this.resolveApprovalType(records);
    const errors = this.validate(records, approvalType);
    if (errors.length) throw new HttpException(errors.join('\n'), HttpStatus.BAD_REQUEST);

    const batchId = this.batchId();
    const recordIds = records.map((record) => record.recordId);
    const totalAmount = records.reduce((sum, record) => sum + (this.number(record.fields['实际成本']) || 0), 0);
    const reason = `${input.reason.trim()} [${batchId}]`;
    const definitionName = approvalType === 'Cloud' ? '云账户多收款人' : '项目费用付款';
    const approvalLink = approvalType === 'Cloud' ? this.config.cloudApprovalLink : this.config.projectApprovalLink;
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
        '审批附件Codes': JSON.stringify({ detail: detailCode, evidence: evidenceCodes }),
        '审批附件上传时间': nowText,
        '提交失败原因': null,
        '申请付款选择框': false,
      });

      if (approvalType === 'Project') {
        return {
          Action: 'Submit', BatchId: batchId, ApprovalType: approvalType, Submitted: false, ApprovalLink: approvalLink,
          Blocker: '项目费用付款包含飞书 API 暂不支持的收款银行账户控件。附件已自动上传，请打开审批补选账户后提交。',
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
      await this.updateRecords(token, recordIds, {
        '审批实例Code': created.instance_code,
        '付款审批链接': finalLink,
        '付款进度': '审批中',
        '批量提交状态': '已提交',
        '批次提交时间': nowText,
        '提交失败原因': null,
      });
      return {
        Action: 'Submit', BatchId: batchId, ApprovalType: approvalType, Submitted: true,
        InstanceCode: created.instance_code, InstanceLink: finalLink, RecordCount: records.length,
        BaseAmount: totalAmount, AmountWithServiceFee: amountWithServiceFee,
      };
    } catch (error) {
      await this.updateRecords(token, recordIds, {
        '付款批次号': batchId,
        '批量提交状态': '校验失败',
        '提交失败原因': `提审失败：${error instanceof Error ? error.message : String(error)}`,
        '申请付款选择框': true,
      }).catch(() => undefined);
      throw error;
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
      const instanceCode = [...new Set(group.map((record) => this.text(record.fields['审批实例Code'])).filter(Boolean))][0];
      if (!instanceCode) {
        results.push({ BatchId: batchId, Result: '尚未回填审批实例 Code', Records: group.length });
        continue;
      }
      const detail = await this.feishu.api<{ status: string; serial_number?: string }>(
        `approval/v4/instances/detail?${new URLSearchParams({ instance_code: instanceCode, locale: 'zh-CN' })}`, token,
      );
      const paymentStatus = detail.status === 'APPROVED' ? '待付款' : ['REJECTED', 'CANCELED', 'DELETED'].includes(detail.status) ? '已驳回' : '审批中';
      const nowText = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
      await this.updateRecords(token, group.map((record) => record.recordId), {
        '付款流程编号': detail.serial_number || null,
        '付款进度': paymentStatus,
        '批量提交状态': '已回填',
        '审批回填时间': nowText,
        '申请付款选择框': false,
        '提交失败原因': null,
      });
      results.push({ BatchId: batchId, Result: '已回填', InstanceCode: instanceCode, SerialNumber: detail.serial_number, ApprovalStatus: detail.status, PaymentStatus: paymentStatus, Records: group.length });
    }
    return results;
  }
}

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { FeishuService } from './feishu.service';
import { PaymentConfig } from './payment.config';
import type {
  AttachmentEntry,
  BaseRecord,
  BatchPreview,
  ClosurePreview,
  ClosureSubmitInput,
  ClosureSubmitResult,
  RequiredUpload,
} from './payment.types';

type BaseListResponse = {
  data: unknown[][];
  fields: string[];
  record_id_list: string[];
  has_more: boolean;
};

type ApprovalType = 'Cloud' | 'CloudSingle' | 'Corporate' | 'Wallet' | 'Unknown';

type ApprovalControlDefinition = {
  id: string;
  name: string;
  required?: boolean;
  type: string;
  visible?: boolean;
};

type ApprovalDefinition = {
  approval_name?: string;
  form?: string | ApprovalControlDefinition[];
  node_list?: Array<{ name?: string; need_approver?: boolean }>;
};

type UploadedPaymentFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

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

  private fieldMatches(current: unknown, desired: unknown): boolean {
    if (Array.isArray(desired) && desired.every((item) => item && typeof item === 'object' && 'id' in item)) {
      return this.linkIds(current).sort().join('|') === this.linkIds(desired).sort().join('|');
    }
    if (desired == null || desired === '') return this.text(current) == null;
    return this.text(current) === this.text(desired);
  }

  private needsPatch(record: BaseRecord, patch: Record<string, unknown>): boolean {
    return Object.entries(patch).some(([field, value]) => !this.fieldMatches(record.fields[field], value));
  }

  private paymentMethod(record: BaseRecord): string {
    return this.text(record.fields['付款形式']) || '';
  }

  private recordName(record: BaseRecord): string {
    return this.text(record.fields['资源名字'])
      || this.text(record.fields['资源账号（自动带出）'])
      || this.text(record.fields['项目名称'])
      || record.recordId;
  }

  private cloudSingleEntityLabel(value: unknown): keyof typeof this.config.cloudSingleEntityValues | null {
    const label = (this.text(value) || '').trim();
    if (!label) return null;
    if (label === '新枝' || label === '火勺' || label === '游鸟') return '新枝/火勺/游鸟';
    return Object.prototype.hasOwnProperty.call(this.config.cloudSingleEntityValues, label)
      ? label as keyof typeof this.config.cloudSingleEntityValues
      : null;
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

  private structuredLabel(value: unknown, preferredKeys: string[], depth = 0): string | null {
    if (depth > 5 || value == null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return this.structuredLabel(JSON.parse(trimmed) as unknown, preferredKeys, depth + 1);
        } catch {
          return trimmed;
        }
      }
      return trimmed;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const label = this.structuredLabel(item, preferredKeys, depth + 1);
        if (label) return label;
      }
      return null;
    }
    if (typeof value !== 'object') return String(value);
    const object = value as Record<string, unknown>;
    for (const key of preferredKeys) {
      if (key in object) {
        const label = this.structuredLabel(object[key], preferredKeys, depth + 1);
        if (label) return label;
      }
    }
    for (const key of ['value', 'text']) {
      if (key in object) {
        const label = this.structuredLabel(object[key], preferredKeys, depth + 1);
        if (label) return label;
      }
    }
    return null;
  }

  private bankName(value: unknown): string | null {
    return this.structuredLabel(value, ['bankNameZh', 'name', 'bankNameEn']);
  }

  private bankBranch(value: unknown): string | null {
    return this.structuredLabel(value, ['bankBranchNameZh', 'name', 'bankBranchNameEn']);
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
      bankName: this.bankName(fields['开户银行（插件解析）']),
      bankBranch: this.bankBranch(fields['开户支行（插件解析）']),
      province: this.text(fields['开户省（插件解析）']),
      city: this.text(fields['开户市（插件解析）']),
      accountType: this.text(fields['账户类型（插件解析）']),
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
        bankName: this.bankName(account.widgetAccountBankName),
        bankBranch: this.bankBranch(account.widgetAccountBankBranch),
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
    if (methods[0] === '云账户批量') return 'Cloud';
    if (methods[0] === '云账户单人') return 'CloudSingle';
    if (methods[0] === '小荷包') return 'Wallet';
    if (methods[0] === '付款') return 'Corporate';
    return 'Unknown';
  }

  private expectedDefinitionName(approvalType: ApprovalType): string {
    if (approvalType === 'Cloud') return this.config.cloudApprovalName;
    if (approvalType === 'CloudSingle') return this.config.cloudSingleApprovalName;
    if (approvalType === 'Wallet') return this.config.walletApprovalName;
    if (approvalType === 'Corporate') return this.config.corporateApprovalName;
    return '待识别付款审批';
  }

  private recordErrors(record: BaseRecord): string[] {
    const errors: string[] = [];
    const name = this.recordName(record);
    if (!this.hasOption(record.fields['付款进度'], ['已对账'])) errors.push(`${name}：付款进度必须为已对账。`);
    const cost = this.number(record.fields['实际成本']);
    if (cost == null || cost <= 0) errors.push(`${name}：实际成本必须大于 0。`);
    if (this.resolveApprovalType([record]) === 'Unknown') errors.push(`${name}：付款形式尚未选择或无法识别。`);
    const linkageError = this.text(record.fields['校验错误']);
    if (linkageError) errors.push(...linkageError.split('\n').filter(Boolean));
    const selectedPayment = this.paymentMethod(record);
    if (!['付款', '小荷包', '云账户批量', '云账户单人'].includes(selectedPayment)) errors.push(`${name}：请选择有效付款形式。`);
    if (selectedPayment === '付款') {
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
    if (approvalType === 'CloudSingle' && records.length !== 1) errors.push('云账户单人付款每次只能勾选一条付款明细。');
    if (approvalType === 'Corporate') {
      const payeeKeys = [...new Set(records.map((record) => [
        this.normalized(record.fields['收款户名（自动带出）']),
        this.normalized(record.fields['收款账号（自动带出）']),
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

  private approvalCode(approvalType: ApprovalType): string {
    if (approvalType === 'Cloud') return this.config.cloudApprovalCode;
    if (approvalType === 'CloudSingle') return this.config.cloudSingleApprovalCode;
    if (approvalType === 'Wallet') return this.config.walletApprovalCode;
    if (approvalType === 'Corporate') return this.config.corporateApprovalCode;
    return '';
  }

  private expectedControlIds(approvalType: ApprovalType): Set<string> {
    if (approvalType === 'Cloud') {
      return new Set(Object.values(this.config.cloudWidgets).filter(Boolean));
    }
    if (approvalType === 'CloudSingle') {
      return new Set(Object.values(this.config.cloudSingleWidgets).filter(Boolean));
    }
    if (approvalType === 'Wallet') {
      const { detail, amount, qr } = this.config.walletWidgets;
      return new Set([detail, amount, qr].filter(Boolean));
    }
    if (approvalType === 'Corporate') {
      return new Set(Object.values(this.config.corporateWidgets).filter(Boolean));
    }
    return new Set();
  }

  private requiredUploads(
    records: BaseRecord[],
    definition: ApprovalDefinition | null,
  ): RequiredUpload[] {
    const detailControlIds = new Set([
      this.config.cloudWidgets.detail,
      this.config.cloudSingleWidgets.detail,
      this.config.walletWidgets.detail,
      this.config.corporateWidgets.detail,
    ]);
    return this.definitionControls(definition)
      .filter((control) => control.required && control.visible !== false)
      .flatMap<RequiredUpload>((control) => {
        if (control.type === 'image' || control.type === 'imageV2') {
          return [{
            Key: 'qr' as const,
            ControlId: control.id,
            Name: control.name || '图片',
            Kind: 'image' as const,
            Required: true,
            SatisfiedByBase: false,
          }];
        }
        if (control.type === 'attachmentV2' && !detailControlIds.has(control.id)) {
          return [{
            Key: 'supporting' as const,
            ControlId: control.id,
            Name: control.name || '补充附件',
            Kind: 'attachment' as const,
            Required: false,
            SatisfiedByBase: records.some((record) => ['发票附件', '对账凭证', '验收/凭证附件']
              .some((field) => this.attachmentEntries(record.fields[field]).length > 0)),
          }];
        }
        return [];
      });
  }

  private async approvalDefinition(token: string, approvalType: ApprovalType): Promise<ApprovalDefinition | null> {
    const approvalCode = this.approvalCode(approvalType);
    if (!approvalCode) return null;
    try {
      return await this.feishu.api<ApprovalDefinition>(
        `approval/v4/approvals/${approvalCode}/detail`,
        token,
      );
    } catch {
      throw new HttpException('暂时无法读取飞书审批的必填项配置，请稍后刷新重试。', HttpStatus.BAD_GATEWAY);
    }
  }

  private async closureApprovalDefinition(token: string): Promise<ApprovalDefinition> {
    try {
      return await this.feishu.api<ApprovalDefinition>(
        `approval/v4/approvals/${this.config.closureApprovalCode}/detail`,
        token,
      );
    } catch {
      throw new HttpException('暂时无法读取【测试】项目结项审批配置，请稍后刷新重试。', HttpStatus.BAD_GATEWAY);
    }
  }

  private definitionControls(definition: ApprovalDefinition | null): ApprovalControlDefinition[] {
    if (!definition?.form) return [];
    if (Array.isArray(definition.form)) return definition.form;
    try {
      const parsed = JSON.parse(definition.form) as unknown;
      return Array.isArray(parsed) ? parsed as ApprovalControlDefinition[] : [];
    } catch {
      return [];
    }
  }

  private requiredApprovalErrors(
    records: BaseRecord[],
    approvalType: ApprovalType,
    definition: ApprovalDefinition | null,
    input?: { reason?: string; paymentEntity?: string; expectedPaymentDate?: string },
  ): string[] {
    const errors: string[] = [];
    const expectedName = this.expectedDefinitionName(approvalType);
    if (!definition?.approval_name) {
      errors.push(`无法确认审批 Code 对应的完整名称，已阻止发起“${expectedName}”。`);
    } else if (definition.approval_name !== expectedName) {
      errors.push(`审批定义配置不匹配：当前 Code 对应“${definition.approval_name}”，预期为“${expectedName}”。`);
    }
    if (approvalType === 'Corporate') {
      for (const record of records) {
        const name = this.recordName(record);
        const accountFields = [
          ['收款户名', '收款户名（自动带出）'],
          ['银行账号', '收款账号（自动带出）'],
          ['开户银行', '开户银行（自动带出）'],
          ['开户支行', '开户支行（自动带出）'],
          ['开户省', '开户省（自动带出）'],
          ['开户市', '开户市（自动带出）'],
          ['账户类型', '账户类型（自动带出）'],
        ] as const;
        const missing = accountFields.filter(([, field]) => !this.text(record.fields[field])).map(([label]) => label);
        if (missing.length) {
          errors.push(`${name}：资源入库审批缺少${missing.join('、')}，必须先完成资源账户变更审批。`);
        }
      }
    }
    if (approvalType === 'CloudSingle') {
      const record = records[0];
      const requiredResourceFields = [
        ['收款对象', this.recordName(record)],
        ['银行卡号', this.text(record?.fields['银行卡号（自动带出）'])],
        ['真实姓名', this.text(record?.fields['收款人（自动带出）'])],
        ['身份证号', this.text(record?.fields['身份证号（自动带出）'])],
        ['联系电话', this.text(record?.fields['联系电话（自动带出）'])],
      ] as const;
      const missing = requiredResourceFields.filter(([, value]) => !value?.trim()).map(([label]) => label);
      if (missing.length) errors.push(`云账户单人付款缺少${missing.join('、')}，请先补全关联资源入库信息。`);
      if (input && !this.cloudSingleEntityLabel(input.paymentEntity)) {
        errors.push(`下单主体必须选择：${Object.keys(this.config.cloudSingleEntityValues).join('、')}。`);
      }
    }
    const totalAmount = records.reduce((sum, record) => sum + (this.number(record.fields['实际成本']) || 0), 0);
    const expectedControlIds = this.expectedControlIds(approvalType);
    const controls = this.definitionControls(definition);
    const actualControlIds = new Set(controls.map((control) => control.id));
    for (const controlId of expectedControlIds) {
      if (!actualControlIds.has(controlId)) {
        errors.push(`审批表单控件配置已变化：未找到控件 ${controlId}，请管理员更新插件映射。`);
      }
    }
    for (const control of controls.filter((item) => item.required && item.visible !== false)) {
      const name = control.name || '未命名字段';
      if (control.type !== 'account' && !expectedControlIds.has(control.id)) {
        errors.push(`审批新增了未映射的必填项“${name}”，请管理员先更新插件映射。`);
        continue;
      }
      if (control.type === 'department') {
        if (!/^od-[\w-]+$/.test(this.config.walletDepartmentOpenId)) {
          errors.push(`审批必填项“${name}”未配置有效部门，请联系插件管理员处理。`);
        }
      } else if (control.type === 'contact') {
        const contactId = this.userIds(records[0]?.fields['付款联系人OpenId（自动带出）'])[0];
        if (!contactId) errors.push(`审批必填项“${name}”无法自动带出，请检查关联项目的发起人。`);
      } else if (control.type === 'amount') {
        if (totalAmount <= 0) errors.push(`审批必填项“${name}”必须大于 0，请填写付款执行明细的实际成本。`);
      } else if (control.type === 'input') {
        const value = name === '项目名称'
          ? this.text(records[0]?.fields['项目名称'])
          : name === '项目编号'
            ? this.text(records[0]?.fields['项目编号（自动带出）'])
            : name === '承接主体'
              ? input?.paymentEntity?.trim() || this.text(records[0]?.fields['付款主体'])
              : name === '收款户名'
                ? this.text(records[0]?.fields['收款户名（自动带出）'])
                : name === '银行账号'
                  ? this.text(records[0]?.fields['收款账号（自动带出）'])
                  : name === '开户银行'
                    ? this.text(records[0]?.fields['开户银行（自动带出）'])
                    : name === '开户支行'
                      ? this.text(records[0]?.fields['开户支行（自动带出）'])
                      : name === '开户省'
                        ? this.text(records[0]?.fields['开户省（自动带出）'])
                        : name === '开户市'
                          ? this.text(records[0]?.fields['开户市（自动带出）'])
                          : name === '账户类型'
                            ? this.text(records[0]?.fields['账户类型（自动带出）'])
                            : name === '收款对象'
                              ? this.recordName(records[0])
                              : name === '银行卡号'
                                ? this.text(records[0]?.fields['银行卡号（自动带出）'])
                                : name === '真实姓名'
                                  ? this.text(records[0]?.fields['收款人（自动带出）'])
                                  : name === '身份证号'
                                    ? this.text(records[0]?.fields['身份证号（自动带出）'])
                                    : name === '联系电话'
                                      ? this.text(records[0]?.fields['联系电话（自动带出）'])
                            : null;
        const shouldValidate = ['项目名称', '项目编号', '承接主体', '收款户名', '银行账号', '开户银行', '开户支行', '开户省', '开户市', '账户类型', '收款对象', '银行卡号', '真实姓名', '身份证号', '联系电话'].includes(name);
        if (shouldValidate && !value?.trim()) {
          errors.push(`审批必填项“${name}”不能为空，请先补全关联的立项或资源入库审批。`);
        }
      } else if (control.type === 'image' || control.type === 'imageV2') {
        // 图片由员工在付款提审台临时上传，预检阶段只返回动态上传项。
      } else if (control.type === 'attachmentV2' && !name.includes('项目明细')) {
        // 付款明细附件和补充凭证在提交阶段统一上传。
      } else if (control.type === 'textarea' && input && !input.reason?.trim()) {
        errors.push(`审批必填项“${name}”不能为空，请填写付款事由。`);
      } else if (control.type === 'date' && input && !input.expectedPaymentDate) {
        errors.push(`审批必填项“${name}”不能为空，请选择期望付款日期。`);
      } else if (control.type === 'checkboxV2' && approvalType === 'CloudSingle' && input && !this.cloudSingleEntityLabel(input.paymentEntity)) {
        errors.push(`审批必填项“${name}”必须选择有效主体。`);
      } else if (control.type === 'radioV2' && approvalType === 'Corporate' && !this.config.corporatePaymentMethodValue) {
        errors.push(`审批必填项“${name}”未配置，请联系插件管理员设置付款方式。`);
      } else if (control.type === 'account') {
        errors.push(`审批必填项“${name}”是 API 不支持写入的原生收款账户控件，请审批管理员改成普通文本字段。`);
      } else if (control.type === 'connect') {
        errors.push(`审批必填项“${name}”尚未配置自动关联，请审批管理员将其改为非必填或移除。`);
      }
    }
    if (definition?.node_list?.some((node) => node.need_approver)) {
      errors.push('当前审批流程仍要求发起人选择审批人，插件无法自动选择；请审批管理员取消该节点的“发起人选择审批人”。');
    }
    return [...new Set(errors)];
  }

  private submittedFormErrors(definition: ApprovalDefinition | null, form: Array<Record<string, unknown>>): string[] {
    const submitted = new Map(form.map((item) => [String(item.id || ''), item]));
    const errors: string[] = [];
    const empty = (value: unknown): boolean => value == null
      || value === ''
      || (Array.isArray(value) && value.length === 0);
    for (const control of this.definitionControls(definition).filter((item) => item.required && item.visible !== false)) {
      const item = submitted.get(control.id);
      const value = control.type === 'contact' ? item?.open_ids : item?.value;
      if (!item || empty(value) || (control.type === 'amount' && Number(value) <= 0)) {
        errors.push(`审批必填项“${control.name || '未命名字段'}”尚未填写，请补充后再提审。`);
      }
    }
    return errors;
  }

  private friendlyApprovalError(error: unknown, definition: ApprovalDefinition | null): string {
    const raw = error instanceof Error ? error.message : String(error);
    const widgetId = raw.match(/widget\d+/)?.[0];
    const control = widgetId
      ? this.definitionControls(definition).find((item) => item.id === widgetId)
      : undefined;
    if (/validate form error/i.test(raw)) {
      return control
        ? `审批必填项“${control.name}”未填写或格式不正确，请检查后重新提审。`
        : '审批表单中有必填项未填写或格式不正确，请检查付款明细后重新提审。';
    }
    if (/approver|审批人|node_approver/i.test(raw)) {
      return '审批流程要求发起人选择审批人，请审批管理员取消该设置后重新提审。';
    }
    if (/permission|forbidden|scope|无权限/i.test(raw)) {
      return '当前账号没有发起该审批所需的权限，请联系审批管理员检查可见范围和应用权限。';
    }
    if (/token|unauthorized|登录|授权/i.test(raw)) {
      return '飞书授权已失效，请重新授权后再提审。';
    }
    if (/duplicate|uuid|重复/i.test(raw)) {
      return '本批次已经提交过，请先刷新审批状态，避免重复提审。';
    }
    if (raw.startsWith('审批必填项') || raw.startsWith('当前审批流程')) return raw;
    return '飞书暂时未能创建审批，请刷新后重试；若仍失败，请联系插件管理员检查审批流程配置。';
  }

  private friendlyDataError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    if (/data not ready|try again later|timeout|timed out/i.test(raw)) {
      return '关联数据正在同步，请稍后刷新重试。';
    }
    if (/permission|forbidden|scope|无权限/i.test(raw)) {
      return '当前账号没有更新付款明细的权限，请联系多维表格管理员。';
    }
    if (/record.*not found|not found|不存在/i.test(raw)) {
      return '关联记录已不存在，请重新选择立项或资源记录。';
    }
    return '关联数据暂时无法更新，请刷新后重试。';
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
      const projectInitiatorId = this.userIds(projectRecord?.fields['发起人'])[0] || null;
      const effectiveFields = {
        ...record.fields,
        '项目编号（自动带出）': projectRecord?.fields['项目编号'] ?? record.fields['项目编号（自动带出）'],
        '项目名称': projectRecord?.fields['项目名称'] ?? record.fields['项目名称'],
        '资源账号（自动带出）': resourceRecord?.fields['资源代称'] ?? record.fields['资源账号（自动带出）'],
        '收款人（自动带出）': resourceRecord?.fields['真实姓名'] ?? record.fields['收款人（自动带出）'],
        '银行卡号（自动带出）': resourceRecord?.fields['银行卡号'] ?? record.fields['银行卡号（自动带出）'],
        '身份证号（自动带出）': resourceRecord?.fields['身份证号'],
        '联系电话（自动带出）': resourceRecord?.fields['联系电话'],
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
      const semanticPatch: Record<string, unknown> = {
        '校验状态': errors.length ? (errors.some((error) => error.includes('人工确认')) ? '需人工确认' : '阻断') : '通过',
        '校验错误': errors.join('\n') || null,
        ...this.paymentAccountPatch(resourceAccount),
      };
      if (closureRecord) semanticPatch['关联项目结项'] = [{ id: closureRecord.recordId }];
      if (this.needsPatch(record, semanticPatch)) {
        try {
          await this.updateRecords(token, [record.recordId], {
            ...semanticPatch,
            '最后校验时间': nowText,
            '审批源最后更新时间': sourceTimes.at(-1) || nowText,
          });
        } catch (error) {
          errors.push(this.friendlyDataError(error));
          semanticPatch['校验状态'] = '阻断';
          semanticPatch['校验错误'] = errors.join('\n');
        }
      }
      enriched.push({ recordId: record.recordId, fields: { ...effectiveFields, ...semanticPatch } });
    }
    return enriched;
  }

  private selectedFilter() {
    return { logic: 'and', conditions: [['申请付款选择框', '==', true]] };
  }

  private closureSelectedFilter() {
    return { logic: 'and', conditions: [['申请结项选择框', '==', true]] };
  }

  private closureId(): string {
    const now = new Date();
    const stamp = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(now).replace(/[-: ]/g, '');
    return `CLOSE-${stamp.slice(0, 8)}-${stamp.slice(8)}-${randomBytes(2).toString('hex').toUpperCase()}`;
  }

  private closureDefinitionErrors(definition: ApprovalDefinition): string[] {
    const errors: string[] = [];
    if (definition.approval_name !== this.config.closureApprovalName) {
      errors.push(`审批定义配置不匹配：当前 Code 对应“${definition.approval_name || '未知'}”，预期为“${this.config.closureApprovalName}”。`);
    }
    const actualControlIds = new Set(this.definitionControls(definition).map((control) => control.id));
    for (const controlId of Object.values(this.config.closureWidgets)) {
      if (!actualControlIds.has(controlId)) {
        errors.push(`项目结项审批表单已变化：未找到控件 ${controlId}，请管理员更新插件映射。`);
      }
    }
    const mappedControlIds = new Set(Object.values(this.config.closureWidgets));
    for (const control of this.definitionControls(definition).filter((item) => item.required && item.visible !== false)) {
      if (!mappedControlIds.has(control.id)) {
        errors.push(`项目结项审批新增了未映射的必填项“${control.name || '未命名字段'}”，请管理员先更新插件映射。`);
      }
    }
    if (definition.node_list?.some((node) => node.need_approver)) {
      errors.push('项目结项审批仍要求发起人选择审批人，请将流程改为固定审批人后再提交。');
    }
    return [...new Set(errors)];
  }

  private closureRecipientEntity(value: unknown): keyof typeof this.config.closureRecipientValues {
    const entity = this.text(value) || '';
    return entity === '新枝' || entity === '火勺' || entity === '游鸟' ? entity : '其他';
  }

  private async closureRecords(token: string): Promise<{ records: BaseRecord[]; projects: BaseRecord[] }> {
    const [records, projects] = await Promise.all([
      this.listRecords(token, this.closureSelectedFilter()),
      this.listTableRecords(token, this.config.projectSyncTableId),
    ]);
    return { records, projects };
  }

  async closurePreview(req: Request, res: Response, tableId?: string): Promise<ClosurePreview> {
    if (tableId && tableId !== this.config.paymentTableId) {
      throw new HttpException('请切换到【付款执行明细】后再使用插件', HttpStatus.BAD_REQUEST);
    }
    const token = await this.feishu.userToken(req, res) as string;
    const [{ records, projects }, definition, closures] = await Promise.all([
      this.closureRecords(token),
      this.closureApprovalDefinition(token),
      this.listTableRecords(token, this.config.closureSyncTableId),
    ]);
    const blockingErrors = this.closureDefinitionErrors(definition);
    if (!records.length) blockingErrors.push('未勾选任何结项申请。');
    if (records.length > 1) blockingErrors.push('项目结项暂时只支持每次选择一条记录，请取消其他勾选后重试。');
    const items = records.map((record) => {
      const errors: string[] = [];
      const projectIds = this.linkIds(record.fields['关联项目']);
      const project = projectIds.length === 1 ? projects.find((item) => item.recordId === projectIds[0]) : undefined;
      if (projectIds.length !== 1) errors.push('请先关联一条立项审批。');
      else if (!project) errors.push('关联项目不在立项同步表中。');
      else if (!this.approved([project]).length) errors.push('关联项目审批尚未通过。');

      const existingInstanceCode = this.text(record.fields['结项审批实例Code']);
      const existingStatus = this.text(record.fields['结项审批状态']);
      if (existingInstanceCode && !['REJECTED', 'CANCELED', 'DELETED'].includes(existingStatus || '')) {
        errors.push('该付款执行明细已经发起过项目结项审批，请先同步或处理现有审批。');
      }
      const projectCode = this.normalized(project?.fields['项目编号']);
      const projectName = this.normalized(project?.fields['项目名称']);
      const approvedClosure = this.approved(closures).some((closure) => projectCode
        ? this.normalized(closure.fields['项目编号']) === projectCode
        : projectName && this.normalized(closure.fields['项目名称']) === projectName);
      if (approvedClosure) errors.push('该项目已经存在已通过的项目结项审批。');

      return {
        RecordId: record.recordId,
        Name: this.recordName(record),
        ProjectName: this.text(project?.fields['项目名称']) || this.text(record.fields['项目名称']),
        ProjectCode: this.text(project?.fields['项目编号']) || this.text(record.fields['项目编号（自动带出）']),
        ProjectStatus: '已验收待开票',
        PaymentEntity: this.text(project?.fields['下单主体']),
        RecipientEntity: this.closureRecipientEntity(project?.fields['承接主体']),
        Amount: this.number(project?.fields['预计收入']),
        Errors: errors,
      };
    });
    blockingErrors.push(...items.flatMap((item) => item.Errors));
    const errors = [...new Set(blockingErrors)];
    return {
      Action: 'ClosurePreview',
      DefinitionName: this.config.closureApprovalName,
      RecordCount: records.length,
      CanSubmit: records.length === 1 && errors.length === 0,
      BlockingErrors: errors,
      Records: items,
      ProjectStatusOptions: Object.keys(this.config.closureProjectStatusValues),
      RecipientEntityOptions: Object.keys(this.config.closureRecipientValues),
    };
  }

  async closureSubmit(
    req: Request,
    res: Response,
    input: ClosureSubmitInput,
  ): Promise<ClosureSubmitResult> {
    if (input.confirmed !== true) throw new HttpException('提交前需要明确确认', HttpStatus.BAD_REQUEST);
    const token = await this.feishu.userToken(req, res) as string;
    const [{ records, projects }, definition, closureSyncRecords] = await Promise.all([
      this.closureRecords(token),
      this.closureApprovalDefinition(token),
      this.listTableRecords(token, this.config.closureSyncTableId),
    ]);
    const errors = this.closureDefinitionErrors(definition);
    if (records.length !== 1) {
      errors.push(records.length ? '项目结项暂时只支持每次选择一条记录，请取消其他勾选后重试。' : '未勾选任何结项申请。');
    }
    const requiredText = [
      ['项目名称', input.projectName],
      ['项目编号', input.projectCode],
      ['付款主体', input.paymentEntity],
    ] as const;
    for (const [label, value] of requiredText) {
      if (!value?.trim()) errors.push(`${label}不能为空。`);
    }
    const projectStatusValue = this.config.closureProjectStatusValues[input.projectStatus as keyof typeof this.config.closureProjectStatusValues];
    if (!projectStatusValue) errors.push('项目状态不在审批允许范围内。');
    const recipientValue = this.config.closureRecipientValues[input.recipientEntity as keyof typeof this.config.closureRecipientValues];
    if (!recipientValue) errors.push('收款主体不在审批允许范围内。');
    if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) errors.push('项目金额必须大于 0。');
    const existingInstanceCode = this.text(records[0]?.fields['结项审批实例Code']);
    const existingStatus = this.text(records[0]?.fields['结项审批状态']);
    if (existingInstanceCode && !['REJECTED', 'CANCELED', 'DELETED'].includes(existingStatus || '')) {
      errors.push('该付款执行明细已经发起过项目结项审批，请勿重复提交。');
    }
    const projectIds = this.linkIds(records[0]?.fields['关联项目']);
    const project = projectIds.length === 1 ? projects.find((item) => item.recordId === projectIds[0]) : undefined;
    if (projectIds.length !== 1) errors.push('请先关联一条立项审批。');
    else if (!project) errors.push('关联项目不在立项同步表中。');
    else if (!this.approved([project]).length) errors.push('关联项目审批尚未通过。');
    const sourceProjectCode = this.normalized(project?.fields['项目编号']);
    const sourceProjectName = this.normalized(project?.fields['项目名称']);
    const approvedClosure = this.approved(closureSyncRecords).some((closure) => sourceProjectCode
      ? this.normalized(closure.fields['项目编号']) === sourceProjectCode
      : sourceProjectName && this.normalized(closure.fields['项目名称']) === sourceProjectName);
    if (approvedClosure) errors.push('该项目已经存在已通过的项目结项审批。');
    if (errors.length) throw new HttpException([...new Set(errors)].join('\n'), HttpStatus.BAD_REQUEST);

    const closureId = this.closureId();
    const widgets = this.config.closureWidgets;
    const form: Array<Record<string, unknown>> = [
      { id: widgets.projectName, type: 'input', value: input.projectName!.trim() },
      { id: widgets.projectCode, type: 'input', value: input.projectCode!.trim() },
      { id: widgets.projectStatus, type: 'radioV2', value: projectStatusValue },
      { id: widgets.paymentEntity, type: 'input', value: input.paymentEntity!.trim() },
      { id: widgets.recipientEntity, type: 'radioV2', value: recipientValue },
      { id: widgets.amount, type: 'amount', value: Number(input.amount), currency: 'CNY' },
    ];
    const submittedErrors = this.submittedFormErrors(definition, form);
    if (submittedErrors.length) throw new HttpException(submittedErrors.join('\n'), HttpStatus.BAD_REQUEST);
    try {
      const created = await this.feishu.api<{ instance_code: string; instance_link?: string }>(
        'approval/v4/instances/initiate?user_id_type=open_id',
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            approval_code: this.config.closureApprovalCode,
            form: JSON.stringify(form),
            uuid: closureId,
          }),
        },
      );
      const instanceLink = created.instance_link || this.config.closureApprovalLink;
      const serialNumber = await this.approvalSerialNumber(token, created.instance_code);
      await this.updateRecords(token, [records[0].recordId], {
        '结项审批实例Code': created.instance_code,
        '结项编号': serialNumber || closureId,
        '结项审批链接': instanceLink,
        '结项审批状态': 'PENDING',
        '申请结项选择框': false,
      });
      return {
        Action: 'ClosureSubmit',
        ClosureId: closureId,
        Submitted: true,
        InstanceCode: created.instance_code,
        InstanceLink: instanceLink,
        SerialNumber: serialNumber,
        RecordCount: 1,
      };
    } catch (error) {
      const detail = this.friendlyApprovalError(error, definition);
      await this.updateRecords(token, [records[0].recordId], { '申请结项选择框': true }).catch(() => undefined);
      throw new HttpException(detail, HttpStatus.BAD_REQUEST);
    }
  }

  async preview(req: Request, res: Response, tableId?: string): Promise<BatchPreview> {
    if (tableId && tableId !== this.config.paymentTableId) {
      throw new HttpException('请切换到【付款执行明细】后再使用插件', HttpStatus.BAD_REQUEST);
    }
    const token = await this.feishu.userToken(req, res) as string;
    const records = await this.resolveLinkages(token, await this.listRecords(token, this.selectedFilter()));
    const approvalType = this.resolveApprovalType(records);
    const definition = await this.approvalDefinition(token, approvalType);
    const blockingErrors = this.requiredApprovalErrors(records, approvalType, definition);
    const errors = [...new Set([...blockingErrors, ...this.validate(records, approvalType)])];
    const items = records.map((record) => ({
      RecordId: record.recordId,
      Name: this.recordName(record),
      ProjectName: this.text(record.fields['项目名称']),
      ProjectCode: this.text(record.fields['项目编号（自动带出）']),
      PaymentEntity: this.text(record.fields['付款主体']),
      ResourceAccount: this.text(record.fields['资源账号（自动带出）']),
      Recipient: this.text(record.fields['收款人（自动带出）']),
      PaymentMethod: this.text(record.fields['付款形式']),
      PaymentProgress: this.text(record.fields['付款进度']),
      Cost: this.number(record.fields['实际成本']),
      AcceptanceStatus: this.text(record.fields['验收状态']),
      ContractStatus: this.text(record.fields['合同/订单状态']),
      InvoiceStatus: this.text(record.fields['发票/凭证状态']),
      AttachmentCount: ['发票附件', '对账凭证', '验收/凭证附件']
        .reduce((count, field) => count + this.attachmentEntries(record.fields[field]).length, 0),
      Platform: this.text(record.fields['平台/合作需求类型']),
      Account: this.text(record.fields['账号']),
      Topic: this.text(record.fields['话题/内容']),
      Link: this.text(record.fields['链接']),
      TaxRate: this.text(record.fields['税点']),
      PayeeAccountName: approvalType === 'CloudSingle'
        ? this.text(record.fields['收款人（自动带出）'])
        : this.text(record.fields['收款户名（自动带出）']),
      PayeeAccountNumber: approvalType === 'CloudSingle'
        ? this.text(record.fields['银行卡号（自动带出）'])
        : this.text(record.fields['收款账号（自动带出）']),
      PersonalIdNumber: approvalType === 'CloudSingle' ? this.text(record.fields['身份证号（自动带出）']) : null,
      Phone: approvalType === 'CloudSingle' ? this.text(record.fields['联系电话（自动带出）']) : null,
      BankName: this.text(record.fields['开户银行（自动带出）']),
      BankBranch: this.text(record.fields['开户支行（自动带出）']),
      Province: this.text(record.fields['开户省（自动带出）']),
      City: this.text(record.fields['开户市（自动带出）']),
      AccountType: this.text(record.fields['账户类型（自动带出）']),
      ProjectLinked: this.linkIds(record.fields['关联项目']).length === 1,
      ResourceLinked: this.linkIds(record.fields['关联资源']).length === 1,
      Errors: this.recordErrors(record),
    }));
    const totalAmount = items.reduce((sum, item) => sum + (item.Cost || 0), 0);
    const serviceFeeRate = approvalType === 'Cloud' || approvalType === 'CloudSingle' ? 0.0665 : 0;
    const approvalAmount = Math.round(totalAmount * (1 + serviceFeeRate) * 100) / 100;
    return {
      Action: 'Preview',
      ApprovalType: approvalType,
      ExecutionMode: 'Approval',
      DefinitionName: this.expectedDefinitionName(approvalType),
      AutoSubmitEnabled: blockingErrors.length === 0 && (approvalType === 'Cloud'
        ? [
            this.config.cloudApprovalCode,
            ...Object.values(this.config.cloudWidgets),
          ].every(Boolean)
        : approvalType === 'CloudSingle'
          ? [
              this.config.cloudSingleApprovalCode,
              ...Object.values(this.config.cloudSingleWidgets),
            ].every(Boolean)
        : approvalType === 'Corporate'
          ? [
              this.config.corporateApprovalCode,
              this.config.corporateWidgets.department,
              this.config.corporateWidgets.contact,
              this.config.corporateWidgets.reason,
              this.config.corporateWidgets.detail,
              this.config.corporateWidgets.amount,
              this.config.corporateWidgets.method,
              this.config.corporateWidgets.date,
            ].every(Boolean)
          : [
              this.config.walletApprovalCode,
              this.config.walletWidgets.detail,
              this.config.walletWidgets.amount,
              this.config.walletWidgets.qr,
            ].every(Boolean)),
      RecordCount: records.length,
      TotalAmount: totalAmount,
      ApprovalAmount: approvalAmount,
      ServiceFeeRate: serviceFeeRate,
      CanSubmit: records.length > 0 && errors.length === 0,
      BlockingErrors: blockingErrors,
      Errors: errors,
      RequiredUploads: this.requiredUploads(records, definition),
      PaymentEntityOptions: approvalType === 'CloudSingle' ? Object.keys(this.config.cloudSingleEntityValues) : [],
      Records: items,
    };
  }

  private batchId(): string {
    const now = new Date();
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now).replace(/[-: ]/g, '');
    return `PAY-${stamp.slice(0, 8)}-${stamp.slice(8)}-${randomBytes(2).toString('hex').toUpperCase()}`;
  }

  private csv(records: BaseRecord[], batchId: string, approvalType: ApprovalType): Buffer {
    if (approvalType === 'CloudSingle') {
      const columns = [
        '付款批次号', '付款记录ID', '项目编号', '项目名称', '资源账号', '收款对象',
        '真实姓名', '银行卡号', '身份证号', '联系电话',
        '对应合同', '平台类型', '账号', '话题内容', '链接', '实际成本', '税点', '付款方式',
      ];
      const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const rows = records.map((record) => [
        batchId, record.recordId, this.text(record.fields['项目编号（自动带出）']),
        this.text(record.fields['项目名称']), this.text(record.fields['资源账号（自动带出）']), this.recordName(record),
        this.text(record.fields['收款人（自动带出）']), this.text(record.fields['银行卡号（自动带出）']),
        this.text(record.fields['身份证号（自动带出）']), this.text(record.fields['联系电话（自动带出）']),
        this.text(record.fields['对应合同（自动带出）']), this.text(record.fields['平台/合作需求类型']),
        this.text(record.fields['账号']), this.text(record.fields['话题/内容']), this.text(record.fields['链接']),
        this.number(record.fields['实际成本']), this.text(record.fields['税点']), this.text(record.fields['付款形式']),
      ]);
      return Buffer.from(`\uFEFF${[columns, ...rows].map((row) => row.map(quote).join(',')).join('\r\n')}`, 'utf8');
    }
    const columns = [
      '付款批次号', '付款记录ID', '项目编号', '项目名称', '资源账号', '收款人',
      '收款户名', '收款账号', '开户银行', '开户支行', '开户省', '开户市', '账户类型',
      '对应合同', '平台类型', '账号', '话题内容', '链接', '实际成本', '税点', '付款方式',
    ];
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = records.map((record) => [
      batchId, record.recordId, this.text(record.fields['项目编号（自动带出）']),
      this.text(record.fields['项目名称']), this.text(record.fields['资源账号（自动带出）']), this.text(record.fields['收款人（自动带出）']),
      this.text(record.fields['收款户名（自动带出）']), this.text(record.fields['收款账号（自动带出）']),
      this.text(record.fields['开户银行（自动带出）']), this.text(record.fields['开户支行（自动带出）']),
      this.text(record.fields['开户省（自动带出）']), this.text(record.fields['开户市（自动带出）']),
      this.text(record.fields['账户类型（自动带出）']), this.text(record.fields['对应合同（自动带出）']),
      this.text(record.fields['平台/合作需求类型']), this.text(record.fields['账号']), this.text(record.fields['话题/内容']), this.text(record.fields['链接']),
      this.number(record.fields['实际成本']), this.text(record.fields['税点']), this.text(record.fields['付款形式']),
    ]);
    return Buffer.from(`\uFEFF${[columns, ...rows].map((row) => row.map(quote).join(',')).join('\r\n')}`, 'utf8');
  }

  private async resolvedAttachments(
    token: string,
    records: BaseRecord[],
    fieldNames = ['发票附件', '对账凭证', '验收/凭证附件'],
  ): Promise<AttachmentEntry[]> {
    const expected = new Set(records.flatMap((record) => fieldNames
      .flatMap((fieldName) => this.attachmentEntries(record.fields[fieldName]).map((item) => item.fileToken))));
    if (!expected.size) return [];
    const payload = await this.feishu.api<{ attachments: Record<string, Record<string, AttachmentEntry[] & { extra_info?: string }>> }>(
      `base/v3/bases/${this.config.baseToken}/tables/${this.config.paymentTableId}/get_attachments`,
      token,
      { method: 'POST', body: JSON.stringify({ record_id_list: records.map((record) => record.recordId) }) },
    );
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
    if (result.length !== expected.size) throw new Error('部分付款附件无法解析，请刷新记录后重试');
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
    try {
      const detail = await this.feishu.api<{ serial_number?: string }>(
        `approval/v4/instances/detail?${new URLSearchParams({ instance_code: instanceCode, locale: 'zh-CN' })}`,
        token,
      );
      return detail.serial_number || null;
    } catch {
      // 流水编号回填是补充信息，后续同步会再次读取。
      return null;
    }
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
      if ((field === '付款审批链接' || field === '结项审批链接') && typeof value === 'string') {
        return [field, { link: value, text: field === '结项审批链接' ? '打开结项审批' : '打开付款审批' }];
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

  private async syncClosures(token: string): Promise<unknown[]> {
    const [records, closureSyncRecords] = await Promise.all([
      this.listRecords(token, { logic: 'and', conditions: [['结项审批实例Code', 'non_empty']] }),
      this.listTableRecords(token, this.config.closureSyncTableId),
    ]);
    const results: unknown[] = [];
    for (const record of records) {
      const instanceCode = this.text(record.fields['结项审批实例Code']);
      if (!instanceCode) continue;
      try {
        const detail = await this.feishu.api<{ status: string; serial_number?: string }>(
          `approval/v4/instances/detail?${new URLSearchParams({ instance_code: instanceCode, locale: 'zh-CN' })}`,
          token,
        );
        const matchedSyncRecord = closureSyncRecords.find((item) => this.approvalInstanceCode(item.fields.SourceID) === instanceCode);
        const patch: Record<string, unknown> = {
          '结项编号': detail.serial_number || this.text(record.fields['结项编号']),
          '结项审批状态': detail.status,
          '申请结项选择框': false,
        };
        if (matchedSyncRecord) patch['关联项目结项'] = [{ id: matchedSyncRecord.recordId }];
        if (this.needsPatch(record, patch)) {
          await this.updateRecords(token, [record.recordId], patch);
        }
        results.push({
          Type: 'Closure',
          RecordId: record.recordId,
          InstanceCode: instanceCode,
          SerialNumber: detail.serial_number,
          ApprovalStatus: detail.status,
          LinkedSyncRecord: Boolean(matchedSyncRecord),
        });
      } catch (error) {
        results.push({ Type: 'Closure', RecordId: record.recordId, InstanceCode: instanceCode, Result: this.friendlyDataError(error) });
      }
    }
    return results;
  }

  async submit(
    req: Request,
    res: Response,
    input: { reason?: string; paymentEntity?: string; expectedPaymentDate?: string; confirmed?: boolean; allowValidationErrors?: boolean },
    files: UploadedPaymentFile[] = [],
  ) {
    if (input.confirmed !== true) throw new HttpException('提交前需要明确确认', HttpStatus.BAD_REQUEST);
    if (!input.reason?.trim()) throw new HttpException('付款事由不能为空', HttpStatus.BAD_REQUEST);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedPaymentDate || '')) throw new HttpException('期望付款日期格式不正确', HttpStatus.BAD_REQUEST);
    const token = await this.feishu.userToken(req, res) as string;
    const records = await this.resolveLinkages(token, await this.listRecords(token, this.selectedFilter()));
    const approvalType = this.resolveApprovalType(records);
    const errors = this.validate(records, approvalType);
    const definition = await this.approvalDefinition(token, approvalType);
    const blockingErrors = this.requiredApprovalErrors(records, approvalType, definition, input);
    const screenshotFile = files.find((file) => file.fieldname === 'detailScreenshot');
    const qrFile = files.find((file) => file.fieldname === 'qrFile');
    const invoiceFiles = files.filter((file) => file.fieldname === 'invoiceFiles');
    const supportingFiles = files.filter((file) => file.fieldname === 'supportingFiles');
    if (!screenshotFile) blockingErrors.push('付款执行明细截图生成失败，请刷新插件后重试。');
    if (screenshotFile && screenshotFile.mimetype !== 'image/png') {
      blockingErrors.push('付款执行明细截图格式异常，请刷新插件后重新生成。');
    }
    if (qrFile && !qrFile.mimetype.startsWith('image/')) {
      blockingErrors.push('收款二维码必须上传图片文件。');
    }
    if (invoiceFiles.some((file) => file.size <= 0)) blockingErrors.push('发票附件中存在空文件，请重新选择。');
    for (const upload of this.requiredUploads(records, definition)) {
      if (upload.Key === 'qr' && upload.Required && !qrFile) {
        blockingErrors.push(`审批必填项“${upload.Name}”尚未上传，请在付款提审台补充后再提交。`);
      }
    }
    if (blockingErrors.length) throw new HttpException(blockingErrors.join('\n'), HttpStatus.BAD_REQUEST);
    if (errors.length && input.allowValidationErrors !== true) throw new HttpException(errors.join('\n'), HttpStatus.BAD_REQUEST);

    const batchId = this.batchId();
    const recordIds = records.map((record) => record.recordId);
    const totalAmount = records.reduce((sum, record) => sum + (this.number(record.fields['实际成本']) || 0), 0);
    const paymentEntity = input.paymentEntity?.trim() || '';
    if (!paymentEntity) throw new HttpException('付款主体不能为空，请手动填写后再提交。', HttpStatus.BAD_REQUEST);
    const reason = `${input.reason.trim()} [${batchId}]`;
    if (approvalType === 'Unknown') throw new HttpException('付款形式尚未选择、无法识别或同一批次选择不一致。', HttpStatus.BAD_REQUEST);
    const definitionName = this.expectedDefinitionName(approvalType);
    const approvalLink = approvalType === 'CloudSingle'
      ? this.config.cloudSingleApprovalLink
      : approvalType === 'Cloud'
      ? this.config.cloudApprovalLink
      : approvalType === 'Wallet'
        ? this.config.walletApprovalLink
      : this.config.corporateApprovalLink;
    try {
      const nowText = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());

      const [screenshotCode, csvCode, invoiceCodes] = await Promise.all([
        this.uploadApprovalFile(
          screenshotFile!.buffer,
          `${batchId}-付款执行明细.png`,
          screenshotFile!.mimetype || 'image/png',
        ),
        this.uploadApprovalFile(this.csv(records, batchId, approvalType), `${batchId}-payment-details.csv`, 'text/csv'),
        Promise.all(invoiceFiles.map((file) => this.uploadApprovalFile(file.buffer, file.originalname, file.mimetype))),
      ]);
      const baseDetailCodes = [screenshotCode, csvCode, ...invoiceCodes];
      const attachments = await this.resolvedAttachments(token, records);
      const [resolvedEvidenceCodes, uploadedEvidenceCodes, qrCode] = await Promise.all([
        Promise.all(attachments.map(async (attachment) => {
          const query = new URLSearchParams();
          if (attachment.extraInfo) query.set('extra', attachment.extraInfo);
          const downloaded = await this.feishu.download(`drive/v1/medias/${attachment.fileToken}/download?${query}`, token);
          return this.uploadApprovalFile(downloaded.buffer, attachment.name, downloaded.contentType);
        })),
        Promise.all(supportingFiles.map((file) => this.uploadApprovalFile(file.buffer, file.originalname, file.mimetype))),
        qrFile ? this.uploadApprovalFile(qrFile.buffer, qrFile.originalname, qrFile.mimetype, 'image') : Promise.resolve(null),
      ]);
      const evidenceCodes = [...resolvedEvidenceCodes, ...uploadedEvidenceCodes];
      const detailCodes = approvalType === 'Corporate'
        ? baseDetailCodes
        : approvalType === 'CloudSingle'
          ? [...baseDetailCodes, ...resolvedEvidenceCodes]
          : [...baseDetailCodes, ...evidenceCodes];
      const qrCodes = qrCode ? [qrCode] : [];
      await this.updateRecords(token, recordIds, {
        '付款批次号': batchId,
        '批量提交状态': '待提单',
        '审批定义': definitionName,
        '付款事由': reason,
        '付款主体': paymentEntity,
        '期望付款日期': `${input.expectedPaymentDate} 00:00:00`,
        '付款审批链接': approvalLink,
        '审批附件Codes': JSON.stringify({ detail: detailCodes, invoice: invoiceCodes, evidence: evidenceCodes, qr: qrCodes }),
        '审批附件上传时间': nowText,
        '提交失败原因': null,
        '申请付款选择框': false,
      });

      let form: Array<Record<string, unknown>>;
      if (approvalType === 'CloudSingle') {
        const widgets = this.config.cloudSingleWidgets;
        const entityLabel = this.cloudSingleEntityLabel(paymentEntity);
        if (!entityLabel) throw new Error(`下单主体必须选择：${Object.keys(this.config.cloudSingleEntityValues).join('、')}。`);
        const supportingCodes = uploadedEvidenceCodes;
        form = [
          { id: widgets.recipient, type: 'input', value: this.recordName(records[0]) },
          { id: widgets.reason, type: 'textarea', value: reason },
          { id: widgets.detail, type: 'attachmentV2', value: detailCodes },
          { id: widgets.amountWithFee, type: 'amount', value: Math.round(totalAmount * 1.0665 * 100) / 100, currency: 'CNY' },
          { id: widgets.date, type: 'date', value: `${input.expectedPaymentDate}T00:00:00+08:00` },
          { id: widgets.entity, type: 'checkboxV2', value: [this.config.cloudSingleEntityValues[entityLabel]] },
          { id: widgets.bankCard, type: 'input', value: this.text(records[0]?.fields['银行卡号（自动带出）']) || '' },
          { id: widgets.realName, type: 'input', value: this.text(records[0]?.fields['收款人（自动带出）']) || '' },
          { id: widgets.idNumber, type: 'input', value: this.text(records[0]?.fields['身份证号（自动带出）']) || '' },
          { id: widgets.phone, type: 'input', value: this.text(records[0]?.fields['联系电话（自动带出）']) || '' },
          { id: widgets.receivedAmount, type: 'number', value: totalAmount },
        ];
        if (supportingCodes.length) {
          form.splice(6, 0, { id: widgets.deliverables, type: 'attachmentV2', value: supportingCodes });
        }
      } else if (approvalType === 'Cloud') {
        const widgets = this.config.cloudWidgets;
        const projectName = this.text(records[0]?.fields['项目名称']);
        const projectCode = this.text(records[0]?.fields['项目编号（自动带出）']);
        form = [
          { id: widgets.department, type: 'department', value: [{ open_id: this.config.walletDepartmentOpenId }] },
          { id: widgets.projectName, type: 'input', value: projectName || '' },
          { id: widgets.projectCode, type: 'input', value: projectCode || '' },
          { id: widgets.entity, type: 'input', value: paymentEntity },
          { id: widgets.reason, type: 'textarea', value: reason },
          { id: widgets.detail, type: 'attachmentV2', value: detailCodes },
          { id: widgets.amount, type: 'amount', value: Math.round(totalAmount * 1.0665 * 100) / 100, currency: 'CNY' },
          { id: widgets.date, type: 'date', value: `${input.expectedPaymentDate}T00:00:00+08:00` },
        ];
      } else if (approvalType === 'Wallet') {
        const widgets = this.config.walletWidgets;
        form = [
          { id: widgets.detail, type: 'attachmentV2', value: detailCodes },
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
          { id: widgets.contact, type: 'contact', open_ids: [contactId] },
          { id: widgets.reason, type: 'textarea', value: reason },
          { id: widgets.detail, type: 'attachmentV2', value: detailCodes },
          { id: widgets.amount, type: 'amount', value: totalAmount, currency: 'CNY' },
          { id: widgets.method, type: 'radioV2', value: this.config.corporatePaymentMethodValue },
          { id: widgets.date, type: 'date', value: `${input.expectedPaymentDate}T00:00:00+08:00` },
          { id: widgets.accountName, type: 'input', value: this.text(records[0]?.fields['收款户名（自动带出）']) || '' },
          { id: widgets.accountNumber, type: 'input', value: this.text(records[0]?.fields['收款账号（自动带出）']) || '' },
          { id: widgets.bankName, type: 'input', value: this.text(records[0]?.fields['开户银行（自动带出）']) || '' },
          { id: widgets.bankBranch, type: 'input', value: this.text(records[0]?.fields['开户支行（自动带出）']) || '' },
          { id: widgets.province, type: 'input', value: this.text(records[0]?.fields['开户省（自动带出）']) || '' },
          { id: widgets.city, type: 'input', value: this.text(records[0]?.fields['开户市（自动带出）']) || '' },
          { id: widgets.accountType, type: 'input', value: this.text(records[0]?.fields['账户类型（自动带出）']) || '' },
        ];
        if (widgets.evidence) {
          form.splice(2, 0, { id: widgets.evidence, type: 'attachmentV2', value: evidenceCodes.length ? evidenceCodes : detailCodes });
        }
      }
      const missingRequiredFields = this.submittedFormErrors(definition, form);
      if (missingRequiredFields.length) throw new Error(missingRequiredFields.join('\n'));
      const approvalCode = approvalType === 'CloudSingle'
        ? this.config.cloudSingleApprovalCode
        : approvalType === 'Cloud'
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
        AmountWithServiceFee: approvalType === 'Cloud' || approvalType === 'CloudSingle' ? Math.round(totalAmount * 1.0665 * 100) / 100 : totalAmount,
      };
    } catch (error) {
      const detail = this.friendlyApprovalError(error, definition);
      await this.updateRecords(token, recordIds, {
        '付款批次号': batchId,
        '批量提交状态': '校验失败',
        '提交失败原因': detail,
        '申请付款选择框': true,
      }).catch(() => undefined);
      throw new HttpException(detail, HttpStatus.BAD_REQUEST);
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
          const discoveryPatch = {
            '审批实例Code': instanceCode,
            '付款审批链接': discovered.approvalLink || null,
            '审批状态': discovered.approvalStatus || null,
            [discovered.linkField]: [{ id: discovered.recordId }],
          };
          const recordsToUpdate = group.filter((record) => this.needsPatch(record, discoveryPatch));
          if (recordsToUpdate.length) {
            await this.updateRecords(token, recordsToUpdate.map((record) => record.recordId), discoveryPatch);
          }
        } else {
          results.push({ BatchId: batchId, Result: '同步表中尚未找到对应审批实例', Records: group.length });
          continue;
        }
      }
      const detail = await this.feishu.api<{ status: string; serial_number?: string }>(
        `approval/v4/instances/detail?${new URLSearchParams({ instance_code: instanceCode, locale: 'zh-CN' })}`, token,
      );
      const paymentStatus = detail.status === 'APPROVED' ? '已付款' : ['REJECTED', 'CANCELED', 'DELETED'].includes(detail.status) ? '已驳回' : '审批中';
      const nowText = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
      const terminal = ['APPROVED', 'REJECTED', 'CANCELED', 'DELETED'].includes(detail.status);
      const syncPatch: Record<string, unknown> = {
        '付款流程编号': detail.serial_number || null,
        '付款进度': paymentStatus,
        '审批状态': detail.status,
        '批量提交状态': '已回填',
        '申请付款选择框': false,
        '提交失败原因': null,
      };
      const recordsToUpdate = group.filter((record) => this.needsPatch(record, syncPatch));
      if (recordsToUpdate.length) {
        await this.updateRecords(token, recordsToUpdate.map((record) => record.recordId), {
          ...syncPatch,
          '审批回填时间': nowText,
          '审批完成时间': terminal ? nowText : null,
        });
      }
      results.push({ BatchId: batchId, Result: '已回填', InstanceCode: instanceCode, SerialNumber: detail.serial_number, ApprovalStatus: detail.status, PaymentStatus: paymentStatus, Records: group.length });
    }
    return [...results, ...await this.syncClosures(token)];
  }
}

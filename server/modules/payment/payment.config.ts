import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function optional(name: string): string {
  return process.env[name]?.trim() || '';
}

@Injectable()
export class PaymentConfig {
  readonly appId = required('FEISHU_APP_ID');
  readonly appSecret = required('FEISHU_APP_SECRET');
  readonly sessionSecret = required('PAYMENT_SESSION_SECRET');
  readonly baseToken = required('PAYMENT_BASE_TOKEN');
  readonly paymentTableId = required('PAYMENT_TABLE_ID');
  readonly projectSyncTableId = required('PROJECT_SYNC_TABLE_ID');
  readonly resourceSyncTableId = required('RESOURCE_SYNC_TABLE_ID');
  readonly closureSyncTableId = required('CLOSURE_SYNC_TABLE_ID');
  readonly paymentSyncTableId = required('PAYMENT_SYNC_TABLE_ID');
  readonly cloudSyncTableId = required('CLOUD_SYNC_TABLE_ID');
  readonly walletSyncTableId = required('WALLET_SYNC_TABLE_ID');
  readonly corporateApprovalCode = required('PROJECT_APPROVAL_CODE');
  readonly walletApprovalCode = required('WALLET_APPROVAL_CODE');
  readonly cloudApprovalCode = optional('CLOUD_APPROVAL_CODE') || '2F29FCB6-ED2D-48AB-A064-C1C27FD4F988';
  readonly cloudWidgets = {
    department: optional('CLOUD_WIDGET_DEPARTMENT_ID') || 'widget17848852798030001',
    projectName: optional('CLOUD_WIDGET_PROJECT_NAME_ID') || 'widget17848852976180001',
    projectCode: optional('CLOUD_WIDGET_PROJECT_CODE_ID') || 'widget17848853077220001',
    entity: optional('CLOUD_WIDGET_ENTITY_ID') || 'widget17848853143530001',
    reason: optional('CLOUD_WIDGET_REASON_ID') || 'widget17228709591510001',
    detail: optional('CLOUD_WIDGET_DETAIL_ATTACHMENT_ID') || 'widget17228697554950001',
    amount: optional('CLOUD_WIDGET_AMOUNT_ID') || 'widget17228709704020001',
    date: optional('CLOUD_WIDGET_DATE_ID') || 'widget17319026392330001',
  };
  readonly walletWidgets = {
    department: optional('WALLET_WIDGET_DEPARTMENT_ID') || 'widget17848854158820001',
    detail: optional('WALLET_WIDGET_DETAIL_ATTACHMENT_ID') || 'widget17848854208630001',
    amount: optional('WALLET_WIDGET_AMOUNT_ID') || 'widget17848854285820001',
    qr: optional('WALLET_WIDGET_QR_IMAGE_ID') || 'widget17848854409660001',
  };
  // 审批 department 控件要求 open_department_id（od-...）。历史线上配置曾写入
  // 多维表格内部的数字 ID，会被 initiate 接口判定为“控件值不合法或为空”。
  // 若环境变量不是有效的 open_department_id，回退到当前租户实际使用的部门。
  readonly walletDepartmentOpenId = /^od-[\w-]+$/.test(optional('WALLET_DEPARTMENT_OPEN_ID'))
    ? optional('WALLET_DEPARTMENT_OPEN_ID')
    : 'od-fbaa82826fa4370666c21145fcea9bc0';
  readonly corporateWidgets = {
    department: optional('PROJECT_WIDGET_DEPARTMENT_ID') || 'widget17848849503700001',
    contact: optional('PROJECT_WIDGET_CONTACT_ID') || 'widget17848849874750001',
    reason: optional('PROJECT_WIDGET_REASON_ID') || 'widget16510492382000001',
    detail: optional('PROJECT_WIDGET_DETAIL_ATTACHMENT_ID') || 'widget16510493307470001',
    evidence: optional('PROJECT_WIDGET_EVIDENCE_ATTACHMENT_ID') || 'widget17848851204670001',
    amount: optional('PROJECT_WIDGET_AMOUNT_ID') || 'widget16510492513760001',
    method: optional('PROJECT_WIDGET_METHOD_ID') || 'widget16510492719570001',
    date: optional('PROJECT_WIDGET_DATE_ID') || 'widget16510493109960001',
    contract: optional('PROJECT_WIDGET_CONTRACT_ID') || 'widget17848851037140001',
  };
  readonly corporatePaymentMethodValue = optional('PROJECT_PAYMENT_METHOD_VALUE') || 'l2hc3vl4-s5t1j9v91vr-1';
  // account/contract 控件无法由审批实例 API 自动填充。只有流程管理员确认已将它们
  // 改为非必填（或移除）后，普通付款才允许插件直接提审。
  readonly corporateAccountControlRequired = optional('PROJECT_ACCOUNT_CONTROL_REQUIRED') !== 'false';
  readonly corporateContractControlRequired = optional('PROJECT_CONTRACT_CONTROL_REQUIRED') !== 'false';
  readonly corporateAutoSubmitEnabled = [
    this.corporateWidgets.reason,
    this.corporateWidgets.detail,
    this.corporateWidgets.amount,
    this.corporateWidgets.date,
    this.corporateAccountControlRequired ? '' : 'account-control-removed',
    this.corporateContractControlRequired ? '' : 'contract-control-removed',
  ].every(Boolean);
  readonly oauthRedirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim();
  readonly clientBasePath = process.env.CLIENT_BASE_PATH?.trim().replace(/\/$/, '') || '';
  readonly corporateApprovalLink = process.env.PROJECT_APPROVAL_LINK?.trim() || '';
  readonly walletApprovalLink = process.env.WALLET_APPROVAL_LINK?.trim() || '';
  readonly cloudApprovalLink = process.env.CLOUD_APPROVAL_LINK?.trim() || '';
  readonly oauthScopes = [
    'auth:user.id:read',
    'offline_access',
    'approval:approval:read',
    'approval:instance:read',
    'approval:instance:write',
    'base:record:read',
    'base:record:update',
    'base:table:read',
    'docs:document.media:download',
  ].join(' ');
}

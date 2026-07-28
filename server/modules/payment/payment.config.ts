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
  readonly walletWidgets = {
    department: optional('WALLET_WIDGET_DEPARTMENT_ID') || 'widget17848854158820001',
    detail: optional('WALLET_WIDGET_DETAIL_ATTACHMENT_ID') || 'widget17848854208630001',
    amount: optional('WALLET_WIDGET_AMOUNT_ID') || 'widget17848854285820001',
    qr: optional('WALLET_WIDGET_QR_IMAGE_ID') || 'widget17848854409660001',
  };
  readonly walletDepartmentOpenId = optional('WALLET_DEPARTMENT_OPEN_ID') || '7399527746871279619';
  readonly corporateWidgets = {
    reason: optional('PROJECT_WIDGET_REASON_ID'),
    detail: optional('PROJECT_WIDGET_DETAIL_ATTACHMENT_ID'),
    evidence: optional('PROJECT_WIDGET_EVIDENCE_ATTACHMENT_ID'),
    amount: optional('PROJECT_WIDGET_AMOUNT_ID'),
    date: optional('PROJECT_WIDGET_DATE_ID'),
  };
  readonly corporateAutoSubmitEnabled = [
    this.corporateWidgets.reason,
    this.corporateWidgets.detail,
    this.corporateWidgets.amount,
    this.corporateWidgets.date,
  ].every(Boolean);
  readonly oauthRedirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim();
  readonly clientBasePath = process.env.CLIENT_BASE_PATH?.trim().replace(/\/$/, '') || '';
  readonly corporateApprovalLink = process.env.PROJECT_APPROVAL_LINK?.trim() || '';
  readonly walletApprovalLink = process.env.WALLET_APPROVAL_LINK?.trim() || '';
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

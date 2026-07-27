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
  readonly projectApprovalCode = required('PROJECT_APPROVAL_CODE');
  readonly cloudApprovalCode = required('CLOUD_APPROVAL_CODE');
  readonly walletApprovalCode = required('WALLET_APPROVAL_CODE');
  readonly cloudWidgets = {
    reason: optional('CLOUD_WIDGET_REASON_ID'),
    detail: optional('CLOUD_WIDGET_DETAIL_ATTACHMENT_ID'),
    evidence: optional('CLOUD_WIDGET_EVIDENCE_ATTACHMENT_ID'),
    amount: optional('CLOUD_WIDGET_AMOUNT_ID'),
    date: optional('CLOUD_WIDGET_DATE_ID'),
  };
  readonly cloudAutoSubmitEnabled = Object.values(this.cloudWidgets).every(Boolean);
  readonly oauthRedirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim();
  readonly clientBasePath = process.env.CLIENT_BASE_PATH?.trim().replace(/\/$/, '') || '';
  readonly projectApprovalLink = process.env.PROJECT_APPROVAL_LINK?.trim() || '';
  readonly cloudApprovalLink = process.env.CLOUD_APPROVAL_LINK?.trim() || '';
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

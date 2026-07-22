import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

@Injectable()
export class PaymentConfig {
  readonly appId = required('FEISHU_APP_ID');
  readonly appSecret = required('FEISHU_APP_SECRET');
  readonly sessionSecret = required('PAYMENT_SESSION_SECRET');
  readonly baseToken = required('PAYMENT_BASE_TOKEN');
  readonly paymentTableId = required('PAYMENT_TABLE_ID');
  readonly projectApprovalCode = required('PROJECT_APPROVAL_CODE');
  readonly cloudApprovalCode = required('CLOUD_APPROVAL_CODE');
  readonly cloudWidgets = {
    reason: required('CLOUD_WIDGET_REASON_ID'),
    detail: required('CLOUD_WIDGET_DETAIL_ATTACHMENT_ID'),
    evidence: required('CLOUD_WIDGET_EVIDENCE_ATTACHMENT_ID'),
    amount: required('CLOUD_WIDGET_AMOUNT_ID'),
    date: required('CLOUD_WIDGET_DATE_ID'),
  };
  readonly oauthRedirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim();
  readonly projectApprovalLink = process.env.PROJECT_APPROVAL_LINK?.trim() || '';
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

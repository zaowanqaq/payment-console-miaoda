import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function optional(name: string): string {
  return process.env[name]?.trim() || '';
}

function migratedOptional(name: string, legacyValue: string, currentValue: string): string {
  const value = optional(name);
  return !value || value === legacyValue ? currentValue : value;
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
  readonly closureSyncTableId = migratedOptional('CLOSURE_SYNC_TABLE_ID', 'tbljMIfqpSrTrDUW', 'tblXgn1a9o4GzKAf');
  readonly closureSyncFallbackTableId = optional('CLOSURE_SYNC_FALLBACK_TABLE_ID') || 'tblXgn1a9o4GzKAf';
  readonly paymentSyncTableId = required('PAYMENT_SYNC_TABLE_ID');
  readonly cloudSyncTableId = required('CLOUD_SYNC_TABLE_ID');
  readonly walletSyncTableId = required('WALLET_SYNC_TABLE_ID');
  readonly corporateApprovalCode = optional('PROJECT_APPROVAL_CODE') || '209D8A1F-ABA3-4E0B-8110-D32A1DC1E0EE';
  readonly walletApprovalCode = optional('WALLET_APPROVAL_CODE') || 'B371918A-58C5-469D-99DF-76FB02F9BCFA';
  readonly cloudApprovalCode = optional('CLOUD_APPROVAL_CODE') || '2F29FCB6-ED2D-48AB-A064-C1C27FD4F988';
  readonly cloudSingleApprovalCode = optional('CLOUD_SINGLE_APPROVAL_CODE') || 'AEB9B736-C8CF-486F-88C5-12A017592E58';
  readonly closureApprovalCode = migratedOptional(
    'CLOSURE_APPROVAL_CODE',
    'E7E75FC5-D6F3-4907-8620-C5FEC1E75E47',
    '7EE85661-DE6F-4D64-8E76-D4FDBA6686FE',
  );
  readonly corporateApprovalName = optional('PROJECT_APPROVAL_NAME') || '【测试】对公付款';
  readonly walletApprovalName = optional('WALLET_APPROVAL_NAME') || '【测试】小荷包';
  readonly cloudApprovalName = optional('CLOUD_APPROVAL_NAME') || '【测试】云账户批量付款资源';
  readonly cloudSingleApprovalName = optional('CLOUD_SINGLE_APPROVAL_NAME') || '【测试】云账户单人付款 【媒介专属】';
  readonly closureApprovalName = migratedOptional('CLOSURE_APPROVAL_NAME', '【测试】项目结项', '【测试】用于成本结项');
  readonly closureWidgets = {
    projectName: optional('CLOSURE_WIDGET_PROJECT_NAME_ID') || 'widget15995472980940001',
    projectCode: optional('CLOSURE_WIDGET_PROJECT_CODE_ID') || 'widget17261296138090001',
    projectPm: optional('CLOSURE_WIDGET_PROJECT_PM_ID') || 'widget17261308893820001',
    amount: optional('CLOSURE_WIDGET_AMOUNT_ID') || 'widget17261366169970001',
    supplierSource: optional('CLOSURE_WIDGET_SUPPLIER_SOURCE_ID') || 'widget17631134270100001',
    detail: optional('CLOSURE_WIDGET_DETAIL_ID') || 'widget17261309811910001',
    supplierName: optional('CLOSURE_WIDGET_SUPPLIER_NAME_ID') || 'widget17631133373720001',
  };
  readonly closureSupplierSourceValues = {
    '外部供应商': 'mhyo7n0j-hj0sswxm54s-0',
    '内部供应商': 'mhyo7n0j-qud3wqpyhm-0',
  } as const;
  readonly cloudWidgets = {
    projectName: optional('CLOUD_WIDGET_PROJECT_NAME_ID') || 'widget17848852976180001',
    projectCode: optional('CLOUD_WIDGET_PROJECT_CODE_ID') || 'widget17848853077220001',
    reason: optional('CLOUD_WIDGET_REASON_ID') || 'widget17228709591510001',
    detail: optional('CLOUD_WIDGET_DETAIL_ATTACHMENT_ID') || 'widget17228697554950001',
    receivedAmount: optional('CLOUD_WIDGET_RECEIVED_AMOUNT_ID') || 'widget17228709704020001',
    amountWithFee: optional('CLOUD_WIDGET_AMOUNT_WITH_FEE_ID') || 'widget17859341767610001',
    date: optional('CLOUD_WIDGET_DATE_ID') || 'widget17319026392330001',
  };
  readonly cloudSingleWidgets = {
    recipient: optional('CLOUD_SINGLE_WIDGET_RECIPIENT_ID') || 'widget17228696962500001',
    reason: optional('CLOUD_SINGLE_WIDGET_REASON_ID') || 'widget17228709591510001',
    detail: optional('CLOUD_SINGLE_WIDGET_DETAIL_ATTACHMENT_ID') || 'widget17228697554950001',
    amountWithFee: optional('CLOUD_SINGLE_WIDGET_AMOUNT_WITH_FEE_ID') || 'widget17228709704020001',
    date: optional('CLOUD_SINGLE_WIDGET_DATE_ID') || 'widget17319026392330001',
    entity: optional('CLOUD_SINGLE_WIDGET_ENTITY_ID') || 'widget17651782281240001',
    deliverables: optional('CLOUD_SINGLE_WIDGET_DELIVERABLES_ID') || 'widget17817699599520001',
    bankCard: optional('CLOUD_SINGLE_WIDGET_BANK_CARD_ID') || 'widget17228710207160001',
    realName: optional('CLOUD_SINGLE_WIDGET_REAL_NAME_ID') || 'widget17228710799580001',
    idNumber: optional('CLOUD_SINGLE_WIDGET_ID_NUMBER_ID') || 'widget17228711048470001',
    phone: optional('CLOUD_SINGLE_WIDGET_PHONE_ID') || 'widget17228710908930001',
    receivedAmount: optional('CLOUD_SINGLE_WIDGET_RECEIVED_AMOUNT_ID') || 'widget17228715921800001',
  };
  readonly cloudSingleEntityValues = {
    HS: 'miwtjhr0-yggv41lulq-0',
    YD: 'miwtjjh3-gxh7t2lkgp-1',
    '新枝/火勺/游鸟': 'miwtjjh3-098s9ygj9234-3',
    AL: 'miwtjjh3-iqa8qh2wuf8-5',
    ZY: 'miwtjjh3-oaahg1jbha-7',
    '其他': 'miwtjjh3-pr8nufptcfj-9',
    HK: 'mo8mwbm8-pz7k64v5n0l-1',
  } as const;
  readonly paymentEntityOptions = [
    '游鸟科技', '游鸟文化', 'HS', 'YD', '新枝', '火勺', '虫乾', '悉多', '皮娃', '平河', '迈越文',
  ] as const;
  readonly walletWidgets = {
    projectName: optional('WALLET_WIDGET_PROJECT_NAME_ID') || 'widget17859346519750001',
    projectCode: optional('WALLET_WIDGET_PROJECT_CODE_ID') || 'widget17859346535610001',
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
    recipient: optional('PROJECT_WIDGET_RECIPIENT_ID') || 'widget17859343847550001',
    reason: optional('PROJECT_WIDGET_REASON_ID') || 'widget16510492382000001',
    detail: optional('PROJECT_WIDGET_DETAIL_ATTACHMENT_ID') || 'widget16510493307470001',
    invoice: optional('PROJECT_WIDGET_INVOICE_ID') || 'widget17859344834390001',
    paymentEntity: optional('PROJECT_WIDGET_PAYMENT_ENTITY_ID') || 'widget17859344721380001',
    amount: optional('PROJECT_WIDGET_AMOUNT_ID') || 'widget16510492513760001',
    date: optional('PROJECT_WIDGET_DATE_ID') || 'widget16510493109960001',
    contract: optional('PROJECT_WIDGET_CONTRACT_ID') || 'widget17848851037140001',
    evidence: optional('PROJECT_WIDGET_EVIDENCE_ATTACHMENT_ID') || 'widget17848851204670001',
    deliverables: optional('PROJECT_WIDGET_DELIVERABLES_ID') || 'widget17848851328350001',
    accountName: optional('PROJECT_WIDGET_ACCOUNT_NAME_ID') || 'widget17852298142770001',
    accountNumber: optional('PROJECT_WIDGET_ACCOUNT_NUMBER_ID') || 'widget17852298443410001',
    bankName: optional('PROJECT_WIDGET_BANK_NAME_ID') || 'widget17852298448880001',
    bankBranch: optional('PROJECT_WIDGET_BANK_BRANCH_ID') || 'widget17852298454220001',
    province: optional('PROJECT_WIDGET_PROVINCE_ID') || 'widget17852298459550001',
    city: optional('PROJECT_WIDGET_CITY_ID') || 'widget17852298464780001',
    accountType: optional('PROJECT_WIDGET_ACCOUNT_TYPE_ID') || 'widget17852298469950001',
  };
  readonly corporatePaymentMethodValue = optional('PROJECT_PAYMENT_METHOD_VALUE') || 'l2hc3vl4-s5t1j9v91vr-1';
  readonly oauthRedirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim();
  readonly clientBasePath = process.env.CLIENT_BASE_PATH?.trim().replace(/\/$/, '') || '';
  readonly corporateApprovalLink = process.env.PROJECT_APPROVAL_LINK?.trim()
    || 'https://applink.feishu.cn/client/mini_program/open?appId=cli_9cb844403dbb9108&mode=appCenter&path=pc%2Fpages%2Fcreate-form%2Findex%3Fid%3D7666023331958705354%26scene%3Ddefinition-share&relaunch=true';
  readonly walletApprovalLink = process.env.WALLET_APPROVAL_LINK?.trim()
    || 'https://applink.feishu.cn/client/mini_program/open?appId=cli_9cb844403dbb9108&mode=appCenter&path=pc%2Fpages%2Fcreate-form%2Findex%3Fid%3D7666024654347291827%26scene%3Ddefinition-share&relaunch=true';
  readonly cloudApprovalLink = process.env.CLOUD_APPROVAL_LINK?.trim()
    || 'https://applink.feishu.cn/client/mini_program/open?appId=cli_9cb844403dbb9108&mode=appCenter&path=pc%2Fpages%2Fcreate-form%2Findex%3Fid%3D7666024249366170920%26scene%3Ddefinition-share&relaunch=true';
  readonly cloudSingleApprovalLink = process.env.CLOUD_SINGLE_APPROVAL_LINK?.trim()
    || 'https://applink.feishu.cn/client/mini_program/open?appId=cli_9cb844403dbb9108&mode=appCenter&path=pc%2Fpages%2Fcreate-form%2Findex%3Fid%3D7669707697763159006%26scene%3Ddefinition-share&relaunch=true';
  readonly closureApprovalLink = migratedOptional(
    'CLOSURE_APPROVAL_LINK',
    'https://applink.feishu.cn/client/mini_program/open?appId=cli_9cb844403dbb9108&mode=appCenter&path=pc%2Fpages%2Fcreate-form%2Findex%3Fid%3D7666025280951061703%26scene%3Ddefinition-share&relaunch=true',
    'https://applink.feishu.cn/client/mini_program/open?appId=cli_9cb844403dbb9108&mode=appCenter&path=pc%2Fpages%2Fcreate-form%2Findex%3Fid%3D7670446956887510301%26scene%3Ddefinition-share&relaunch=true',
  );
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




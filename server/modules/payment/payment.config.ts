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
  readonly corporateApprovalCode = optional('PROJECT_APPROVAL_CODE') || '209D8A1F-ABA3-4E0B-8110-D32A1DC1E0EE';
  readonly walletApprovalCode = optional('WALLET_APPROVAL_CODE') || 'B371918A-58C5-469D-99DF-76FB02F9BCFA';
  readonly cloudApprovalCode = optional('CLOUD_APPROVAL_CODE') || '2F29FCB6-ED2D-48AB-A064-C1C27FD4F988';
  readonly cloudSingleApprovalCode = optional('CLOUD_SINGLE_APPROVAL_CODE') || 'AEB9B736-C8CF-486F-88C5-12A017592E58';
  readonly closureApprovalCode = optional('CLOSURE_APPROVAL_CODE') || 'E7E75FC5-D6F3-4907-8620-C5FEC1E75E47';
  readonly corporateApprovalName = optional('PROJECT_APPROVAL_NAME') || '【测试】付款';
  readonly walletApprovalName = optional('WALLET_APPROVAL_NAME') || '【测试】小荷包';
  readonly cloudApprovalName = optional('CLOUD_APPROVAL_NAME') || '【测试】云账户批量付款资源（仅达人）';
  readonly cloudSingleApprovalName = optional('CLOUD_SINGLE_APPROVAL_NAME') || '【测试】云账户单人付款 【媒介专属】';
  readonly closureApprovalName = optional('CLOSURE_APPROVAL_NAME') || '【测试】项目结项';
  readonly closureWidgets = {
    projectName: optional('CLOSURE_WIDGET_PROJECT_NAME_ID') || 'widget15995472980940001',
    projectCode: optional('CLOSURE_WIDGET_PROJECT_CODE_ID') || 'widget17261296138090001',
    projectStatus: optional('CLOSURE_WIDGET_PROJECT_STATUS_ID') || 'widget17261298132910001',
    paymentEntity: optional('CLOSURE_WIDGET_PAYMENT_ENTITY_ID') || 'widget17261297972930001',
    recipientEntity: optional('CLOSURE_WIDGET_RECIPIENT_ENTITY_ID') || 'widget17261301495660001',
    amount: optional('CLOSURE_WIDGET_AMOUNT_ID') || 'widget17261301892520001',
  };
  readonly closureProjectStatusValues = {
    '已发货待验收': 'm0z14g18-x5jt3r0x88-0',
    '已验收待开票': 'm0z14g18-p9ilrzegiz9-0',
    '已开票待回款': 'm3znoptd-3r9uo50renw-1',
    '已回款': 'm3znoptd-o6a9ve9hlgr-3',
    '其他': 'm3znoptd-vsj3pykngf9-5',
  } as const;
  readonly closureRecipientValues = {
    '新枝': 'm0z1bni7-grqui1a8m8v-0',
    '火勺': 'm0z1bni7-znl95y5tu9-0',
    '游鸟': 'm0z1bnin-swiv62yk21h-1',
    '其他': 'm0z1bnin-69girtf6cyh-3',
  } as const;
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
  readonly closureApprovalLink = process.env.CLOSURE_APPROVAL_LINK?.trim()
    || 'https://applink.feishu.cn/client/mini_program/open?appId=cli_9cb844403dbb9108&mode=appCenter&path=pc%2Fpages%2Fcreate-form%2Findex%3Fid%3D7666025280951061703%26scene%3Ddefinition-share&relaunch=true';
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

export type OAuthToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
};

export type BaseRecord = {
  recordId: string;
  fields: Record<string, unknown>;
};

export type AttachmentEntry = {
  fileToken: string;
  name: string;
  size?: number;
  extraInfo?: string;
};

export type BatchRecord = {
  RecordId: string;
  Name: string;
  ProjectName: string | null;
  ProjectCode: string | null;
  PaymentEntity: string | null;
  ResourceAccount: string | null;
  Recipient: string | null;
  PaymentMethod: string | null;
  Cost: number | null;
  AcceptanceStatus: string | null;
  ContractStatus: string | null;
  InvoiceStatus: string | null;
  AttachmentCount: number;
  Platform: string | null;
  Account: string | null;
  Topic: string | null;
  Link: string | null;
  TaxRate: string | null;
  PayeeAccountName: string | null;
  PayeeAccountNumber: string | null;
  BankName: string | null;
  BankBranch: string | null;
  Province: string | null;
  City: string | null;
  AccountType: string | null;
  ProjectLinked: boolean;
  ResourceLinked: boolean;
  Errors: string[];
};

export type RequiredUpload = {
  Key: 'supporting' | 'qr';
  ControlId: string;
  Name: string;
  Kind: 'attachment' | 'image';
  Required: boolean;
  SatisfiedByBase: boolean;
};

export type BatchPreview = {
  Action: 'Preview';
  ApprovalType: 'Cloud' | 'Corporate' | 'Wallet' | 'Unknown';
  ExecutionMode: 'Approval' | 'ManualPayment';
  DefinitionName: string;
  AutoSubmitEnabled: boolean;
  RecordCount: number;
  TotalAmount: number;
  ApprovalAmount: number;
  ServiceFeeRate: number;
  CanSubmit: boolean;
  BlockingErrors: string[];
  Errors: string[];
  RequiredUploads: RequiredUpload[];
  Records: BatchRecord[];
};

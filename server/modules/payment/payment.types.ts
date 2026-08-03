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
  PaymentProgress: string | null;
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
  ApprovalType: 'Cloud' | 'CloudSingle' | 'Corporate' | 'Wallet' | 'Unknown';
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
  PaymentEntityOptions: string[];
  Records: BatchRecord[];
};

export type ClosureRecord = {
  RecordId: string;
  Name: string;
  ProjectName: string | null;
  ProjectCode: string | null;
  ProjectStatus: string;
  PaymentEntity: string | null;
  RecipientEntity: string;
  Amount: number | null;
  ContractNumber: string | null;
  Errors: string[];
};

export type ClosurePreview = {
  Action: 'ClosurePreview';
  DefinitionName: string;
  RecordCount: number;
  CanSubmit: boolean;
  BlockingErrors: string[];
  Records: ClosureRecord[];
  ProjectStatusOptions: string[];
  RecipientEntityOptions: string[];
};

export type ClosureSubmitInput = {
  projectName?: string;
  projectCode?: string;
  projectStatus?: string;
  paymentEntity?: string;
  recipientEntity?: string;
  amount?: number;
  contractNumber?: string;
  confirmed?: boolean;
};

export type ClosureSubmitResult = {
  Action: 'ClosureSubmit';
  ClosureId: string;
  Submitted: true;
  InstanceCode: string;
  InstanceLink: string;
  SerialNumber?: string | null;
  RecordCount: 1;
};

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
  ResourceAccount: string | null;
  Recipient: string | null;
  PaymentMethod: string | null;
  Cost: number | null;
  AcceptanceStatus: string | null;
  ContractStatus: string | null;
  InvoiceStatus: string | null;
  AttachmentCount: number;
  ProjectLinked: boolean;
  ResourceLinked: boolean;
  Errors: string[];
};

export type BatchPreview = {
  Action: 'Preview';
  ApprovalType: 'Cloud' | 'Corporate' | 'Wallet' | 'Unknown';
  DefinitionName: string;
  RecordCount: number;
  TotalAmount: number;
  CanSubmit: boolean;
  Errors: string[];
  Records: BatchRecord[];
};

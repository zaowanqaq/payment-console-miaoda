export type BatchRecord = {
  RecordId: string
  Name: string
  ProjectName: string | null
  ProjectCode: string | null
  PaymentEntity: string | null
  ResourceAccount: string | null
  Recipient: string | null
  PaymentMethod: string | null
  PaymentProgress: string | null
  Cost: number | null
  AcceptanceStatus: string | null
  ContractStatus: string | null
  InvoiceStatus: string | null
  AttachmentCount: number
  Platform: string | null
  Account: string | null
  Topic: string | null
  Link: string | null
  TaxRate: string | null
  PayeeAccountName: string | null
  PayeeAccountNumber: string | null
  PersonalIdNumber: string | null
  Phone: string | null
  BankName: string | null
  BankBranch: string | null
  Province: string | null
  City: string | null
  AccountType: string | null
  ProjectLinked: boolean
  ResourceLinked: boolean
  Errors: string[]
}

export type RequiredUpload = {
  Key: 'supporting' | 'qr'
  ControlId: string
  Name: string
  Kind: 'attachment' | 'image'
  Required: boolean
  SatisfiedByBase: boolean
}

export type BatchPreview = {
  Action: 'Preview'
  ApprovalType: 'Cloud' | 'CloudSingle' | 'Corporate' | 'Wallet' | 'Unknown'
  ExecutionMode: 'Approval' | 'ManualPayment'
  DefinitionName: string
  AutoSubmitEnabled: boolean
  RecordCount: number
  TotalAmount: number
  ApprovalAmount: number
  ServiceFeeRate: number
  CanSubmit: boolean
  BlockingErrors: string[]
  Errors: string[]
  RequiredUploads: RequiredUpload[]
  PaymentEntityOptions: string[]
  Records: BatchRecord[]
}

export type CurrentUser = {
  name: string
  openId: string
  authMode: 'oauth'
  verified: boolean
  authorized: boolean
  authorizeUrl?: string
}

export type SubmitResult = {
  Action: 'Submit'
  BatchId: string
  ApprovalType: 'Cloud' | 'CloudSingle' | 'Corporate' | 'Wallet'
  ExecutionMode: 'Approval' | 'ManualPayment'
  Submitted: boolean
  InstanceCode?: string
  InstanceLink?: string
  RecordCount?: number
  BaseAmount?: number
  AmountWithServiceFee?: number
  ApprovalLink?: string
  Blocker?: string
  RequiresManualPayment?: boolean
  Next?: string
}

export type ClosureRecord = {
  RecordId: string
  Name: string
  ProjectName: string | null
  ProjectCode: string | null
  ProjectPm: string | null
  Cost: number | null
  Errors: string[]
}

export type ClosurePreview = {
  Action: 'ClosurePreview'
  DefinitionName: string
  RecordCount: number
  TotalAmount: number
  CanSubmit: boolean
  BlockingErrors: string[]
  Records: ClosureRecord[]
  SupplierSourceOptions: string[]
}

export type ClosureSubmitInput = {
  supplierSource: string
}

export type ClosureSubmitResult = {
  Action: 'ClosureSubmit'
  ClosureId: string
  Submitted: true
  InstanceCode: string
  InstanceLink: string
  SerialNumber?: string | null
  RecordCount: number
}

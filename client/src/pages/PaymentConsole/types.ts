export type BatchRecord = {
  RecordId: string
  Name: string
  ProjectName: string | null
  ProjectCode: string | null
  ResourceAccount: string | null
  Recipient: string | null
  PaymentMethod: string | null
  Cost: number | null
  AcceptanceStatus: string | null
  ContractStatus: string | null
  InvoiceStatus: string | null
  AttachmentCount: number
  ProjectLinked: boolean
  ResourceLinked: boolean
  Errors: string[]
}

export type BatchPreview = {
  Action: 'Preview'
  ApprovalType: 'Cloud' | 'Corporate' | 'Wallet' | 'Unknown'
  ExecutionMode: 'Approval' | 'ManualPayment'
  DefinitionName: string
  AutoSubmitEnabled: boolean
  RecordCount: number
  TotalAmount: number
  CanSubmit: boolean
  BlockingErrors: string[]
  Errors: string[]
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
  ApprovalType: 'Cloud' | 'Corporate' | 'Wallet'
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

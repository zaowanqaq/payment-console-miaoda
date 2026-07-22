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
  Errors: string[]
}

export type BatchPreview = {
  Action: 'Preview'
  ApprovalType: 'Cloud' | 'Project'
  DefinitionName: string
  RecordCount: number
  TotalAmount: number
  CanSubmit: boolean
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
  ApprovalType: 'Cloud' | 'Project'
  Submitted: boolean
  InstanceCode?: string
  InstanceLink?: string
  RecordCount?: number
  BaseAmount?: number
  AmountWithServiceFee?: number
  ApprovalLink?: string
  Blocker?: string
  Next?: string
}

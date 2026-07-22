import { bitable } from '@lark-base-open/js-sdk'

export type BaseContext = {
  embedded: boolean
  tableId?: string
  viewId?: string
}

export async function resolveBaseContext(): Promise<BaseContext> {
  try {
    const selection = await Promise.race([
      bitable.base.getSelection(),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('Base host unavailable')), 900)
      }),
    ])
    return {
      embedded: true,
      tableId: selection.tableId ?? undefined,
      viewId: selection.viewId ?? undefined,
    }
  } catch {
    return { embedded: false }
  }
}

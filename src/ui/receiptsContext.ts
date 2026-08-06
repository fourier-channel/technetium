import { createContext, useContext } from 'react'
import type { ReceiptMap } from '../client/useReceipts'

// W2.6 -- read receipts reach the row footer through a context rather than a
// prop on Row, because the thread panel shares that Row and does not compute
// them. An unprovided surface simply shows no receipts.
const EMPTY: ReceiptMap = new Map()

export const ReceiptsContext = createContext<ReceiptMap>(EMPTY)

export function useReceipts(): ReceiptMap {
  return useContext(ReceiptsContext)
}

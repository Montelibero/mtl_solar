import { MemoType } from "@stellar/stellar-sdk"

export interface RequiredMemo {
  type: MemoType
  value: string
}

export interface ResolvedDestination {
  destination: string
  requiredMemo?: RequiredMemo
}

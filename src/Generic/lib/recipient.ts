import { MemoType } from "@stellar/stellar-sdk"

export interface ResolvedRecipient {
  address: string
  memo?: {
    type: MemoType
    value: string
  }
}

export interface RecipientResolver {
  matches(value: string): boolean
  resolve(value: string): Promise<ResolvedRecipient>
}

export function isRecipient(value: string, resolvers: RecipientResolver[]) {
  return resolvers.some(resolver => resolver.matches(value))
}

export async function resolveRecipient(value: string, resolvers: RecipientResolver[]) {
  const resolver = resolvers.find(candidate => candidate.matches(value))
  if (!resolver) throw Error("Recipient is not supported.")
  return resolver.resolve(value)
}

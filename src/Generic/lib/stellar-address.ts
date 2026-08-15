import LRUCache from "lru-cache"
import { Federation, MemoType } from "@stellar/stellar-sdk"
import { workers } from "~Workers/worker-controller"
import { CustomError } from "./errors"
import { RecipientResolver } from "./recipient"
import { isNotFoundError } from "./stellar"

export const isPublicKey = (str: string) => Boolean(str.match(/^G[A-Z0-9]{55}$/))
export const isMuxedAddress = (str: string) => Boolean(str.match(/^M[A-Z0-9]{68}$/))
export const isStellarAddress = (str: string) =>
  Boolean(str.match(/^[^\*> \t\n\r]+\*[^\*\.> \t\n\r]+\.[^\*> \t\n\r]+$/))

export async function lookupFederationRecord(
  stellarAddress: string,
  lookupCache: LRUCache<string, Federation.Api.Record>,
  reverseLookupCache: LRUCache<string, string>,
  cacheKey: string = stellarAddress
) {
  const { netWorker } = await workers
  const cached = lookupCache.get(cacheKey)

  if (cached) {
    return cached
  }

  let resolved: Federation.Api.Record
  try {
    resolved = await netWorker.resolveStellarAddress(stellarAddress)
  } catch (error) {
    if (error && error.request && !error.response) {
      throw CustomError(
        "StellarAddressRequestFailedError",
        `Request for resolving the stellar address failed: ${stellarAddress}`,
        {
          address: stellarAddress
        }
      )
    } else if (isNotFoundError(error)) {
      throw CustomError("StellarAddressNotFoundError", `Stellar address not found: ${stellarAddress}`, {
        address: stellarAddress
      })
    } else {
      throw error
    }
  }
  lookupCache.set(cacheKey, resolved)
  reverseLookupCache.set(resolved.account_id, stellarAddress)
  return resolved
}

export function federationRecipientResolver(
  lookup: (stellarAddress: string) => Promise<Federation.Api.Record>
): RecipientResolver {
  return {
    matches: isStellarAddress,
    async resolve(value) {
      const record = await lookup(value)
      if (!isPublicKey(record.account_id)) throw Error("Resolved destination is invalid.")

      return {
        address: record.account_id,
        memo: record.memo && record.memo_type ? { type: record.memo_type as MemoType, value: record.memo } : undefined
      }
    }
  }
}

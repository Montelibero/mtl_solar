import DebugLogger from "debug"
import throttle from "lodash.throttle"
import { filter, flatMap, map, merge, multicast, Observable } from "observable-fns"
import PromiseQueue from "p-queue"
import qs from "qs"
import { Asset, Horizon, Networks, Transaction } from "@stellar/stellar-sdk"
import pkg from "../../../package.json"
import { Cancellation, CustomError } from "~Generic/lib/errors"
import { observableFromAsyncFactory } from "~Generic/lib/observables"
import { horizonProbeAccountID, resolveHorizonEndpointURL } from "~Generic/lib/horizon-servers"
import { parseAssetID } from "~Generic/lib/stellar"
import { max } from "~Generic/lib/strings"
import { createReconnectingSSE } from "../lib/event-source"
import { parseJSONResponse } from "../lib/rest"
import { resetSubscriptions, subscribeToUpdatesAndPoll } from "../lib/subscription"
import { ServiceID } from "./errors"
import {
  accountDataUpdates,
  offerUpdates,
  handleSubmittedTransaction,
  optimisticallyUpdateAccountData,
  optimisticallyUpdateOffers,
  removeStaleOptimisticUpdates,
  type OptimisticAccountUpdate,
  type OptimisticOfferUpdate
} from "./optimistic-updates/index"
import { AssetRecord } from "stellar-sdk/lib/types/assets"

export interface CollectionPage<T> {
  _embedded: {
    records: T[]
  }
  _links: {
    self: {
      href: string
    }
    next: {
      href: string
    }
    prev: {
      href: string
    }
  }
}

interface FeeStatsDetails {
  max: string
  min: string
  mode: string
  p10: string
  p20: string
  p30: string
  p40: string
  p50: string
  p60: string
  p70: string
  p80: string
  p90: string
  p95: string
  p99: string
}

// See <https://www.stellar.org/developers/horizon/reference/endpoints/fee-stats.html>
interface FeeStats {
  last_ledger: string
  last_ledger_base_fee: string
  ledger_capacity_usage: string
  fee_charged: FeeStatsDetails
  max_fee: FeeStatsDetails
}

export interface HorizonServerProbe {
  message?: string
  ok: boolean
  status?: number
}

const accountSubscriptionCache = new Map<string, Observable<Horizon.AccountResponse>>()
const effectsSubscriptionCache = new Map<string, Observable<Horizon.ServerApi.EffectRecord>>()
const orderbookSubscriptionCache = new Map<string, Observable<Horizon.ServerApi.OrderbookRecord>>()
const ordersSubscriptionCache = new Map<string, Observable<Horizon.ServerApi.OfferRecord[]>>()
const transactionsSubscriptionCache = new Map<string, Observable<Horizon.HorizonApi.TransactionResponse>>()

const accountDataCache = new Map<string, Horizon.AccountResponse | null>()
const accountDataWaitingCache = new Map<string, ReturnType<typeof waitForAccountDataUncached>>()

// Rate-limit concurrent fetches
const fetchQueuesByHorizon = new Map<string, PromiseQueue>()

const identification = {
  "X-Client-Name": "Sunce",
  "X-Client-Version": pkg.version
}

const createAccountCacheKey = (horizonURLs: string[], accountID: string) =>
  `${horizonURLs.map(url => `${url}:`)}${accountID}`
// const createAccountCacheKey = (horizonURL: string, accountID: string) => `${horizonURL}:${accountID}`
const createOrderbookCacheKey = (horizonURLs: string[], sellingAsset: string, buyingAsset: string) =>
  `${horizonURLs.map(url => `${url}:`)}${sellingAsset}:${buyingAsset}`

const debugHorizonSelection = DebugLogger("net-worker:select-horizon")
const debugSubscriptionReset = DebugLogger("net-worker:reset-subscriptions")

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let roundRobinIndex = 0
function getRandomURL(horizonURLs: string[]) {
  const url = horizonURLs[roundRobinIndex % horizonURLs.length]
  roundRobinIndex += 1
  return url
}

function getFetchQueue(horizonURL: string): PromiseQueue {
  if (!fetchQueuesByHorizon.has(horizonURL)) {
    const fetchQueue = new PromiseQueue({
      concurrency: 4,
      interval: 1000,
      intervalCap: 4,
      timeout: 10000,
      throwOnTimeout: true
    })
    fetchQueuesByHorizon.set(horizonURL, fetchQueue)
  }

  return fetchQueuesByHorizon.get(horizonURL)!
}

function getServiceID(horizonURL: string): ServiceID {
  return /testnet/.test(horizonURL) ? ServiceID.HorizonTestnet : ServiceID.HorizonPublic
}

function cachify<T, Args extends any[]>(
  cache: Map<string, Observable<T>>,
  subscribe: (...args: Args) => Observable<T>,
  createCacheKey: (...args: Args) => string
): (...args: Args) => Observable<T> {
  return (...args: Args) => {
    const cacheKey = createCacheKey(...args)
    const cached = cache.get(cacheKey)

    if (cached) {
      return cached
    } else {
      const observable = subscribe(...args)
      cache.set(cacheKey, observable)
      return observable
    }
  }
}

export async function checkHorizonOrFailover(primaryHorizonURL: string, secondaryHorizonURL: string) {
  const debug = debugHorizonSelection
  // Account ID of friendbot (account exists on pubnet, too)
  const testAccountID = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR"

  try {
    // fetch dynamic data to check database access
    const primaryResponse = await Promise.race([
      fetch(resolveHorizonEndpointURL(primaryHorizonURL, `accounts/${testAccountID}`).href),
      delay(2500).then(() => {
        throw Error(`Horizon health check timed out. Trying failover…`)
      })
    ])

    if (primaryResponse.status < 300 || primaryResponse.status === 404) {
      // consider request successful on 404 as well (account might be missing but horizon is working)
      debug(`Primary horizon server seems fine:`, primaryHorizonURL)
      return primaryHorizonURL
    }
  } catch (error) {
    // tslint:disable-next-line no-console
    console.error(error)
  }

  const secondaryResponse = await fetch(resolveHorizonEndpointURL(secondaryHorizonURL, `accounts/${testAccountID}`).href)
  const serverToUse =
    secondaryResponse.status < 300 || secondaryResponse.status === 404 ? secondaryHorizonURL : primaryHorizonURL

  debug(`Primary horizon server check failed. Using ${serverToUse}`)
  return serverToUse
}

export function resetAllSubscriptions() {
  debugSubscriptionReset(`Resetting all active subscriptions…`)

  accountSubscriptionCache.clear()
  effectsSubscriptionCache.clear()
  orderbookSubscriptionCache.clear()
  ordersSubscriptionCache.clear()
  transactionsSubscriptionCache.clear()
  resetSubscriptions()
}

export async function submitTransaction(horizonURL: string, txEnvelopeXdr: string, network: Networks) {
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(horizonURL, `transactions?${qs.stringify({ tx: txEnvelopeXdr })}`)

  const response = await fetchQueue.add(
    () => {
      return fetch(String(url), {
        method: "POST"
      })
    },
    { priority: 20 }
  )

  if (response.status === 200) {
    handleSubmittedTransaction(horizonURL, new Transaction(txEnvelopeXdr, network))
  }

  return {
    status: response.status,
    data: await response.json()
  }
}

async function waitForAccountDataUncached(horizonURL: string, accountID: string, shouldCancel?: () => boolean) {
  const fetchQueue = getFetchQueue(horizonURL)
  const debug = DebugLogger(`net-worker:wait-for-account:${accountID}`)

  let accountData = null
  let initialFetchFailed = false

  for (let interval = 2500; ; interval = Math.min(interval * 1.05, 5000)) {
    if (shouldCancel && shouldCancel()) {
      debug(`Received signal to cancel waiting for account to be created`)
      throw Cancellation("Stopping to wait for account to become present in network.")
    }

    const url = resolveHorizonEndpointURL(horizonURL, `accounts/${accountID}?${qs.stringify(identification)}`)
    const response = await fetchQueue.add(() => fetch(String(url)))

    if (response.status === 200) {
      accountData = await parseJSONResponse<Horizon.AccountResponse>(response)
      break
    } else if (response.status === 404) {
      initialFetchFailed = true
      await delay(interval)
    } else {
      throw CustomError("RequestFailedError", `Request to ${response.url} failed with status ${response.status}`, {
        target: response.url,
        status: response.status
      })
    }
  }

  debug(`Successfully fetched account meta data. ${initialFetchFailed ? "Had to wait." : ""}`)

  return {
    accountData,
    initialFetchFailed
  }
}

async function waitForAccountData(horizonURLs: string[], accountID: string, shouldCancel?: () => boolean) {
  // Cache promise to make sure we don't poll the same account twice simultaneously
  const cacheKey = createAccountCacheKey(horizonURLs, accountID)
  const pending = accountDataWaitingCache.get(cacheKey)
  const horizonURL = getRandomURL(horizonURLs)

  if (pending) {
    return pending
  } else {
    const justStarted = waitForAccountDataUncached(horizonURL, accountID, shouldCancel)
    accountDataWaitingCache.set(cacheKey, justStarted)
    justStarted.then(
      () => accountDataWaitingCache.delete(cacheKey),
      () => accountDataWaitingCache.delete(cacheKey)
    )
    return justStarted
  }
}

function subscribeToAccountEffectsUncached(horizonURLs: string[], accountID: string) {
  const horizonURL = getRandomURL(horizonURLs)
  const fetchQueue = getFetchQueue(horizonURL)
  const debug = DebugLogger(`net-worker:subscriptions:account-effects:${accountID}`)
  const serviceID = getServiceID(horizonURL)

  let latestCursor: string | undefined
  let latestEffectCreatedAt: string | undefined

  return subscribeToUpdatesAndPoll<Horizon.ServerApi.EffectRecord>(
    {
      async applyUpdate(update) {
        debug(`Received new effect:`, update)
        latestCursor = update.paging_token
        latestEffectCreatedAt = update.created_at
        return update
      },
      async fetchUpdate(streamedUpdate) {
        if (streamedUpdate) {
          return streamedUpdate
        } else {
          const effect = await fetchLatestAccountEffect(horizonURL, accountID)
          return effect || undefined
        }
      },
      async init() {
        debug(`Subscribing to account effects…`)
        let effect = await fetchLatestAccountEffect(horizonURL, accountID)

        if (!effect) {
          debug(`Waiting for account to be created on the network…`)
          await waitForAccountData(horizonURLs, accountID)
          effect = await fetchLatestAccountEffect(horizonURL, accountID)
        }

        latestCursor = effect ? effect.paging_token : latestCursor
        latestEffectCreatedAt = effect ? effect.created_at : latestEffectCreatedAt

        return effect || undefined
      },
      shouldApplyUpdate(update) {
        return (
          !latestEffectCreatedAt || (update.created_at >= latestEffectCreatedAt && update.paging_token !== latestCursor)
        )
      },
      subscribeToUpdates() {
        const createURL = () => {
          const query = {
            ...identification,
            cursor: latestCursor || "now"
          }
          return String(resolveHorizonEndpointURL(horizonURL, `accounts/${accountID}/effects?${qs.stringify(query)}`))
        }

        return multicast(
          observableFromAsyncFactory<Horizon.ServerApi.EffectRecord>(async observer => {
            return fetchQueue.add(() =>
              createReconnectingSSE(
                createURL,
                {
                  onMessage(message) {
                    const effect: Horizon.ServerApi.EffectRecord = JSON.parse(message.data)

                    // Don't update latestCursor cursor here – if we do it too early it might cause
                    // shouldApplyUpdate() to return false, since it compares the new effect with itself
                    observer.next(effect)

                    if (effect.type === "account_removed" && effect.account === accountID) {
                      debug(`Closing subscription as account has been merged.`)
                      observer.complete()
                    }
                  },
                  onUnexpectedError(error) {
                    debug(`Unexpected error:`, error)
                    observer.error(error)
                  }
                },
                fetchQueue.add.bind(fetchQueue)
              )
            )
          })
        )
      }
    },
    serviceID,
    {
      retryFetchOnNoUpdate: false
    }
  )
}

export const subscribeToAccountEffects = cachify(
  effectsSubscriptionCache,
  subscribeToAccountEffectsUncached,
  createAccountCacheKey
)

function subscribeToAccountUncached(horizonURLs: string[], accountID: string) {
  const debug = DebugLogger(`net-worker:subscriptions:account:${accountID}`)
  const horizonURL = getRandomURL(horizonURLs)
  const serviceID = getServiceID(horizonURL)

  let latestSnapshot: string | undefined

  const cacheKey = createAccountCacheKey(horizonURLs, accountID)
  const createSnapshot = (accountData: Horizon.AccountResponse) =>
    JSON.stringify([accountData.sequence, accountData.balances])

  return subscribeToUpdatesAndPoll<Horizon.AccountResponse | null>(
    {
      async applyUpdate(update) {
        if (update) {
          debug(`Received account meta data update:`, update)
          accountDataCache.set(cacheKey, update)
          latestSnapshot = createSnapshot(update)
        }
        return update
      },
      async fetchUpdate() {
        debug(`Fetching update…`)
        const accountData = await fetchAccountData(horizonURLs, accountID)
        return accountData || undefined
      },
      async init() {
        debug(`Subscribing to account meta data updates…`)
        const lastKnownAccountData = accountDataCache.get(cacheKey)

        if (lastKnownAccountData) {
          latestSnapshot = createSnapshot(lastKnownAccountData)
          return lastKnownAccountData
        } else {
          const { accountData: initialAccountData } = await waitForAccountData(horizonURLs, accountID)

          accountDataCache.set(cacheKey, initialAccountData)
          // Don't set `latestSnapshot` yet or the value will initially not be emitted

          return initialAccountData
        }
      },
      shouldApplyUpdate(update) {
        return Boolean(update && (!latestSnapshot || createSnapshot(update) !== latestSnapshot))
      },
      subscribeToUpdates() {
        const handleNewOptimisticUpdate = (newOptimisticUpdate: OptimisticAccountUpdate) => {
          const accountData = accountDataCache.get(cacheKey)

          if (newOptimisticUpdate.effectsAccountID === accountID && newOptimisticUpdate.horizonURL === horizonURL) {
            return accountData ? optimisticallyUpdateAccountData(horizonURL, accountData) : accountData
          } else {
            return accountData
          }
        }
        const handleNewOfferUpdate = (newOptimisticUpdate: OptimisticOfferUpdate) => {
          return newOptimisticUpdate.effectsAccountID === accountID && horizonURLs.includes(newOptimisticUpdate.horizonURL)
            ? fetchAccountData(newOptimisticUpdate.horizonURL, accountID, 20)
            : undefined
        }
        return merge(
          // Update whenever we receive an account effect push notification
          subscribeToAccountEffects(horizonURLs, accountID).pipe(map(() => fetchAccountData(horizonURLs, accountID))),
          // Update on new optimistic updates
          accountDataUpdates.observe().pipe(
            map(handleNewOptimisticUpdate),
            filter(accountData => Boolean(accountData))
          ),
          // Order creation/cancellation changes liabilities, but account effects for
          // those operations are unreliable. Refresh account data after local offer updates.
          offerUpdates.observe().pipe(
            map(handleNewOfferUpdate),
            filter(accountData => Boolean(accountData))
          ),
          // Initially fetch data with a delay to make sure we don't miss anything
          Observable.from([0]).pipe(
            map(async () => {
              await delay(1000)
              return fetchAccountData(horizonURLs, accountID)
            })
          )
        )
      }
    },
    serviceID
  )
}

export const subscribeToAccount = cachify(accountSubscriptionCache, subscribeToAccountUncached, createAccountCacheKey)

function subscribeToAccountTransactionsUncached(horizonURLs: string[], accountID: string) {
  const debug = DebugLogger(`net-worker:subscriptions:account-transactions:${accountID}`)

  let latestCursor: string | undefined

  const fetchInitial = async () => {
    const page = await fetchAccountTransactions(horizonURLs, accountID, {
      limit: 1,
      order: "desc"
    })
    const latestTxs = page._embedded.records

    if (latestTxs.length > 0) {
      latestCursor = latestTxs[0].paging_token
    }
  }

  const fetchLatestTxs = throttle(
    async () => {
      debug(`Fetching latest transactions…`)

      if (latestCursor) {
        const page = await fetchAccountTransactions(horizonURLs, accountID, { cursor: latestCursor, limit: 10 })
        return [page, "asc"] as const
      } else {
        const page = await fetchAccountTransactions(horizonURLs, accountID, { limit: 10, order: "desc" })
        return [page, "desc"] as const
      }
    },
    200,
    { leading: true, trailing: true }
  )

  debug(`Subscribing to account's transactions…`)

  fetchInitial().catch(error => {
    // tslint:disable-next-line no-console
    console.error(error)
  })

  return multicast(
    subscribeToAccountEffects(horizonURLs, accountID).pipe(
      flatMap(async function*(): AsyncIterableIterator<Horizon.HorizonApi.TransactionResponse> {
        for (let i = 0; i < 3; i++) {
          const [page, order] = await fetchLatestTxs()
          const newTxs = order === "asc" ? page._embedded.records : page._embedded.records.reverse()

          yield* newTxs

          if (newTxs.length > 0) {
            debug(`Received new transactions:`, newTxs)

            const latestTx = newTxs[newTxs.length - 1]
            latestCursor = latestTx.paging_token
          }

          // There might be race conditions between the different horizon endpoints
          // Wait 350ms, then fetch again, in case the previous fetch didn't return the latest txs yet
          await delay(350)
        }
      })
    )
  )
}

export const subscribeToAccountTransactions = cachify(
  transactionsSubscriptionCache,
  subscribeToAccountTransactionsUncached,
  createAccountCacheKey
)

function subscribeToOpenOrdersUncached(horizonURLs: string[], accountID: string) {
  const debug = DebugLogger(`net-worker:subscriptions:account-orders:${accountID}`)
  const horizonURL = getRandomURL(horizonURLs)
  const serviceID = getServiceID(horizonURL)

  let latestCursor: string | undefined
  let latestSet: Horizon.ServerApi.OfferRecord[] = []

  const fetchUpdate = async () => {
    debug(`Fetching account's open orders…`)

    // Don't use latest cursor as we want to fetch all open orders
    // (otherwise we could not handle order deletions)
    const page = await fetchAccountOpenOrders(horizonURLs, accountID, { order: "desc" })
    return page._embedded.records
  }

  return subscribeToUpdatesAndPoll<Horizon.ServerApi.OfferRecord[]>(
    {
      async applyUpdate(update) {
        debug(`Received updated open orders:`, update)

        if (update.length > 0) {
          const latestID = max(
            update.map(offer => String(offer.id)),
            "0"
          )
          latestCursor = update.find(offer => String(offer.id) === latestID)!.paging_token
        }

        latestSet = update
        return update
      },
      fetchUpdate,
      async init() {
        debug(`Subscribing to open orders…`)
        const records = await fetchUpdate()

        if (records.length > 0) {
          latestCursor = records[0].paging_token
        }

        latestSet = records
        return records
      },
      shouldApplyUpdate(update) {
        const latestUpdateCursor = max(
          update.map(record => record.paging_token),
          "0"
        )
        const emptySet = update.length === 0
        const latestSetEmpty = latestSet.length === 0
        return emptySet !== latestSetEmpty || (!emptySet && latestUpdateCursor !== latestCursor)
      },
      subscribeToUpdates() {
        const handleNewOptimisticUpdate = (newOptimisticUpdate: OptimisticOfferUpdate) => {
          return newOptimisticUpdate.effectsAccountID === accountID && horizonURLs.includes(newOptimisticUpdate.horizonURL)
            ? optimisticallyUpdateOffers(newOptimisticUpdate.horizonURL, accountID, latestSet)
            : latestSet
        }
        // We somewhat rely on the optimistic updates as a trigger to fetch
        // actual on-ledger data as the open orders SSE stream turns out to be
        // unreliable and the account effects stream only indicates a trade
        // happening, not the creation/cancellation of one
        return merge(
          subscribeToAccountEffects(horizonURLs, accountID).pipe(map(() => fetchUpdate())),
          offerUpdates.observe().pipe(map(handleNewOptimisticUpdate))
        )
      }
    },
    serviceID
  )
}

export const subscribeToOpenOrders = cachify(
  ordersSubscriptionCache,
  subscribeToOpenOrdersUncached,
  createAccountCacheKey
)

function assetQuery(prefix: "buying" | "selling" | "source" | "destination", asset: Asset) {
  const assetType = `${prefix}_asset_type`

  return asset.isNative()
    ? { [assetType]: "native" }
    : {
        [`${prefix}_asset_code`]: asset.getCode(),
        [`${prefix}_asset_issuer`]: asset.getIssuer(),
        [assetType]: asset.getAssetType()
      }
}

function createOrderbookQuery(selling: Asset, buying: Asset) {
  return {
    ...assetQuery("buying", buying),
    ...assetQuery("selling", selling),
    limit: 100
  }
}

function stringifyHorizonPathAsset(asset: Asset) {
  return asset.isNative() ? "native" : `${asset.getCode()}:${asset.getIssuer()}`
}

export interface PathRecord {
  destination_amount?: string
  path?: {
    asset_code?: string
    asset_issuer?: string
    asset_type: string
  }[]
  source_amount?: string
}

async function fetchPathRecords(horizonURLs: string[], endpoint: "paths/strict-send" | "paths/strict-receive", query: any) {
  const horizonURL = getRandomURL(horizonURLs)
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(horizonURL, `${endpoint}?${qs.stringify(query)}`)
  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })
  const page = await parseJSONResponse<CollectionPage<PathRecord>>(response)
  return page._embedded.records
}

function createEmptyOrderbookRecord(base: Asset, counter: Asset): Horizon.ServerApi.OrderbookRecord {
  return {
    _links: {
      self: {
        href: ""
      }
    },
    asks: [],
    bids: [],
    base,
    counter
  }
}

function subscribeToOrderbookUncached(horizonURLs: string[], sellingAsset: string, buyingAsset: string) {
  const debug = DebugLogger(`net-worker:subscriptions:orderbook:${buyingAsset}-${sellingAsset}`)

  const buying = parseAssetID(buyingAsset)
  const selling = parseAssetID(sellingAsset)
  const query = createOrderbookQuery(selling, buying)

  if (selling.equals(buying)) {
    return Observable.from<Horizon.ServerApi.OrderbookRecord>([createEmptyOrderbookRecord(buying, buying)])
  }

  const horizonURL = getRandomURL(horizonURLs)
  const createURL = () => String(resolveHorizonEndpointURL(horizonURL, `order_book?${qs.stringify({ ...query, cursor: "now" })}`))
  const fetchUpdate = () => fetchOrderbookRecord(horizonURLs, sellingAsset, buyingAsset)

  let latestKnownSnapshot = ""
  const fetchQueue = getFetchQueue(horizonURL)
  const serviceID = getServiceID(horizonURL)

  // TODO: Optimize - Make UpdateT = ValueT & { [$snapshot]: string }

  return subscribeToUpdatesAndPoll(
    {
      async applyUpdate(update) {
        debug(`Received order book update:`, update)
        latestKnownSnapshot = JSON.stringify(update)
        return update
      },
      fetchUpdate,
      async init() {
        debug(`Subscribing to order book…`)
        const record = await fetchUpdate()
        latestKnownSnapshot = JSON.stringify(record)
        return record
      },
      shouldApplyUpdate(update) {
        const snapshot = JSON.stringify(update)
        return snapshot !== latestKnownSnapshot
      },
      subscribeToUpdates() {
        return observableFromAsyncFactory<Horizon.ServerApi.OrderbookRecord>(observer => {
          return fetchQueue.add(() =>
            createReconnectingSSE(
              createURL,
              {
                onMessage(message) {
                  const record: Horizon.ServerApi.OrderbookRecord = JSON.parse(message.data)
                  observer.next(record)
                },
                onUnexpectedError(error) {
                  debug(`Unexpected error:`, error)
                  observer.error(error)
                }
              },
              fetchQueue.add.bind(fetchQueue)
            )
          )
        })
      }
    },
    serviceID
  )
}

export const subscribeToOrderbook = cachify(
  orderbookSubscriptionCache,
  subscribeToOrderbookUncached,
  createOrderbookCacheKey
)

export interface PaginationOptions {
  cursor?: string
  limit?: number
  order?: "asc" | "desc"
}

export async function fetchAccountData(
  horizonURLs: string | string[],
  accountID: string,
  priority: number = 2,
  skipIssuedAssets = false,
): Promise<(Horizon.AccountResponse & { home_domain?: string | undefined }) | null> {
  const horizonURL = Array.isArray(horizonURLs) ? getRandomURL(horizonURLs) : horizonURLs
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(horizonURL, `accounts/${accountID}?${qs.stringify(identification)}`)
  const response = await fetchQueue.add(() => fetch(String(url)), { priority })

  if (response.status === 404) {
    return null
  }

  const accountData = await parseJSONResponse<Horizon.AccountResponse & { home_domain: string | undefined }>(response)

  let issuedAssets = [] as AssetRecord[]

  if (!skipIssuedAssets) {
    issuedAssets = (await fetchIssuedAssetsData(horizonURL, accountID))._embedded.records.map((a: AssetRecord) => ({
      balance: "0",
      limit: "0",
      asset_type: a.asset_type as any, // TODO: possible to resolve?
      asset_code: a.asset_code,
      asset_issuer: a.asset_issuer,
      buying_liabilities: "0",
      selling_liabilities: "0",
      last_modified_ledger: "",
      is_authorized: true,
      is_authorized_to_maintain_liabilities: true,
      is_clawback_enabled: a.flags.auth_clawback_enabled
    }))
  }
  // FIXME: Add support for liquidity pools
  // Remove liquidity pools from account data
  // Add self-issued assets
  accountData.balances = [
    ...accountData.balances.filter(b => b.asset_type !== "liquidity_pool_shares"),
    ...issuedAssets
  ]
  return optimisticallyUpdateAccountData(horizonURL, accountData)
}

export async function fetchIssuedAssetsData(
  horizonURL: string,
  accountID: string
): Promise<CollectionPage<AssetRecord>> {
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(horizonURL, `assets?${qs.stringify({ asset_issuer: accountID })}`)
  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 2 })

  if (response.status === 404) {
    return {
      _links: {
        next: { href: String(url) },
        prev: { href: String(url) },
        self: { href: String(url) }
      },
      _embedded: {
        records: []
      }
    }
  }

  return parseJSONResponse<CollectionPage<AssetRecord>>(response)
}

export async function fetchLatestAccountEffect(horizonURL: string, accountID: string) {
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(
    horizonURL,
    `accounts/${accountID}/effects?${qs.stringify({
      ...identification,
      limit: 1,
      order: "desc"
    })}`
  )

  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 2 })

  if (response.status === 404) {
    return null
  }

  return parseJSONResponse<Horizon.ServerApi.EffectRecord>(response)
}

export async function fetchTransactionEffects(horizonURLs: string[], transactionHash: string) {
  const horizonURL = getRandomURL(horizonURLs)
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(
    horizonURL,
    `transactions/${transactionHash}/effects?${qs.stringify({
      ...identification,
      limit: 200,
      order: "asc"
    })}`
  )
  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })

  if (response.status === 404) {
    return []
  }

  const page = await parseJSONResponse<CollectionPage<Horizon.ServerApi.EffectRecord>>(response)
  return page._embedded.records
}

export interface FetchTransactionsOptions extends PaginationOptions {
  emptyOn404?: boolean
  emptyOn410?: boolean
}

export async function fetchAccountTransactions(
  horizonURLs: string[],
  accountID: string,
  options: FetchTransactionsOptions = {}
): Promise<CollectionPage<Horizon.HorizonApi.TransactionResponse>> {
  const horizonURL = getRandomURL(horizonURLs)
  const fetchQueue = getFetchQueue(horizonURL)
  const pagination = {
    cursor: options.cursor,
    limit: options.limit,
    order: options.order
  }
  const url = resolveHorizonEndpointURL(
    horizonURL,
    `accounts/${accountID}/transactions?${qs.stringify({ ...identification, ...pagination })}`
  )
  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })

  if ((response.status === 404 && options.emptyOn404) || (response.status === 410 && options.emptyOn410)) {
    return {
      _links: {
        next: { href: String(url) },
        prev: { href: String(url) },
        self: { href: String(url) }
      },
      _embedded: {
        records: []
      }
    }
  }

  const collection = await parseJSONResponse<CollectionPage<Horizon.HorizonApi.TransactionResponse>>(response)

  removeStaleOptimisticUpdates(
    horizonURL,
    collection._embedded.records.map(record => record.hash)
  )
  return collection
}

export async function fetchAccountOpenOrders(
  horizonURLs: string[],
  accountID: string,
  options: PaginationOptions = {}
) {
  const horizonURL = getRandomURL(horizonURLs)
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(horizonURL, `accounts/${accountID}/offers?${qs.stringify({ ...identification, ...options })}`)

  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })

  return parseJSONResponse<CollectionPage<Horizon.ServerApi.OfferRecord>>(response)
}

export async function fetchFeeStats(horizonURL: string): Promise<FeeStats> {
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(horizonURL, "fee_stats")

  const response = await fetchQueue.add(() => fetch(url.toString()), {
    priority: 10
  })

  if (!response.ok) {
    throw CustomError("RequestFailedError", `Request to ${url} failed with status code ${response.status}`, {
      target: url.toString(),
      status: response.status
    })
  }
  return response.json()
}

export async function fetchOrderbookRecord(horizonURLs: string[], sellingAsset: string, buyingAsset: string) {
  if (buyingAsset === sellingAsset) {
    return createEmptyOrderbookRecord(parseAssetID(buyingAsset), parseAssetID(buyingAsset))
  }
  const horizonURL = getRandomURL(horizonURLs)
  const fetchQueue = getFetchQueue(horizonURL)
  const query = createOrderbookQuery(parseAssetID(sellingAsset), parseAssetID(buyingAsset))
  const url = resolveHorizonEndpointURL(horizonURL, `order_book?${qs.stringify({ ...identification, ...query })}`)

  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 1 })
  return parseJSONResponse<Horizon.ServerApi.OrderbookRecord>(response)
}

export async function fetchStrictSendPaths(
  horizonURLs: string[],
  sourceAssetID: string,
  sourceAmount: string,
  destinationAssetID: string
) {
  const sourceAsset = parseAssetID(sourceAssetID)
  const destinationAsset = parseAssetID(destinationAssetID)
  const query = {
    ...identification,
    ...assetQuery("source", sourceAsset),
    destination_assets: stringifyHorizonPathAsset(destinationAsset),
    source_amount: sourceAmount
  }
  return fetchPathRecords(horizonURLs, "paths/strict-send", query)
}

export async function fetchStrictReceivePaths(
  horizonURLs: string[],
  sourceAssetID: string,
  destinationAssetID: string,
  destinationAmount: string
) {
  const sourceAsset = parseAssetID(sourceAssetID)
  const destinationAsset = parseAssetID(destinationAssetID)
  const query = {
    ...identification,
    ...assetQuery("destination", destinationAsset),
    destination_amount: destinationAmount,
    source_assets: stringifyHorizonPathAsset(sourceAsset)
  }
  return fetchPathRecords(horizonURLs, "paths/strict-receive", query)
}

export async function fetchTimebounds(horizonURL: string, timeout: number) {
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(horizonURL, `fee_stats?${qs.stringify(identification)}`)

  const response = await fetchQueue.add(() => fetch(String(url)), { priority: 10 })

  if (!response.ok) {
    throw CustomError("RequestFailedError", `Request to ${url} failed with status code ${response.status}`, {
      target: url.toString(),
      status: response.status
    })
  }

  const dateHeader = response.headers.get("date")
  const parsedServerTime = dateHeader ? Math.floor(Date.parse(dateHeader) / 1000) : Number.NaN
  const currentTime = Number.isNaN(parsedServerTime) ? Math.floor(Date.now() / 1000) : parsedServerTime

  return {
    minTime: 0,
    maxTime: currentTime + timeout
  }
}

export async function probeHorizonServer(horizonURL: string): Promise<HorizonServerProbe> {
  const fetchQueue = getFetchQueue(horizonURL)
  const url = resolveHorizonEndpointURL(horizonURL, `accounts/${horizonProbeAccountID}?${qs.stringify(identification)}`)

  try {
    const response = await fetchQueue.add(() =>
      Promise.race([
        fetch(String(url)),
        delay(10_000).then(() => {
          throw Error("Timed out while waiting for Horizon.")
        })
      ])
    )

    if (!response.ok) {
      let message = `Request failed with status ${response.status}.`

      try {
        const text = await response.text()
        if (text) {
          message = text
        }
      } catch (error) {
        // ignore parsing failures while probing
      }

      return {
        message,
        ok: false,
        status: response.status
      }
    }

    await parseJSONResponse(response)

    return {
      ok: true,
      status: response.status
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false
    }
  }
}

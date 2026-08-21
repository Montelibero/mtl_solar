import {
  Account as StellarAccount,
  Asset,
  Keypair,
  Memo,
  Operation,
  Server,
  ServerApi,
  TransactionBuilder,
  Transaction,
  xdr,
  Networks,
  MuxedAccount
} from "@stellar/stellar-sdk"
import BigNumber from "big.js"
import { Account } from "~App/contexts/accounts"
import { workers } from "~Workers/worker-controller"
import { WrongPasswordError, CustomError } from "./errors"
import { applyTimeout } from "./promise"
import { getAllSources, isNotFoundError } from "./stellar"
import { isMuxedAddress } from "./stellar-address"
import { MultisigTransactionResponse } from "./multisig-service"
import { getPaymentSummary } from "./paymentSummary"
import { getAccountTransactionThreshold } from "./threshold"

/** in stroops */
const maximumFeeToSpend = 1_000_000

// Use a relatively high fee in case there will be a lot of traffic
// on the network later when the tx will be submitted to the network
export const multisigMinimumFee = 10_000

export function createCheapTxID(transaction: Transaction | ServerApi.TransactionRecord): string {
  const source = "source" in transaction ? transaction.source : transaction.source_account
  const sequence = "sequence" in transaction ? transaction.sequence : transaction.source_account_sequence

  if (!source || !sequence) {
    throw CustomError(
      "BadTransactionError",
      `Bad transaction given. Expected a Transaction or TransactionRecord, but got: ${transaction}`,
      { transaction: transaction.hash.toString() }
    )
  }

  return `${source}:${sequence}`
}

function fail(message: string): never {
  throw Error(message)
}

export function hasSigned(
  transaction: Transaction,
  publicKey: string,
  signatureRequest?: MultisigTransactionResponse | null
) {
  const signedAdditionallyBy = signatureRequest?.signed_by || []

  return (
    signedAdditionallyBy.indexOf(publicKey) > -1 ||
    transaction.signatures.some(signature => {
      const hint = signature.hint()
      const keypair = Keypair.fromPublicKey(publicKey)

      return hint.equals(keypair.rawPublicKey().slice(-hint.byteLength))
    })
  )
}

function getBaseAccountId(key: string) {
  return isMuxedAddress(key)
    ? MuxedAccount.fromAddress(key, "0")
        .baseAccount()
        .accountId()
    : key
}

async function accountExists(horizon: Server, publicKey: string) {
  try {
    const accountId = getBaseAccountId(publicKey)
    const account = await horizon
      .accounts()
      .accountId(accountId)
      .call()

    // Hack to fix SatoshiPay horizons responding with status 200 and an empty object on non-existent accounts
    return Object.keys(account).length > 0
  } catch (error) {
    if (isNotFoundError(error)) {
      return false
    } else {
      throw error
    }
  }
}

function selectTransactionTimeout(accountData: Pick<ServerApi.AccountRecord, "signers">): number {
  // Don't forget that we must give the user enough time to enter their password and click ok
  return accountData.signers.length > 1 ? 30 * 24 * 60 * 60 : 90
}

interface TxBlueprint {
  accountData: Pick<ServerApi.AccountRecord, "id" | "signers">
  horizon?: Server
  horizonURL?: string
  memo?: Memo | null
  minTransactionFee?: number
  walletAccount: Account
}

export async function createTransaction(operations: xdr.Operation<any>[], options: TxBlueprint) {
  const { walletAccount } = options
  const { netWorker } = await workers

  const horizonURL = options.horizonURL || options.horizon?.serverURL.toString()
  if (!horizonURL) fail("Missing horizon URL for transaction creation")

  const timeout = selectTransactionTimeout(options.accountData)

  const [accountMetadata, timebounds] = await Promise.all([
    applyTimeout(netWorker.fetchAccountData(horizonURL, walletAccount.accountID, 10, true), 10000, () =>
      fail(`Fetching source account data timed out`)
    ),
    applyTimeout(netWorker.fetchTimebounds(horizonURL, timeout), 10000, () =>
      fail(`Syncing time bounds with horizon timed out`)
    )
  ] as const)

  if (!accountMetadata) {
    throw Error(`Failed to query account from horizon server: ${walletAccount.publicKey}`)
  }

  const account = new StellarAccount(accountMetadata.id, accountMetadata.sequence)
  const networkPassphrase = walletAccount.testnet ? Networks.TESTNET : Networks.PUBLIC
  const txFee = Math.max(options.minTransactionFee || 0, maximumFeeToSpend)

  const builder = new TransactionBuilder(account, {
    fee: String(txFee),
    memo: options.memo || undefined,
    timebounds,
    networkPassphrase
  })

  for (const operation of operations) {
    builder.addOperation(operation)
  }

  const tx = builder.build()
  return tx
}

interface PaymentOperationBlueprint {
  amount: string
  asset: Asset
  destination: string
  horizon: Server
}

interface PathPaymentOperationBlueprint {
  destination: string
  destinationAmount: string
  destinationAsset: Asset
  mode: "strict-send" | "strict-receive"
  path: Asset[]
  sendMax?: string
  sourceAmount: string
  sourceAsset: Asset
  destMin?: string
}

export async function createPaymentOperation(options: PaymentOperationBlueprint) {
  const { amount, asset, destination, horizon } = options
  const destinationAccountExists = await accountExists(horizon, destination)

  if (!destinationAccountExists && !Asset.native().equals(options.asset)) {
    throw CustomError(
      "NonExistentDestinationError",
      `Cannot pay in ${asset.code}$, since the destination account does not exist yet. Account creations always need to be done via XLM.`,
      { assetCode: asset.code }
    )
  }

  const operation = destinationAccountExists
    ? Operation.payment({ destination, amount, asset, withMuxing: true })
    : Operation.createAccount({ destination: getBaseAccountId(destination), startingBalance: amount, withMuxing: true }) // CreateAccount operation cannot set destination to muxed account

  return operation as xdr.Operation<Operation.CreateAccount | Operation.Payment>
}

export function createPathPaymentOperation(options: PathPaymentOperationBlueprint) {
  return (options.mode === "strict-send"
    ? Operation.pathPaymentStrictSend(({
        sendAsset: options.sourceAsset,
        sendAmount: options.sourceAmount,
        destination: options.destination,
        destAsset: options.destinationAsset,
        destMin: options.destMin || options.destinationAmount,
        path: options.path,
        withMuxing: true
      } as any))
    : Operation.pathPaymentStrictReceive(({
        sendAsset: options.sourceAsset,
        sendMax: options.sendMax || options.sourceAmount,
        destination: options.destination,
        destAsset: options.destinationAsset,
        destAmount: options.destinationAmount,
        path: options.path,
        withMuxing: true
      } as any))) as xdr.Operation<Operation.PathPaymentStrictSend | Operation.PathPaymentStrictReceive>
}

export async function signTransaction(transaction: Transaction, walletAccount: Account, password: string | null) {
  if (walletAccount.requiresPassword && !password) {
    throw WrongPasswordError()
  }

  const signedTransaction = walletAccount.signTransaction(transaction, password)
  return signedTransaction
}

export async function requiresRemoteSignatures(horizon: Server, transaction: Transaction, walletPublicKey: string) {
  const { netWorker } = await workers
  const horizonURL = horizon.serverURL.toString()
  const sources = getAllSources(transaction)

  if (sources.length > 1) {
    return true
  }

  const accounts = await Promise.all(
    sources.map(async sourcePublicKey => {
      const account = await netWorker.fetchAccountData(horizonURL, sourcePublicKey, undefined, true)
      if (!account) {
        throw Error(`Could not fetch account metadata from horizon server: ${sourcePublicKey}`)
      }
      return account
    })
  )

  return accounts.some(account => {
    const thisWalletSigner = account.signers.find(signer => signer.key === walletPublicKey)
    if (!thisWalletSigner || thisWalletSigner.weight === 0) {
      return false
    }

    const accountThreshold = getAccountTransactionThreshold(account, transaction)
    // requires another signature?
    return thisWalletSigner.weight < accountThreshold
  })
}

/**
 * Checks remotely created transactions for potentially malicious content.
 *
 * Will return `true` if the transaction was created by an account not managed
 * by our local wallet, but containing operations that affect a locally
 * managed account (like sending funds from that local account).
 */
export function isPotentiallyDangerousTransaction(transaction: Transaction, trustedPublicKeys: string[]) {
  // check if there is a source account that is not trusted
  const dangerous = getAllSources(transaction).some(source => trustedPublicKeys.indexOf(source) === -1)
  return dangerous
}

export function isStellarWebAuthTransaction(transaction: Transaction) {
  const firstOperation = transaction.operations[0]

  return (
    String(transaction.sequence) === "0" &&
    firstOperation &&
    firstOperation.type === "manageData" &&
    firstOperation.name.match(/ auth$/i)
  )
}

export const DUST_THRESHOLD = BigNumber(0.01)

export function isDustTransaction(tx: Transaction, account: Account) {
  const paymentSummary = getPaymentSummary(account.accountID, tx)

  // not a payment
  if (paymentSummary.length === 0) return false

  // payment to self
  if (paymentSummary.every(payment => payment.publicKeys.every(pubkey => pubkey === account.accountID))) return false

  // native payment with dust amount
  return paymentSummary[0].asset.getCode() === "XLM" && paymentSummary[0].balanceChange.abs().lte(DUST_THRESHOLD)
}

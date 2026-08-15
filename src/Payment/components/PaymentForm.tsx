import { Box } from "@material-ui/core"
import ButtonBase from "@material-ui/core/ButtonBase"
import InputAdornment from "@material-ui/core/InputAdornment"
import TextField from "@material-ui/core/TextField"
import AccountBoxIcon from "@material-ui/icons/AccountBox"
import CloseIcon from "@material-ui/icons/Close"
import SendIcon from "@material-ui/icons/Send"
import { isStellarUri, parseStellarUri, PayStellarUri, StellarUriType } from "@suncewallet/stellar-uri"
import BigNumber from "big.js"
import { nanoid } from "nanoid"
import React from "react"
import { Controller, useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Asset, Memo, MemoType, Horizon, Transaction } from "@stellar/stellar-sdk"
import { Account } from "~App/contexts/accounts"
import { DialogsContext } from "~App/contexts/dialogs"
import { useSavedAddressesSyncOnMount } from "~App/contexts/savedAddresses"
import { warningColor } from "~App/theme"
import AssetSelector from "~Generic/components/AssetSelector"
import { ActionButton, DialogActionsBox } from "~Generic/components/DialogActions"
import { PriceInput, QRReader } from "~Generic/components/FormFields"
import Portal from "~Generic/components/Portal"
import { PublicKey } from "~Generic/components/PublicKey"
import { useDestinationResolver } from "~Generic/hooks/stellar"
import { AccountRecord, useWellKnownAccounts } from "~Generic/hooks/stellar-ecosystem"
import { RefStateObject, useIsMobile } from "~Generic/hooks/userinterface"
import { AccountData } from "~Generic/lib/account"
import { formatBalance } from "~Generic/lib/balances"
import { CustomError } from "~Generic/lib/errors"
import { FormBigNumber, isValidAmount, replaceCommaWithDot } from "~Generic/lib/form"
import { MultisigTransactionResponse, MultisigTransactionStatus } from "~Generic/lib/multisig-service"
import { findMatchingBalanceLine, getAccountMinimumBalance, getSpendableBalance } from "~Generic/lib/stellar"
import { RequiredMemo, ResolvedDestination } from "~Generic/lib/destination-resolver"
import { createPaymentOperation, createTransaction, multisigMinimumFee } from "~Generic/lib/transaction"
import { HorizontalLayout } from "~Layout/components/Box"

export interface PaymentParams {
  amount?: string
  asset?: Asset
  destination?: string
  memo?: string
  memoType?: MemoType
  payStellarUri?: PayStellarUri
}

export interface PaymentFormValues {
  amount: string
  asset: Asset
  destination: string
  memoValue: string
}

// Form values enriched with a resolved destination and optional required memo for transaction creation.
type ExtendedPaymentFormValues = PaymentFormValues & {
  memoType: MemoType
  requiredMemo?: RequiredMemo
  resolvedDestination?: string
}

// UI state for the latest asynchronous destination lookup.
interface DestinationResolution extends ResolvedDestination {
  value: string
}

interface MemoMetadata {
  label: string
  placeholder: string
  requiredType: MemoType | undefined
}

function createMemo(memoType: MemoType, memoValue: string) {
  switch (memoType) {
    case "id":
      return Memo.id(memoValue)
    case "text":
      return Memo.text(memoValue)
    default:
      return Memo.none()
  }
}

interface PaymentFormProps {
  accountData: AccountData
  actionsRef: RefStateObject
  onCancel?: () => void
  onSubmit: (
    formValues: ExtendedPaymentFormValues,
    spendableBalance: BigNumber,
    wellknownAccount?: AccountRecord
  ) => void
  preselectedParams?: PaymentParams
  canChangePreselectedParams?: boolean
  testnet: boolean
  trustedAssets: Asset[]
  txCreationPending?: boolean
}

const PaymentForm = React.memo(function PaymentForm(props: PaymentFormProps) {
  const isSmallScreen = useIsMobile()
  const formID = React.useMemo(() => nanoid(), [])
  const { t } = useTranslation()
  const wellknownAccounts = useWellKnownAccounts(props.testnet)
  useSavedAddressesSyncOnMount()
  const { isValidDestination, needsResolution, resolveDestination: resolveDestinationValue } = useDestinationResolver()

  const [matchingWellknownAccount, setMatchingWellknownAccount] = React.useState<AccountRecord | undefined>(undefined)
  const [destinationResolution, setDestinationResolution] = React.useState<DestinationResolution | undefined>(undefined)
  const [isDestinationResolutionPending, setIsDestinationResolutionPending] = React.useState(false)
  const destinationRequestRef = React.useRef(0)
  const destinationDebounceRef = React.useRef<number | undefined>(undefined)
  const preselectedDestinationResolvedRef = React.useRef<string | undefined>(undefined)
  const [memoType, setMemoType] = React.useState<MemoType>("none")
  const [memoMetadata, setMemoMetadata] = React.useState<MemoMetadata>({
    label: t("payment.memo-metadata.label.default"),
    placeholder: t("payment.memo-metadata.placeholder.optional"),
    requiredType: undefined
  })
  const form = useForm<PaymentFormValues>({
    defaultValues: {
      amount: "",
      asset: undefined,
      destination: "",
      memoValue: ""
    }
  })

  const formValues = form.watch()
  const { preselectedParams } = props
  const { setValue } = form

  const resolveDestination = React.useCallback(
    async (value: string) => {
      destinationRequestRef.current += 1
      const requestID = destinationRequestRef.current
      if (destinationDebounceRef.current) {
        window.clearTimeout(destinationDebounceRef.current)
      }

      setDestinationResolution(undefined)

      if (!isValidDestination(value)) {
        setIsDestinationResolutionPending(false)
        form.setError(
          "destination",
          "validate",
          t<string>(value.length === 0 ? "payment.validation.no-destination" : "payment.validation.invalid-destination")
        )
        return
      }

      form.clearError("destination")
      if (!needsResolution(value)) {
        setIsDestinationResolutionPending(false)
        return
      }

      setIsDestinationResolutionPending(true)
      destinationDebounceRef.current = window.setTimeout(async () => {
        try {
          const resolution = await resolveDestinationValue(value)
          if (requestID !== destinationRequestRef.current) return

          setDestinationResolution({ ...resolution, value })
          form.clearError("destination")
        } catch (error) {
          if (requestID !== destinationRequestRef.current) return
          setDestinationResolution(undefined)
          form.setError("destination", "resolve", t<string>("payment.validation.invalid-destination"))
        } finally {
          if (requestID === destinationRequestRef.current) {
            setIsDestinationResolutionPending(false)
          }
        }
      }, 350)
    },
    [form, isValidDestination, needsResolution, resolveDestinationValue, t]
  )

  const updateDestination = React.useCallback(
    (value: string) => {
      setValue("destination", value)
      void resolveDestination(value)
    },
    [resolveDestination, setValue]
  )

  React.useEffect(() => {
    return () => {
      destinationRequestRef.current += 1
      if (destinationDebounceRef.current) {
        window.clearTimeout(destinationDebounceRef.current)
      }
    }
  }, [])

  React.useEffect(() => {
    const destination = preselectedParams?.destination
    if (destination && preselectedDestinationResolvedRef.current !== destination) {
      preselectedDestinationResolvedRef.current = destination
      void resolveDestination(destination)
    }
  }, [preselectedParams, resolveDestination])

  const spendableBalance = getSpendableBalance(
    getAccountMinimumBalance(props.accountData),
    findMatchingBalanceLine(props.accountData.balances, formValues.asset)
  )

  React.useEffect(() => {
    if (!preselectedParams) return

    if (preselectedParams.amount) setValue("amount", preselectedParams.amount)
    if (preselectedParams.asset) setValue("asset", preselectedParams.asset)
    if (preselectedParams.destination) setValue("destination", preselectedParams.destination)
    if (preselectedParams.memo) setValue("memoValue", preselectedParams.memo)
  }, [preselectedParams, setValue])

  React.useEffect(() => {
    if (!isValidDestination(formValues.destination)) {
      if (matchingWellknownAccount) {
        setMatchingWellknownAccount(undefined)
      }
      return
    }

    const knownAccount = wellknownAccounts.lookup(formValues.destination)
    setMatchingWellknownAccount(knownAccount)

    if (preselectedParams && preselectedParams.memo && preselectedParams.memoType) {
      setMemoType(preselectedParams.memoType)
      setMemoMetadata({
        label:
          preselectedParams.memoType === "id"
            ? t("payment.memo-metadata.label.id")
            : t("payment.memo-metadata.label.text"),
        placeholder: t("payment.memo-metadata.placeholder.mandatory"),
        requiredType: preselectedParams.memoType
      })
    } else if (knownAccount && knownAccount.tags.indexOf("exchange") !== -1) {
      const acceptedMemoType = knownAccount.accepts && knownAccount.accepts.memo
      const requiredType = acceptedMemoType === "MEMO_ID" ? "id" : "text"
      setMemoType(requiredType)
      setMemoMetadata({
        label:
          acceptedMemoType === "MEMO_ID" ? t("payment.memo-metadata.label.id") : t("payment.memo-metadata.label.text"),
        placeholder: t("payment.memo-metadata.placeholder.mandatory"),
        requiredType
      })
    } else {
      setMemoType(formValues.memoValue.length === 0 ? "none" : "text")
      setMemoMetadata({
        label: t("payment.memo-metadata.label.default"),
        placeholder: t("payment.memo-metadata.placeholder.optional"),
        requiredType: undefined
      })
    }
  }, [
    formValues.destination,
    formValues.memoValue,
    isValidDestination,
    matchingWellknownAccount,
    memoType,
    preselectedParams,
    t,
    wellknownAccounts
  ])

  const handleFormSubmission = () => {
    const values = form.getValues()
    const needsDestinationResolution = needsResolution(values.destination)
    const resolution = destinationResolution?.value === values.destination ? destinationResolution : undefined

    if (needsDestinationResolution && !resolution) {
      form.setError("destination", "resolve", t<string>("payment.validation.invalid-destination"))
      return
    }

    props.onSubmit(
      {
        memoType,
        ...values,
        requiredMemo: resolution?.requiredMemo,
        resolvedDestination: resolution?.destination
      },
      spendableBalance,
      matchingWellknownAccount
    )
  }

  const handlePaymentLink = React.useCallback((uri: PayStellarUri) => {
    updateDestination(uri.destination)

    if (uri.amount) {
      setValue("amount", uri.amount)
    }

    if (uri.assetCode && uri.assetIssuer) {
      setValue("asset", new Asset(uri.assetCode, uri.assetIssuer))
    }

    if (uri.memo) {
      setMemoType(uri.memoType || "text")
      setValue("memoValue", uri.memo)
    }
  }, [setValue, updateDestination])

  const handleQRScan = React.useCallback(
    (scanResult: string) => {
      // handle SEP-07 Pay uri
      if (isStellarUri(scanResult)) {
        const stellarUri = parseStellarUri(scanResult)
        if (stellarUri.operation === StellarUriType.Pay) {
          handlePaymentLink(stellarUri as PayStellarUri)
        }
        form.triggerValidation()
        return
      }

      const [destination, query] = scanResult.split("?")

      // handle plain address or Kraken-style uri (<destination>?dt=<memoid>)
      if (isValidDestination(destination)) {
        updateDestination(destination)

        if (!query) {
          return
        }

        const searchParams = new URLSearchParams(query)
        const memoValue = searchParams.get("dt")

        if (memoValue) {
          setMemoType("id")
          setValue("memoValue", memoValue)
        }
      }
    },
    [form, isValidDestination, setValue, updateDestination]
  )

  const { openSavedAddresses } = React.useContext(DialogsContext)

  const handleOnSavedAddressClick = React.useCallback(
    (address: string) => {
      updateDestination(address)
      openSavedAddresses(null)
    },
    [form, updateDestination]
  )

  const handleContractListClick = React.useCallback(() => {
    openSavedAddresses({
      onSelect: handleOnSavedAddressClick
    })
  }, [])

  const qrReaderAdornment = React.useMemo(
    () => (
      <InputAdornment disableTypography position="end">
        <QRReader onScan={handleQRScan} />
        <AccountBoxIcon onClick={handleContractListClick} style={{ cursor: "pointer" }} />
      </InputAdornment>
    ),
    [handleQRScan, handleContractListClick]
  )

  const focused = React.useMemo(() => {
    if (!preselectedParams || !preselectedParams.destination) return "destination"
    if (!preselectedParams.amount) return "amount"
    if (!preselectedParams.asset) return "asset"
    if (!preselectedParams.memo) return "memo"
    return "destination"
  }, [preselectedParams])

  const destinationInput = React.useMemo(
    () => (
      <TextField
        autoFocus={import.meta.env.VITE_PLATFORM !== "ios" && focused === "destination"}
        disabled={!props.canChangePreselectedParams}
        error={Boolean(form.errors.destination)}
        fullWidth
        inputProps={{
          style: { textOverflow: "ellipsis" }
        }}
        InputProps={{
          endAdornment: !Boolean(preselectedParams?.destination) ? qrReaderAdornment : undefined
        }}
        inputRef={form.register({
          required: t<string>("payment.validation.no-destination"),
          validate: (value) =>
            isValidDestination(value) ||
            t<string>("payment.validation.invalid-destination")
        })}
        helperText={
          form.errors.destination
            ? "\u00a0"
            : isDestinationResolutionPending
              ? t("generic.status.fetching-address")
              : destinationResolution?.value === formValues.destination
                ? <PublicKey publicKey={destinationResolution.destination} showRaw style={{ lineHeight: "inherit" }} testnet={props.testnet} variant="shorter" />
                : "\u00a0"
        }
        label={form.errors.destination ? form.errors.destination.message : t("payment.inputs.destination.label")}
        margin="normal"
        name="destination"
        onChange={(event) => updateDestination(event.target.value.trim())}
        placeholder={t("payment.inputs.destination.placeholder")}
      />
    ),
    [
      destinationResolution,
      form,
      focused,
      formValues.destination,
      isDestinationResolutionPending,
      isValidDestination,
      preselectedParams,
      qrReaderAdornment,
      t,
      updateDestination
    ]
  )

  const assetSelector = React.useMemo(
    () => (
      <Controller
        as={
          <AssetSelector
            autoFocus={import.meta.env.VITE_PLATFORM !== "ios" && focused === "asset"}
            assets={props.accountData.balances}
            disableUnderline
            disabled={!props.canChangePreselectedParams && !!preselectedParams?.asset}
            showXLM
            style={{ alignSelf: "center" }}
            testnet={props.testnet}
            value={formValues.asset || undefined}
            accountId={props.accountData.account_id}
          />
        }
        control={form.control}
        name="asset"
      />
    ),
    [form, focused, formValues.asset, preselectedParams, props.accountData.balances, props.testnet]
  )

  const maxSendButton = React.useMemo(
    () => (
      <ButtonBase
        onClick={() => {
          form.setValue("amount", spendableBalance.toString())
          form.triggerValidation("amount")
        }}
        style={{ fontSize: "inherit", fontWeight: "inherit", textAlign: "inherit" }}
      >
        {t("payment.inputs.price.placeholder", { amount: formatBalance(spendableBalance.toString()) })}
      </ButtonBase>
    ),
    [form, spendableBalance, t]
  )

  const isOwnAsset = React.useMemo(
    () => form.getValues()["asset"]?.getIssuer() === props.accountData.account_id,
    [form, props.accountData]
  )

  const priceInputHelperText = React.useMemo(() => {
    if (!form.getValues()["asset"] || isOwnAsset) return <span></span>
    return maxSendButton
  }, [form, isOwnAsset])

  const priceInput = React.useMemo(
    () => (
      <PriceInput
        autoFocus={import.meta.env.VITE_PLATFORM !== "ios" && focused === "amount"}
        assetCode={assetSelector}
        disabled={!props.canChangePreselectedParams && !!preselectedParams?.amount}
        error={Boolean(form.errors.amount)}
        inputRef={form.register({
          required: t<string>("payment.validation.no-price"),
          validate: (value) => {
            if (!form.getValues()["asset"]) {
              return t<string>("payment.validation.asset-missing")
            }
            if (!isValidAmount(value) || FormBigNumber(value).eq(0)) {
              return t<string>("payment.validation.invalid-price")
            } else if (!isOwnAsset && FormBigNumber(value).gt(spendableBalance)) {
              return t<string>("payment.validation.not-enough-funds")
            } else {
              return undefined
            }
          }
        })}
        label={form.errors.amount ? form.errors.amount.message : t("payment.inputs.price.label")}
        margin="normal"
        name="amount"
        placeholder={t("payment.inputs.price.label")}
        helperText={priceInputHelperText}
        style={{
          flexGrow: isSmallScreen ? 1 : undefined,
          marginLeft: 24,
          marginRight: 24,
          minWidth: 230,
          maxWidth: isSmallScreen ? undefined : "60%"
        }}
      />
    ),
    [assetSelector, focused, form, isSmallScreen, preselectedParams, spendableBalance, t]
  )

  const memoInput = React.useMemo(
    () => (
      <TextField
        autoFocus={import.meta.env.VITE_PLATFORM !== "ios" && focused === "memo"}
        disabled={!props.canChangePreselectedParams && !!preselectedParams?.memo}
        error={Boolean(form.errors.memoValue)}
        inputProps={{ maxLength: 28 }}
        label={form.errors.memoValue ? form.errors.memoValue.message : memoMetadata.label}
        margin="normal"
        name="memoValue"
        inputRef={form.register({
          validate: {
            length: (value) => value.length <= 28 || t<string>("payment.validation.memo-too-long"),
            memoRequired: (value) =>
              !memoMetadata.requiredType ||
              !matchingWellknownAccount ||
              value.length > 0 ||
              t<string>(
                "payment.validation.memo-required",
                `Set a memo when sending funds to ${matchingWellknownAccount.name}`,
                {
                  destination: matchingWellknownAccount.name
                }
              ),
            idPattern: (value) =>
              memoType !== "id" || value.match(/^[0-9]+$/) || t<string>("payment.validation.integer-memo-required")
          }
        })}
        onChange={(event) => {
          const { value } = event.target
          if (!memoMetadata.requiredType) {
            // only change memo type if no type is required
            const newMemoType = value.length === 0 ? "none" : "text"
            setMemoType(newMemoType)
          }
          setValue("memoValue", value)
        }}
        placeholder={memoMetadata.placeholder}
        style={{
          flexGrow: 1,
          marginLeft: 24,
          marginRight: 24,
          minWidth: 230
        }}
      />
    ),
    [
      form,
      memoType,
      matchingWellknownAccount,
      memoMetadata.label,
      memoMetadata.placeholder,
      memoMetadata.requiredType,
      preselectedParams,
      setValue,
      t
    ]
  )

  const dialogActions = React.useMemo(
    () => (
      <DialogActionsBox desktopStyle={{ marginTop: 64 }}>
        {props.onCancel && (
          <ActionButton icon={<CloseIcon style={{ fontSize: 16 }} />} onClick={props.onCancel}>
            {t("payment.actions.dismiss")}
          </ActionButton>
        )}
        <ActionButton
          form={formID}
          icon={<SendIcon style={{ fontSize: 16 }} />}
          loading={props.txCreationPending}
          onClick={() => undefined}
          type="submit"
        >
          {t("payment.actions.submit")}
        </ActionButton>
      </DialogActionsBox>
    ),
    [formID, isOwnAsset, props.onCancel, props.txCreationPending, t]
  )

  return (
    <>
      <form id={formID} onSubmit={form.handleSubmit(handleFormSubmission)}>
        {destinationInput}
        <HorizontalLayout justifyContent="space-between" alignItems="top" margin="0 -24px" wrap="wrap">
          {priceInput}
          {memoInput}
        </HorizontalLayout>
        {isOwnAsset && (
          <Box margin="32px 0 0" padding="8px 12px" style={{ background: warningColor }}>
            {t("payment.note.issuance")}
          </Box>
        )}
        <Portal target={props.actionsRef.element}>{dialogActions}</Portal>
      </form>
    </>
  )
})

interface Props {
  accountData: AccountData
  actionsRef: RefStateObject
  preselectedParams?: PaymentParams
  canChangePreselectedParams?: boolean
  testnet: boolean
  trustedAssets: Asset[]
  txCreationPending?: boolean
  onCancel?: () => void
  onSubmit: (
    createTx: (
      horizon: Horizon.Server,
      account: Account
    ) => Promise<{
      tx: Transaction
      signatureRequest?: MultisigTransactionResponse
    }>
  ) => any
}

function PaymentFormContainer(props: Props) {
  const createPaymentTx = async (horizon: Horizon.Server, account: Account, formValues: ExtendedPaymentFormValues) => {
    const asset = props.trustedAssets.find((trustedAsset) => trustedAsset.equals(formValues.asset))
    const destination = formValues.resolvedDestination || formValues.destination

    const userMemo = createMemo(formValues.memoType, formValues.memoValue)
    const resolvedMemo =
      formValues.requiredMemo
        ? new Memo(formValues.requiredMemo.type, formValues.requiredMemo.value)
        : Memo.none()

    if (userMemo.type !== "none" && resolvedMemo.type !== "none") {
      throw CustomError(
        "MemoAlreadySpecifiedError",
        `Cannot set a custom memo. Resolved destination of ${formValues.destination} already specifies memo.`,
        { destination: formValues.destination }
      )
    }

    const isMultisigTx = props.accountData.signers.length > 1

    const payment = await createPaymentOperation({
      asset: asset || Asset.native(),
      amount: replaceCommaWithDot(formValues.amount),
      destination,
      horizon
    })
    return createTransaction([payment], {
      accountData: props.accountData,
      memo: resolvedMemo.type !== "none" ? resolvedMemo : userMemo,
      minTransactionFee: isMultisigTx ? multisigMinimumFee : 0,
      horizon,
      walletAccount: account
    })
  }

  const submitForm = (formValues: ExtendedPaymentFormValues) => {
    props.onSubmit(async (horizon, account) => {
      const tx = await createPaymentTx(horizon, account, formValues)
      if (props.preselectedParams?.payStellarUri?.callback) {
        const signatureRequest: MultisigTransactionResponse = {
          created_at: Date.now().toString(),
          cursor: "",
          hash: tx.toXDR(),
          req: props.preselectedParams?.payStellarUri.toString(),
          status: MultisigTransactionStatus.pending,
          signed_by: [],
          signers: [],
          updated_at: Date.now().toString(),
          external: true
        }
        return {
          tx,
          signatureRequest
        }
      } else {
        return { tx }
      }
    })
  }

  return <PaymentForm {...props} onSubmit={submitForm} />
}

export default React.memo(PaymentFormContainer)

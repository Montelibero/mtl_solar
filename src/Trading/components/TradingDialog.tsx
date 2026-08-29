import React from "react"
import { useTranslation } from "react-i18next"
import { Asset, Horizon } from "@stellar/stellar-sdk"
import Box from "@material-ui/core/Box"
import Tab from "@material-ui/core/Tab"
import Tabs from "@material-ui/core/Tabs"
import Typography from "@material-ui/core/Typography"
import { Account } from "~App/contexts/accounts"
import * as routes from "~App/routes"
import { ActionButton, DialogActionsBox } from "~Generic/components/DialogActions"
import { InlineErrorBoundary } from "~Generic/components/ErrorBoundaries"
import MainTitle from "~Generic/components/MainTitle"
import Portal from "~Generic/components/Portal"
import ScrollableBalances from "~Generic/components/ScrollableBalances"
import TestnetBadge from "~Generic/components/TestnetBadge"
import ViewLoading from "~Generic/components/ViewLoading"
import { useLiveAccountData } from "~Generic/hooks/stellar-subscriptions"
import { useDialogActions, useIsMobile, useRouter } from "~Generic/hooks/userinterface"
import { matchesRoute } from "~Generic/lib/routes"
import { parseAssetID, stringifyAsset } from "~Generic/lib/stellar"
import { getLastArgumentFromURL } from "~Generic/lib/url"
import DialogBody from "~Layout/components/DialogBody"
import { HorizontalLayout, VerticalLayout } from "~Layout/components/Box"
import TransactionSender, { SendTransaction } from "~Transaction/components/TransactionSender"
import OfferList, { getOfferEditorState, type OfferEditorState } from "~Account/components/OfferList"
import SwapForm from "./SwapForm"
import TradingForm from "./TradingForm"

type TradeMode = routes.TradeMethod

interface TradingDialogProps {
  account: Account
  onClose: () => void
  sendTransaction: SendTransaction
}

function getAssetFromPath(pathname: string) {
  if (matchesRoute(pathname, routes.tradeAsset("*", undefined, "*"))) {
    const lastArgument = getLastArgumentFromURL(pathname)
    if (lastArgument !== "buy" && lastArgument !== "sell" && lastArgument !== "swap" && lastArgument !== "orders") {
      return parseAssetID(lastArgument)
    }
  }
  return undefined
}

function getTradeMode(pathname: string): TradeMode {
  if (matchesRoute(pathname, routes.tradeAsset("*", "buy"))) return "buy"
  if (matchesRoute(pathname, routes.tradeAsset("*", "sell"))) return "sell"
  if (matchesRoute(pathname, routes.tradeAsset("*", "orders"))) return "orders"
  return "swap"
}

function TradingDialog(props: TradingDialogProps) {
  const accountData = useLiveAccountData(props.account.accountID, props.account.testnet)
  const dialogActionsRef = useDialogActions()
  const router = useRouter()
  const isMobile = useIsMobile()
  const [editOffer, setEditOffer] = React.useState<OfferEditorState | undefined>()
  const [preselectedAsset, setPreselectedAsset] = React.useState<Asset | undefined>()
  const { t } = useTranslation()

  React.useEffect(() => {
    const asset = getAssetFromPath(router.location.pathname)
    setPreselectedAsset(asset)
  }, [router.location.pathname])

  const trustlines = React.useMemo(
    () =>
      accountData.balances.filter((balance): balance is Horizon.HorizonApi.BalanceLineAsset => balance.asset_type !== "native"),
    [accountData.balances]
  )

  const tradeMode = getTradeMode(router.location.pathname)

  const navigateToSwap = React.useCallback(() => {
    setEditOffer(undefined)
    router.history.push(
      routes.tradeAsset(props.account.id, "swap", preselectedAsset ? stringifyAsset(preselectedAsset) : undefined)
    )
  }, [preselectedAsset, props.account, router.history])

  const navigateToOrders = React.useCallback(() => {
    setEditOffer(undefined)
    router.history.push(routes.tradeAsset(props.account.id, "orders"))
  }, [props.account, router.history])

  const selectTradeMode = React.useCallback(
    (mode: TradeMode) => {
      setEditOffer(undefined)
      router.history.push(
        routes.tradeAsset(props.account.id, mode, preselectedAsset ? stringifyAsset(preselectedAsset) : undefined)
      )
    },
    [preselectedAsset, props.account, router.history]
  )

  const selectOffer = React.useCallback(
    (offer: Horizon.ServerApi.OfferRecord) => {
      const editorState = getOfferEditorState(props.account.accountID, offer)
      setEditOffer(editorState)
      router.history.push(
        routes.tradeAsset(props.account.id, editorState.primaryAction, stringifyAsset(editorState.primaryAsset))
      )
    },
    [props.account, router.history]
  )

  const ModeSelector = React.useMemo(
    () => (
      <HorizontalLayout justifyContent="center" margin="16px 0 0">
        <Box maxWidth={isMobile ? 500 : 640} width="100%">
          <Tabs
            aria-label={t<string>("trading.title")}
            centered={!isMobile}
            indicatorColor="primary"
            onChange={(_, mode: TradeMode) => selectTradeMode(mode)}
            textColor="inherit"
            value={tradeMode}
            variant={isMobile ? "fullWidth" : "standard"}
          >
            <Tab label={t("trading.action-selection.swap.label")} value="swap" />
            <Tab label={t("trading.action-selection.buy.label-short")} value="buy" />
            <Tab label={t("trading.action-selection.sell.label-short")} value="sell" />
            <Tab label={t("trading.action-selection.orders.label")} value="orders" />
          </Tabs>
        </Box>
      </HorizontalLayout>
    ),
    [isMobile, selectTradeMode, t, tradeMode]
  )

  const MainContent = React.useMemo(
    () => (
      <VerticalLayout>
        {ModeSelector}
        <React.Suspense fallback={<ViewLoading />}>
          {tradeMode === "orders" ? (
            <Box margin="24px 0 0">
              <OfferList
                account={props.account}
                onSelectOffer={selectOffer}
                title={t("account.transactions.offer-list.title")}
              />
            </Box>
          ) : tradeMode === "swap" ? (
            <SwapForm
              account={props.account}
              accountData={accountData}
              dialogActionsRef={dialogActionsRef}
              initialSourceAsset={preselectedAsset}
              sendTransaction={props.sendTransaction}
            />
          ) : (
            <TradingForm
              key={`${tradeMode}-${editOffer?.offerId || "new"}`}
              account={props.account}
              accountData={accountData}
              dialogActionsRef={dialogActionsRef}
              editOffer={editOffer}
              initialPrimaryAsset={preselectedAsset}
              primaryAction={tradeMode}
              sendTransaction={props.sendTransaction}
              trustlines={trustlines}
            />
          )}
        </React.Suspense>
      </VerticalLayout>
    ),
    [
      ModeSelector,
      accountData,
      dialogActionsRef,
      editOffer,
      preselectedAsset,
      props.account,
      props.sendTransaction,
      selectOffer,
      t,
      tradeMode,
      trustlines
    ]
  )

  const LinkToManageAssets = React.useMemo(
    () => (
      <Box margin="32px 0 0" textAlign="center">
        <Typography>{t("trading.no-assets-info")}</Typography>
        <Portal target={dialogActionsRef.element}>
          <DialogActionsBox>
            <ActionButton
              autoFocus
              onClick={() => router.history.push(routes.manageAccountAssets(props.account.id))}
              type="primary"
            >
              {t("trading.action.add-asset")}
            </ActionButton>
          </DialogActionsBox>
        </Portal>
      </Box>
    ),
    [dialogActionsRef, props.account, router, t]
  )

  return (
    <DialogBody
      top={
        <>
          <MainTitle
            title={
              <span>
                {t("trading.title")}
                {props.account.testnet ? <TestnetBadge style={{ marginLeft: 8 }} /> : null}
              </span>
            }
            onBack={
              editOffer
                ? navigateToOrders
                : tradeMode === "buy" || tradeMode === "sell" || tradeMode === "orders"
                ? navigateToSwap
                : props.onClose
            }
          />
          <ScrollableBalances account={props.account} compact />
        </>
      }
      actions={dialogActionsRef}
      actionsPosition={tradeMode === "orders" ? undefined : "bottom"}
    >
      <InlineErrorBoundary>{trustlines.length > 0 ? MainContent : LinkToManageAssets}</InlineErrorBoundary>
    </DialogBody>
  )
}

function TradingDialogContainer(props: Pick<TradingDialogProps, "account" | "onClose">) {
  const router = useRouter()
  const navigateToAccount = () => router.history.push(routes.account(props.account.id))

  return (
    <TransactionSender account={props.account} onSubmissionCompleted={navigateToAccount}>
      {({ sendTransaction }) => <TradingDialog {...props} sendTransaction={sendTransaction} />}
    </TransactionSender>
  )
}

export default TradingDialogContainer

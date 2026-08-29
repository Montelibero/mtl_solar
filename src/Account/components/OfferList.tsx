import BigNumber from "big.js"
import React from "react"
import { Trans, useTranslation } from "react-i18next"
import { Asset, Operation, Horizon, Transaction } from "@stellar/stellar-sdk"
import ListItem from "@material-ui/core/ListItem"
import ListItemIcon from "@material-ui/core/ListItemIcon"
import ListItemText from "@material-ui/core/ListItemText"
import ArrowRightIcon from "@material-ui/icons/ArrowRightAlt"
import BarChartIcon from "@material-ui/icons/BarChart"
import { Account } from "~App/contexts/accounts"
import { trackError } from "~App/contexts/notifications"
import { ActionButton } from "~Generic/components/DialogActions"
import { useHorizon } from "~Generic/hooks/stellar"
import { useLoadingState } from "~Generic/hooks/util"
import { useLiveAccountData, useLiveAccountOffers, useOlderOffers } from "~Generic/hooks/stellar-subscriptions"
import { useIsMobile } from "~Generic/hooks/userinterface"
import { AccountData } from "~Generic/lib/account"
import { horizonAssetToAsset } from "~Generic/lib/stellar"
import { createTransaction } from "~Generic/lib/transaction"
import { HorizontalLayout } from "~Layout/components/Box"
import { List } from "~Layout/components/List"
import TransactionSender from "~Transaction/components/TransactionSender"
import { SingleBalance } from "./AccountBalances"

export interface OfferEditorState {
  offerId: string | number
  price: string
  primaryAction: "buy" | "sell"
  primaryAmountString: string
  primaryAsset: Asset
  secondaryAsset: Asset
}

export function getOfferEditorState(accountPublicKey: string, offer: Horizon.ServerApi.OfferRecord): OfferEditorState {
  const buying = horizonAssetToAsset(offer.buying)
  const selling = horizonAssetToAsset(offer.selling)

  if (offer.seller === accountPublicKey && !selling.isNative()) {
    return {
      offerId: offer.id,
      price: offer.price,
      primaryAction: "sell",
      primaryAmountString: offer.amount,
      primaryAsset: selling,
      secondaryAsset: buying
    }
  }

  return {
    offerId: offer.id,
    price: offer.price,
    primaryAction: "buy",
    primaryAmountString: String(BigNumber(offer.amount).mul(offer.price)),
    primaryAsset: buying,
    secondaryAsset: selling
  }
}

function createDismissalTransaction(
  horizon: Horizon.Server,
  account: Account,
  accountData: AccountData,
  offer: Horizon.ServerApi.OfferRecord
): Promise<Transaction> {
  const buying = horizonAssetToAsset(offer.buying)
  const selling = horizonAssetToAsset(offer.selling)

  return selling.isNative()
    ? createTransaction(
        [
          Operation.manageBuyOffer({
            offerId: offer.id,
            buyAmount: "0",
            buying,
            price: offer.price,
            selling,
          })
        ],
        { accountData, horizon, walletAccount: account }
      )
    : createTransaction(
        [
          Operation.manageSellOffer({
            offerId: offer.id,
            amount: "0",
            buying,
            price: offer.price,
            selling,
          })
        ],
        { accountData, horizon, walletAccount: account }
      )
}

interface OfferListItemProps {
  accountPublicKey: string
  offer: Horizon.ServerApi.OfferRecord
  onSelect?: () => void
  style?: React.CSSProperties
}

const OfferListItem = React.memo(function OfferListItem(props: OfferListItemProps) {
  const buying = horizonAssetToAsset(props.offer.buying)
  const selling = horizonAssetToAsset(props.offer.selling)
  const isSmallScreen = useIsMobile()
  return (
    <ListItem
      button={Boolean(props.onSelect) as any}
      onClick={props.onSelect}
      style={{ minHeight: isSmallScreen ? 58 : 72, ...props.style }}
    >
      <ListItemIcon style={{ marginRight: isSmallScreen ? 0 : undefined }}>
        <BarChartIcon />
      </ListItemIcon>
      <ListItemText
        primary={
          // Horizon seems to always returns open offers in the format of us
          // on the seller side, no matter if we submitted a buy or sell order,
          // so we use the philosophy "i never 'sell XLM', 'i buy the <other asset>'"
          props.offer.seller === props.accountPublicKey && !selling.isNative() ? (
            <span style={{ fontWeight: "bold" }}>
              <Trans i18nKey="account.transactions.offer-list.text.sell">
                Sell
                <SingleBalance
                  assetCode={selling.getCode()}
                  balance={props.offer.amount}
                  inline
                  style={{ marginLeft: "0.35em", marginRight: "0.35em" }}
                />
                for
                <SingleBalance
                  assetCode={buying.getCode()}
                  balance={String(BigNumber(props.offer.amount).mul(props.offer.price))}
                  inline
                  style={{ marginLeft: "0.35em", marginRight: "0.35em" }}
                />
              </Trans>
            </span>
          ) : (
            <span style={{ fontWeight: "bold" }}>
              <Trans i18nKey="account.transactions.offer-list.text.buy">
                Buy
                <SingleBalance
                  assetCode={buying.getCode()}
                  balance={String(BigNumber(props.offer.amount).mul(props.offer.price))}
                  inline
                  style={{ marginLeft: "0.35em", marginRight: "0.35em" }}
                />
                for
                <SingleBalance
                  assetCode={selling.getCode()}
                  balance={props.offer.amount}
                  inline
                  style={{ marginLeft: "0.35em", marginRight: "0.35em" }}
                />
              </Trans>
            </span>
          )
        }
        primaryTypographyProps={{
          style: { overflow: "hidden", textOverflow: "ellipsis" }
        }}
        style={{ paddingRight: isSmallScreen ? 0 : undefined }}
      />
      <ListItemText
        primaryTypographyProps={{ align: "right" }}
        style={{ display: isSmallScreen ? "none" : undefined, flexShrink: 0, paddingRight: 0 }}
      >
        <HorizontalLayout alignItems="center" inline style={{ fontSize: "1.4rem" }}>
          <b>{selling.getCode()}</b>
          &nbsp;
          <ArrowRightIcon style={{ fontSize: "150%" }} />
          &nbsp;
          <b>{buying.getCode()}</b>
        </HorizontalLayout>
      </ListItemText>
    </ListItem>
  )
})

interface LoadMoreOffersListItemProps {
  onClick: () => void
  pending?: boolean
}

const LoadMoreOffersListItem = React.memo(function LoadMoreOffersListItem(props: LoadMoreOffersListItemProps) {
  const { t } = useTranslation()
  return (
    <ListItem style={{ borderBottom: "none", height: 75 }}>
      <ListItemText disableTypography style={{ textAlign: "center" }}>
        <ActionButton
          onClick={props.onClick}
          loading={props.pending}
          style={{ margin: "0 auto", paddingLeft: 16, paddingRight: 16 }}
          variant="text"
        >
          {t("account.transactions.transaction-list.load-more.label")}
        </ActionButton>
      </ListItemText>
    </ListItem>
  )
})

interface Props {
  account: Account
  onSelectOffer?: (offer: Horizon.ServerApi.OfferRecord) => void
  title: React.ReactNode
}

function OfferList(props: Props & { sendTransaction: (tx: Transaction) => Promise<void> }) {
  const accountData = useLiveAccountData(props.account.accountID, props.account.testnet)
  const horizon = useHorizon(props.account.testnet)
  const offerHistory = useLiveAccountOffers(props.account.accountID, props.account.testnet)
  const [moreTxsLoadingState, handleMoreTxsFetch] = useLoadingState()
  const fetchMoreOffers = useOlderOffers(props.account.accountID, props.account.testnet)

  const handleFetchMoreOffers = React.useCallback(() => handleMoreTxsFetch(fetchMoreOffers()), [
    fetchMoreOffers,
    handleMoreTxsFetch
  ])

  const onCancel = async (offer: Horizon.ServerApi.OfferRecord) => {
    try {
      const tx = await createDismissalTransaction(horizon, props.account, accountData, offer)
      await props.sendTransaction(tx)
    } catch (error) {
      trackError(error)
    }
  }

  return offerHistory.offers.length === 0 ? null : (
    <List style={{ background: "transparent" }}>
      {offerHistory.offers.map(offer => (
        <OfferListItem
          key={offer.id}
          accountPublicKey={props.account.accountID}
          offer={offer}
          onSelect={props.onSelectOffer ? () => props.onSelectOffer!(offer) : () => onCancel(offer)}
        />
      ))}
      {offerHistory.olderOffersAvailable ? (
        <LoadMoreOffersListItem pending={moreTxsLoadingState.type === "pending"} onClick={handleFetchMoreOffers} />
      ) : null}
    </List>
  )
}

function OfferListContainer(props: Props) {
  return (
    <TransactionSender account={props.account}>
      {({ sendTransaction }) => <OfferList {...props} sendTransaction={sendTransaction} />}
    </TransactionSender>
  )
}

export default OfferListContainer

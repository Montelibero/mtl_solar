import React from "react"
import AccountBalances from "../components/AccountBalances"

export default { title: "Balance" }
export const AccountBalanceActivatedExample = () => (
  <div>
    Current balance: <AccountBalances publicKey="GBPBFWVBADSESGADWEGC7SGTHE3535FWK4BS6UW3WMHX26PHGIH5NF4W" testnet />
  </div>
)
export const AccountBalanceUnactivatedExample = () => (
  <AccountBalances publicKey="GD52DFJ57XWSBCN3MZQ4Z2TO4TCVVP2UXVWCBSTCKDUYXVPGMSVKS4M5" testnet />
)

import React from "react"
import AccountSelectionList from "../components/AccountSelectionList"
import { Account } from "~App/contexts/accounts"

const accounts: Account[] = [
  {
    accountID: "GBPBFWVBADSESGADWEGC7SGTHE3535FWK4BS6UW3WMHX26PHGIH5NF4W",
    id: "testid1",
    name: "My Testnet Account #1",
    publicKey: "GBPBFWVBADSESGADWEGC7SGTHE3535FWK4BS6UW3WMHX26PHGIH5NF4W",
    requiresPassword: false,
    testnet: true,
    getPrivateKey: () => Promise.reject(Error("Just a mock.")),
    signTransaction: () => Promise.reject(Error("Just a mock."))
  },
  {
    accountID: "GDNVDG37WMKPEIXSJRBAQAVPO5WGOPKZRZZBPLWXULSX6NQNLNQP6CFF",
    id: "testid2",
    name: "My Testnet Account #2",
    publicKey: "GDNVDG37WMKPEIXSJRBAQAVPO5WGOPKZRZZBPLWXULSX6NQNLNQP6CFF",
    requiresPassword: false,
    testnet: true,
    getPrivateKey: () => Promise.reject(Error("Just a mock.")),
    signTransaction: () => Promise.reject(Error("Just a mock."))
  }
]

export default { title: "AccountSelection" }
export const AccountSelectionListExample = () => <AccountSelectionList testnet={true} accounts={accounts} />
export const AccountSelectionListDisabledExample = () => (
  <AccountSelectionList disabled={true} testnet={true} accounts={accounts} />
)

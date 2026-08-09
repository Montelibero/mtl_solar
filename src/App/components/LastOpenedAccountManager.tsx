import React from "react"
import { AccountsContext } from "~App/contexts/accounts"
import { SettingsContext } from "~App/contexts/settings"
import * as routes from "~App/routes"
import { useRouter } from "~Generic/hooks/userinterface"
import { matchesRoute } from "~Generic/lib/routes"

function LastOpenedAccountManager() {
  const { accounts, initialized: accountsInitialized } = React.useContext(AccountsContext)
  const { initialized: settingsInitialized, lastOpenedAccountID, setSetting } = React.useContext(SettingsContext)
  const router = useRouter()
  const startupResolved = React.useRef(false)

  React.useEffect(() => {
    if (!accountsInitialized || !settingsInitialized) {
      return
    }

    const pathname = router.location.pathname
    const isStartup = !startupResolved.current
    startupResolved.current = true

    if (isStartup && pathname === routes.allAccounts() && lastOpenedAccountID) {
      const savedAccount = accounts.find(candidate => candidate.id === lastOpenedAccountID)

      if (savedAccount) {
        router.history.replace(routes.account(savedAccount.id))
        return
      }
    }

    const activeAccount = accounts.find(candidate => matchesRoute(pathname, routes.account(candidate.id)))

    if (activeAccount && activeAccount.id !== lastOpenedAccountID) {
      setSetting("lastOpenedAccountID", activeAccount.id)
    } else if (!activeAccount && pathname === routes.allAccounts() && lastOpenedAccountID) {
      setSetting("lastOpenedAccountID", undefined)
    }
  }, [accounts, accountsInitialized, lastOpenedAccountID, router.history, router.location.pathname, setSetting, settingsInitialized])

  return null
}

export default React.memo(LastOpenedAccountManager)

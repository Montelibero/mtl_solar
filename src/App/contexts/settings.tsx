import React from "react"
import { useTranslation } from "react-i18next"
import { useForceRerender } from "~Generic/hooks/util"
import { testBiometricAuth, isBiometricAuthAvailable } from "~Platform/bio-auth"
import {
  loadIgnoredSignatureRequestHashes,
  loadSettings,
  saveIgnoredSignatureRequestHashes,
  saveSettings
} from "~Platform/settings"
import getUpdater from "~Platform/updater"
import { trackError } from "./notifications"

interface Props {
  children: React.ReactNode
}

interface ContextType {
  agreedToTermsAt: string | undefined
  biometricLock: boolean
  biometricAvailability: BiometricAvailability
  confirmToC: () => void
  customMainnetHorizonURL: string | undefined
  hideMemos: boolean
  ignoreSignatureRequest: (signatureRequestHash: string) => void
  ignoredSignatureRequests: string[]
  initialized: boolean
  language: string | undefined
  lastOpenedAccountID: string | undefined
  multiSignature: boolean
  multiSignatureCoordinator: string
  onlyCustomMainnetHorizon: boolean
  useCustomMainnetHorizon: boolean
  setLanguage: (language: string | undefined) => void
  setSetting: (key: keyof Platform.SettingsData, value: any) => void
  showTestnet: boolean
  showDust: boolean
  showClaimableBalanceTxs: boolean
  toggleBiometricLock: () => void
  toggleMultiSignature: () => void
  toggleTestnet: () => void
  toggleHideMemos: () => void
  toggleShowDust: () => void
  toggleShowClaimableBalanceTxs: () => void
  trustedServices: TrustedService[]
  updateAvailable: boolean
  accountAssetSettings: Platform.AccountAssetSettingsMap
  accountReceivePaymentSettings: Platform.AccountReceivePaymentSettingsMap
  showAllBalancesOnAccountCards: boolean
  savedAddressesSyncEnabled: boolean
  savedAddressesSyncApiKey: string | undefined
  setAssetSettings: (accountId: string, assetKey: string, mode: Platform.AssetSettings) => void
  setReceivePaymentSettings: (accountId: string, settings: Platform.ReceivePaymentSettings) => void
  toggleShowAllBalancesOnAccountCards: () => void
}

interface SettingsState extends Platform.SettingsData {
  initialized: boolean
}

const initialSettings: SettingsState = {
  agreedToTermsAt: undefined,
  biometricLock: false,
  customMainnetHorizonURL: undefined,
  hideMemos: false,
  initialized: false,
  multisignature: false,
  onlyCustomMainnetHorizon: false,
  useCustomMainnetHorizon: false,
  testnet: false,
  showDust: false,
  showClaimableBalanceTxs: false,
  trustedServices: [],
  accountAssetSettings: {},
  accountReceivePaymentSettings: {},
  showAllBalancesOnAccountCards: false,
  savedAddressesSyncEnabled: false,
  savedAddressesSyncApiKey: undefined
}

const initialIgnoredSignatureRequests: string[] = []

const multiSignatureCoordinator = import.meta.env.VITE_MULTISIG_SERVICE || "v1.multisig.sunce.app"

const SettingsContext = React.createContext<ContextType>({
  agreedToTermsAt: initialSettings.agreedToTermsAt,
  biometricLock: initialSettings.biometricLock,
  biometricAvailability: { available: false, enrolled: false },
  confirmToC: () => undefined,
  customMainnetHorizonURL: initialSettings.customMainnetHorizonURL,
  hideMemos: initialSettings.hideMemos,
  ignoreSignatureRequest: () => undefined,
  ignoredSignatureRequests: initialIgnoredSignatureRequests,
  initialized: false,
  language: undefined,
  lastOpenedAccountID: undefined,
  multiSignature: initialSettings.multisignature,
  multiSignatureCoordinator,
  onlyCustomMainnetHorizon: initialSettings.onlyCustomMainnetHorizon,
  useCustomMainnetHorizon: initialSettings.useCustomMainnetHorizon,
  setLanguage: () => undefined,
  setSetting: () => undefined,
  showDust: false,
  showClaimableBalanceTxs: false,
  showTestnet: initialSettings.testnet,
  toggleBiometricLock: () => undefined,
  toggleMultiSignature: () => undefined,
  toggleTestnet: () => undefined,
  toggleHideMemos: () => undefined,
  toggleShowDust: () => undefined,
  toggleShowClaimableBalanceTxs: () => undefined,
  trustedServices: initialSettings.trustedServices,
  updateAvailable: false,
  accountAssetSettings: initialSettings.accountAssetSettings,
  accountReceivePaymentSettings: initialSettings.accountReceivePaymentSettings,
  showAllBalancesOnAccountCards: initialSettings.showAllBalancesOnAccountCards,
  savedAddressesSyncEnabled: initialSettings.savedAddressesSyncEnabled || false,
  savedAddressesSyncApiKey: initialSettings.savedAddressesSyncApiKey,
  setAssetSettings: () => undefined,
  setReceivePaymentSettings: () => undefined,
  toggleShowAllBalancesOnAccountCards: () => undefined
})

export function SettingsProvider(props: Props) {
  const [ignoredSignatureRequests, setIgnoredSignatureRequests] = React.useState(initialIgnoredSignatureRequests)
  const [settings, setSettings] = React.useState<SettingsState>(initialSettings)
  const [updateAvailable, setUpdateAvailable] = React.useState(false)
  const [biometricAvailability, setBiometricAvailability] = React.useState<BiometricAvailability>({
    available: false,
    enrolled: false
  })
  const forceRerender = useForceRerender()
  const { t } = useTranslation()

  React.useEffect(() => {
    Promise.all([loadIgnoredSignatureRequestHashes(), loadSettings()])
      .then(([loadedSignatureReqHashes, loadedSettings]) => {
        setIgnoredSignatureRequests(loadedSignatureReqHashes)
        setSettings((prev) => ({ ...prev, ...loadedSettings, initialized: true }))
      })
      .catch(trackError)

    isBiometricAuthAvailable().then(setBiometricAvailability)
    getUpdater().isUpdateAvailable().then(setUpdateAvailable)

    // Can't really cancel loading the settings
    const unsubscribe = () => undefined
    return unsubscribe
  }, [])

  const ignoreSignatureRequest = (signatureRequestHash: string) => {
    if (ignoredSignatureRequests.indexOf(signatureRequestHash) === -1) {
      const updatedSignatureRequestHashes = [...ignoredSignatureRequests, signatureRequestHash]
      saveIgnoredSignatureRequestHashes(updatedSignatureRequestHashes)
      setIgnoredSignatureRequests(updatedSignatureRequestHashes)
    }
  }

  const updateSettings = (update: Partial<Platform.SettingsData>) => {
    try {
      setSettings(currentSettings => {
        const updatedSettings = {
          ...currentSettings,
          ...update
        }
        saveSettings(updatedSettings)
        return updatedSettings
      })
    } catch (error) {
      trackError(error)
    }
  }

  const confirmToC = () => updateSettings({ agreedToTermsAt: new Date().toISOString() })
  const toggleMultiSignature = () => updateSettings({ multisignature: !settings.multisignature })
  const toggleTestnet = () => updateSettings({ testnet: !settings.testnet })
  const toggleHideMemos = () => updateSettings({ hideMemos: !settings.hideMemos })
  const toggleShowDust = () => updateSettings({ showDust: !settings.showDust })
  const toggleShowClaimableBalanceTxs = () =>
    updateSettings({ showClaimableBalanceTxs: !settings.showClaimableBalanceTxs })
  const toggleShowAllBalancesOnAccountCards = () =>
    updateSettings({ showAllBalancesOnAccountCards: !settings.showAllBalancesOnAccountCards })

  const setLanguage = (language: string | undefined) => {
    if (language) {
      localStorage.setItem("i18nextLng", language)
    } else {
      localStorage.removeItem("i18nextLng")
    }
    forceRerender()
  }

  const setSetting = (key: keyof Platform.SettingsData, value: any) => {
    const partial: Partial<Platform.SettingsData> = {}
    partial[key] = value
    updateSettings(partial)
  }

  const toggleBiometricLock = () => {
    const message = settings.biometricLock
      ? t("app-settings.settings.biometric-lock.prompt.disable")
      : t("app-settings.settings.biometric-lock.prompt.enable")

    testBiometricAuth(message)
      .then(() => updateSettings({ biometricLock: !settings.biometricLock }))
      .catch(trackError)
  }

  const setAssetSettings = (accountId: string, assetKey: string, assetSettings: Platform.AssetSettings) => {
    const updateAssetSettings = {
      ...settings.accountAssetSettings,
      [accountId]: {
        ...(settings.accountAssetSettings[accountId] || {}),
        [assetKey]: assetSettings
      }
    }
    updateSettings({ accountAssetSettings: updateAssetSettings })
  }

  const setReceivePaymentSettings = (accountId: string, receivePaymentSettings: Platform.ReceivePaymentSettings) => {
    const updatedReceivePaymentSettings = {
      ...settings.accountReceivePaymentSettings,
      [accountId]: receivePaymentSettings
    }

    updateSettings({ accountReceivePaymentSettings: updatedReceivePaymentSettings })
  }

  const contextValue: ContextType = {
    agreedToTermsAt: settings.agreedToTermsAt,
    biometricLock: settings.biometricLock,
    biometricAvailability,
    confirmToC,
    customMainnetHorizonURL: settings.customMainnetHorizonURL,
    hideMemos: settings.hideMemos,
    ignoreSignatureRequest,
    ignoredSignatureRequests,
    initialized: settings.initialized,
    language: localStorage.getItem("i18nextLng") || undefined,
    lastOpenedAccountID: settings.lastOpenedAccountID,
    multiSignature: settings.multisignature,
    multiSignatureCoordinator,
    onlyCustomMainnetHorizon: settings.onlyCustomMainnetHorizon,
    useCustomMainnetHorizon: settings.useCustomMainnetHorizon,
    setLanguage,
    setSetting,
    showTestnet: settings.testnet,
    showDust: settings.showDust,
    showClaimableBalanceTxs: settings.showClaimableBalanceTxs,
    toggleBiometricLock,
    toggleMultiSignature,
    toggleTestnet,
    toggleHideMemos,
    toggleShowDust,
    toggleShowClaimableBalanceTxs,
    trustedServices: settings.trustedServices,
    updateAvailable,
    accountAssetSettings: settings.accountAssetSettings,
    accountReceivePaymentSettings: settings.accountReceivePaymentSettings,
    showAllBalancesOnAccountCards: settings.showAllBalancesOnAccountCards,
    savedAddressesSyncEnabled: settings.savedAddressesSyncEnabled || false,
    savedAddressesSyncApiKey: settings.savedAddressesSyncApiKey,
    setAssetSettings,
    setReceivePaymentSettings,
    toggleShowAllBalancesOnAccountCards
  }

  return <SettingsContext.Provider value={contextValue}>{props.children}</SettingsContext.Provider>
}

export { ContextType as SettingsContextType, SettingsContext }

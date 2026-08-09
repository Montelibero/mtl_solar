interface TrustedService {
  domain: string
  signingKey?: string
}

declare namespace Platform {
  export interface ReceivePaymentSettings {
    amount: string
    assetId?: string
    description: string
  }
  export type VisibilityMode = undefined | "favorite" | "hidden"
  export interface AssetSettings {
    visibility: VisibilityMode
    order: number
  }
  export type AssetSettingsMap = Record<string, AssetSettings>
  export type AccountAssetSettingsMap = Record<string, AssetSettingsMap>
  export type AccountReceivePaymentSettingsMap = Record<string, ReceivePaymentSettings>
  export interface SettingsData {
    agreedToTermsAt?: string
    biometricLock: boolean
    customMainnetHorizonURL?: string
    hideMemos: boolean
    onlyCustomMainnetHorizon: boolean
    useCustomMainnetHorizon: boolean
    multisignature: boolean
    testnet: boolean
    trustedServices: TrustedService[]
    showDust: boolean
    showClaimableBalanceTxs: boolean
    accountAssetSettings: AccountAssetSettingsMap
    accountReceivePaymentSettings: AccountReceivePaymentSettingsMap
    showAllBalancesOnAccountCards: boolean
    savedAddressesSyncEnabled?: boolean
    savedAddressesSyncApiKey?: string
    lastOpenedAccountID?: string
  }
}

declare namespace NodeJS {
  interface Process {
    browser?: boolean
  }
}

interface BiometricAvailability {
  available: boolean
  enrolled: boolean
}

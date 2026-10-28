import type { LicenseStatus } from '@shared/types'
import { JsonStore } from '../storage/jsonStore'
import { verifyLicense, type VerifyResult } from './core'
import { LICENSE_PUBLIC_KEY_PEM } from './publicKey'

interface LicenseFile {
  key?: string
  devSkipped?: boolean
  activatedAt?: number
}

export class LicenseManager {
  private readonly store: JsonStore<LicenseFile>

  constructor(
    filePath: string,
    private readonly devMode: boolean,
    private readonly publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM
  ) {
    this.store = new JsonStore<LicenseFile>(filePath, () => ({}))
  }

  status(): LicenseStatus {
    const file = this.store.read()
    if (file.key) {
      const result = verifyLicense(file.key, this.publicKeyPem)
      if (result.valid) {
        return {
          activated: true,
          devMode: this.devMode,
          licensee: result.payload.name,
          email: result.payload.email,
          licenseId: result.payload.id,
          issuedAt: result.payload.issuedAt
        }
      }
    }
    return {
      activated: false,
      devMode: this.devMode,
      devSkipped: this.devMode && Boolean(file.devSkipped)
    }
  }

  activate(key: string): VerifyResult {
    const result = verifyLicense(key, this.publicKeyPem)
    if (result.valid) this.store.write({ key: key.replace(/\s+/g, ''), activatedAt: Date.now() })
    return result
  }

  deactivate(): void {
    this.store.write({})
  }

  /** Development builds only: continue without a license. */
  skipForDevelopment(): boolean {
    if (!this.devMode) return false
    this.store.update((f) => ({ ...f, devSkipped: true }))
    return true
  }
}

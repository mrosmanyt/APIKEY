import { useState } from 'react'
import type { AppErrorInfo, BackupImportPreview, RestoreResult } from '@shared/types'
import { ErrorBox } from '../../components/ErrorBox'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { t } from '../../i18n'
import { api, call, errorInfo } from '../../lib/api'
import { useApp } from '../../lib/store'

export const MIN_PASSPHRASE = 8

function KeysWarning() {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{t('settings.includeKeysWarning')}</span>
    </div>
  )
}

function ImportDialog({
  preview,
  onDone,
  onClose
}: {
  preview: BackupImportPreview
  onDone: (r: RestoreResult) => void
  onClose: () => void
}) {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppErrorInfo>()

  const run = async (skipKeys: boolean) => {
    setBusy(true)
    setError(undefined)
    try {
      onDone(
        await call(api().backup.import({ passphrase: skipKeys ? undefined : passphrase, skipKeys }))
      )
    } catch (err) {
      setError(errorInfo(err))
      setPassphrase('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('settings.importTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          {preview.needsPassphrase && (
            <button className="btn-secondary" onClick={() => run(true)} disabled={busy}>
              {t('settings.importWithoutKeys')}
            </button>
          )}
          <button
            className="btn-primary"
            onClick={() => run(false)}
            disabled={busy || (preview.needsPassphrase && !passphrase)}
          >
            {busy ? t('common.loading') : t('settings.importNow')}
          </button>
        </>
      }
    >
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy && (!preview.needsPassphrase || passphrase)) void run(false)
        }}
      >
        <p>
          <span className="font-medium">{preview.fileName}</span>
          <br />
          {t('settings.importContains', {
            conversations: preview.conversations,
            prompts: preview.prompts
          })}
        </p>
        <p className="text-slate-500">{t('settings.importConfirm')}</p>
        {preview.hasKeys && <KeysWarning />}
        {preview.needsPassphrase && (
          <div>
            <label className="label" htmlFor="import-passphrase">
              {t('settings.passphrase')}
            </label>
            <input
              id="import-passphrase"
              type="password"
              className="input"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">{t('settings.importPassphraseHint')}</p>
          </div>
        )}
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  )
}

export function BackupTab() {
  const [includeKeys, setIncludeKeys] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<AppErrorInfo>()
  const [preview, setPreview] = useState<BackupImportPreview>()
  const refreshProviders = useApp((s) => s.refreshProviders)
  const setSettings = useApp((s) => s.setSettings)
  const setStatuses = useApp((s) => s.setStatuses)

  const tooShort = includeKeys && passphrase.length < MIN_PASSPHRASE
  const mismatch = includeKeys && passphrase !== confirm
  const canExport = !includeKeys || (!tooShort && !mismatch)

  const exportBackup = async () => {
    setError(undefined)
    setMessage(undefined)
    try {
      const res = await call(api().backup.export(includeKeys, includeKeys ? passphrase : undefined))
      if (!res) return
      setMessage(
        res.includedKeys
          ? t('settings.exportedWithKeys', { path: res.filePath })
          : t('settings.exported', { path: res.filePath })
      )
      setPassphrase('')
      setConfirm('')
    } catch (err) {
      setError(errorInfo(err))
    }
  }

  const pickImport = async () => {
    setError(undefined)
    setMessage(undefined)
    try {
      const p = await call(api().backup.pickImport())
      if (p) setPreview(p)
    } catch (err) {
      setError(errorInfo(err))
    }
  }

  const onImported = async (res: RestoreResult) => {
    setPreview(undefined)
    await refreshProviders()
    // Restored keys start as "Not tested"; test them so they become usable straight away.
    if (res.keys > 0) {
      const statuses = await call(api().providers.statuses())
      await Promise.all(
        statuses
          .filter((s) => s.hasKey && s.status === 'untested')
          .map((s) => api().providers.testKey(s.id))
      )
      setStatuses(await call(api().providers.statuses()))
    }
    setSettings(await call(api().settings.get()))
    setMessage(
      [
        t('settings.imported', {
          conversations: res.conversations,
          prompts: res.prompts,
          keys: res.keys
        }),
        res.automationSettingsSkipped && t('settings.importAutomationNote'),
        res.skippedSettings.length > 0 &&
          t('settings.importSkippedSettings', { list: res.skippedSettings.join(', ') })
      ]
        .filter(Boolean)
        .join(' ')
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{t('settings.backupIntro')}</p>

      <section className="card space-y-4 p-4">
        <h3 className="font-semibold">{t('settings.exportHeading')}</h3>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={includeKeys}
            onChange={(e) => setIncludeKeys(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t('settings.includeKeys')}</span>
            <span className="block text-xs text-slate-500">{t('settings.includeKeysHint')}</span>
          </span>
        </label>
        {includeKeys && (
          <div className="space-y-3">
            <KeysWarning />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="backup-passphrase">
                  {t('settings.passphrase')}
                </label>
                <input
                  id="backup-passphrase"
                  type="password"
                  className="input"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoComplete="new-password"
                />
                {passphrase && tooShort && (
                  <p className="mt-1 text-xs text-red-600">
                    {t('settings.passphraseTooShort', { min: MIN_PASSPHRASE })}
                  </p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="backup-passphrase-confirm">
                  {t('settings.passphraseConfirm')}
                </label>
                <input
                  id="backup-passphrase-confirm"
                  type="password"
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
                {confirm && mismatch && (
                  <p className="mt-1 text-xs text-red-600">{t('settings.passphraseMismatch')}</p>
                )}
              </div>
            </div>
            <p className="text-xs text-slate-500">{t('settings.passphraseHint')}</p>
          </div>
        )}
        <button className="btn-primary" onClick={exportBackup} disabled={!canExport}>
          <Icon name="download" />
          {t('settings.exportBackup')}
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <h3 className="font-semibold">{t('settings.importHeading')}</h3>
        <button className="btn-secondary" onClick={pickImport}>
          <Icon name="upload" />
          {t('settings.importBackup')}
        </button>
      </section>

      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {error && <ErrorBox error={error} onDismiss={() => setError(undefined)} />}

      {preview && (
        <ImportDialog
          preview={preview}
          onDone={(r) => void onImported(r)}
          onClose={() => {
            setPreview(undefined)
            void api().backup.cancelImport()
          }}
        />
      )}
    </div>
  )
}

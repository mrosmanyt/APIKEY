import { Fragment } from 'react'
import { t, tDynamic } from '../i18n'
import { shortcutHelp } from '../lib/shortcuts'
import { Modal } from './Modal'

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const mac = /Mac/i.test(navigator.platform)
  return (
    <Modal title={t('shortcuts.title')} onClose={onClose}>
      <table className="w-full text-sm">
        <tbody>
          {shortcutHelp(mac).map((row, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              <td className="py-2 pe-4">
                {row.label === 'goTo'
                  ? t('shortcuts.goTo', { screen: tDynamic(`nav.${row.screen}`) })
                  : t(`shortcuts.${row.label}`)}
              </td>
              <td className="whitespace-nowrap py-2 text-end" dir="ltr">
                {row.keys.map((k, j) => (
                  <Fragment key={j}>
                    {j > 0 && <span className="mx-1 text-slate-400">+</span>}
                    <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">
                      {k}
                    </kbd>
                  </Fragment>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

import { Component, type ReactNode } from 'react'
import { t } from '../i18n'

/** Keeps one broken screen from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          <div className="font-semibold">{t('common.unknownError')}</div>
          <pre className="mt-2 whitespace-pre-wrap text-xs">{this.state.error.message}</pre>
          <button
            className="btn-secondary btn-sm mt-3"
            onClick={() => this.setState({ error: undefined })}
          >
            {t('common.retry')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

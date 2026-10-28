/// <reference types="vite/client" />
import type { AiHubApi } from '../../preload/api-types'

declare global {
  interface Window {
    aihub: AiHubApi
  }
}

export {}

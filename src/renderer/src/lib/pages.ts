/** The app's screens. Kept dependency-free so non-UI modules (and tests) can import it. */
export type Page =
  'chat' | 'code' | 'images' | 'video' | 'audio' | 'history' | 'prompts' | 'settings'

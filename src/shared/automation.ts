/**
 * Automation module types (shared by main and renderer). The module is OFF by default; when
 * disabled no automation code runs (no scheduler, watchers, webhook server or tray).
 *
 * Workflows never contain API keys: AI steps name a provider/model and the main process makes
 * the call with the encrypted keys, exactly like the rest of the app.
 */

export const AUTOMATION_FORMAT = 'ai-hub-workflows'
export const AUTOMATION_FORMAT_VERSION = 1

export type StepType =
  | 'llm'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'readFile'
  | 'writeFile'
  | 'http'
  | 'condition'
  | 'delay'
  | 'loop'

export const STEP_TYPES: StepType[] = [
  'llm',
  'image',
  'video',
  'tts',
  'stt',
  'readFile',
  'writeFile',
  'http',
  'condition',
  'delay',
  'loop'
]

export type ConditionOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'matches'
  | 'isEmpty'
  | 'notEmpty'
  | 'greaterThan'
  | 'lessThan'

export const CONDITION_OPERATORS: ConditionOperator[] = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'startsWith',
  'matches',
  'isEmpty',
  'notEmpty',
  'greaterThan',
  'lessThan'
]

/** What a condition does: continue with the next step, stop the run, or jump to a step id. */
export type Branch = { action: 'next' } | { action: 'stop' } | { action: 'goto'; stepId: string }

export interface StepBase {
  /** Short, stable id used in variables: {{step1.output}}. */
  id: string
  name?: string
  /** Skip without running. */
  disabled?: boolean
}

export type Step = StepBase &
  (
    | {
        type: 'llm'
        providerId: string
        model: string
        prompt: string
        systemPrompt?: string
        temperature?: number
        maxTokens?: number
      }
    | {
        type: 'image'
        providerId: string
        model: string
        prompt: string
        negativePrompt?: string
        size?: string
        count?: number
      }
    | {
        type: 'video'
        providerId: string
        model: string
        prompt: string
        size?: string
        durationSeconds?: number
      }
    | { type: 'tts'; providerId: string; model: string; voice: string; text: string }
    | { type: 'stt'; providerId: string; model: string; filePath: string; language?: string }
    | { type: 'readFile'; path: string }
    | { type: 'writeFile'; path: string; content: string; append?: boolean }
    | {
        type: 'http'
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
        url: string
        headers?: Array<{ name: string; value: string }>
        body?: string
      }
    | {
        type: 'condition'
        left: string
        operator: ConditionOperator
        right?: string
        ifTrue: Branch
        ifFalse: Branch
      }
    | { type: 'delay'; seconds: number }
    | {
        type: 'loop'
        items: string
        separator?: 'lines' | 'json' | 'comma'
        maxItems?: number
        steps: Step[]
      }
  )

export type StepOf<T extends StepType> = Extract<Step, { type: T }>

export type SchedulePreset = 'hourly' | 'daily' | 'weekly' | 'custom'

export type Trigger =
  | { type: 'manual' }
  | {
      type: 'schedule'
      preset: SchedulePreset
      /** hourly: minute past the hour */
      minute?: number
      /** daily/weekly: "HH:MM" */
      time?: string
      /** weekly: 0 = Sunday … 6 = Saturday */
      weekday?: number
      /** custom: 5-field cron expression (minute hour day-of-month month day-of-week) */
      cron?: string
    }
  | { type: 'folder'; folder: string; pattern?: string }
  | { type: 'webhook' }

export interface WorkflowPermissions {
  /** Folders (outside the output folder) this workflow may write to — confirmed by the user. */
  writeFolders: string[]
  /** External hosts this workflow may call with HTTP steps — confirmed by the user. */
  httpHosts: string[]
}

export interface WorkflowSafety {
  /** Stop a run (and a batch) once its estimated cost reaches this many USD. 0 = no cap. */
  spendingCapUsd: number
  /** Ignore triggers beyond this many runs started in the last hour. 0 = unlimited. */
  maxRunsPerHour: number
}

export interface Workflow {
  id: string
  name: string
  description?: string
  enabled: boolean
  trigger: Trigger
  steps: Step[]
  safety: WorkflowSafety
  permissions: WorkflowPermissions
  /** Template this workflow was created from. */
  templateId?: string
  createdAt: number
  updatedAt: number
}

export type RunStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'capped' | 'needs_approval'
export type RunSource = 'manual' | 'schedule' | 'folder' | 'webhook' | 'batch' | 'retry'

export interface Approval {
  kind: 'write' | 'http'
  /** Folder (write) or host (http) the user must approve. */
  target: string
}

export interface StepRun {
  stepId: string
  name?: string
  type: StepType
  /** Loop iteration for steps inside a loop. */
  iteration?: number
  status: 'success' | 'failed' | 'skipped' | 'cancelled'
  /** Resolved inputs (templated values), truncated, never containing keys. */
  input: Record<string, string>
  output: string
  outputTruncated?: boolean
  error?: string
  costUsd?: number
  startedAt: number
  durationMs: number
}

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowName: string
  source: RunSource
  batchId?: string
  /** Input text (manual input, batch item, trigger file…). */
  input?: string
  vars: Record<string, string>
  status: RunStatus
  steps: StepRun[]
  /** Outputs of completed top-level steps (used by "Retry from failed step"). */
  outputs: Record<string, string>
  failedStepId?: string
  approval?: Approval
  error?: string
  costUsd: number
  startedAt: number
  finishedAt?: number
  durationMs?: number
  retryOf?: string
}

export type BatchSource = 'csv' | 'txt' | 'folder'
export type BatchStatus = 'running' | 'paused' | 'cancelled' | 'completed' | 'capped'

export interface BatchJob {
  id: string
  workflowId: string
  workflowName: string
  source: BatchSource
  sourcePath: string
  /** Folder batches: file name pattern, e.g. "*.mp3;*.wav". */
  pattern?: string
  total: number
  /** Index of the next item to start. */
  nextIndex: number
  done: number
  failed: number
  running: number
  concurrency: number
  status: BatchStatus
  costUsd: number
  createdAt: number
  updatedAt: number
}

export interface AutomationSettings {
  /** Master switch. OFF by default. */
  enabled: boolean
  /** Keep running in the system tray when the window is closed. */
  runInTray: boolean
  /** Start AI Hub when Windows starts (minimised to the tray). OFF by default. */
  startWithWindows: boolean
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  /** Optional local HTTP server on 127.0.0.1 for webhook triggers. OFF by default. */
  webhookEnabled: boolean
  webhookPort: number
  /**
   * Estimates used for the spending cap (USD): per generated item, and per 1M chat tokens
   * (deliberately on the high side so caps stop early rather than late).
   */
  unitCosts: {
    image: number
    video: number
    tts: number
    stt: number
    chatInputPer1M: number
    chatOutputPer1M: number
  }
}

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  enabled: false,
  runInTray: false,
  startWithWindows: false,
  notifyOnSuccess: false,
  notifyOnFailure: true,
  webhookEnabled: false,
  webhookPort: 17345,
  unitCosts: {
    image: 0.04,
    video: 0.5,
    tts: 0.015,
    stt: 0.006,
    chatInputPer1M: 3,
    chatOutputPer1M: 15
  }
}

export interface WebhookInfo {
  enabled: boolean
  running: boolean
  baseUrl: string
  token: string
  error?: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  /** How to use it, shown in the template picker. */
  howTo: string
  workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'enabled' | 'permissions'>
}

export interface WorkflowPack {
  format: typeof AUTOMATION_FORMAT
  version: number
  exportedAt: string
  workflows: Array<Omit<Workflow, 'permissions'>>
}

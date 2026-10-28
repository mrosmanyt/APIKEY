/**
 * Import/export of workflow packs (JSON). Exported files never contain API keys (workflows
 * never hold any), approvals, or the webhook token. Imported workflows get fresh ids, start
 * DISABLED and with NO approvals, so a pack from someone else cannot silently write outside
 * your output folder, call external URLs or start running on a schedule.
 */
import { newId } from '@shared/ids'
import {
  AUTOMATION_FORMAT,
  AUTOMATION_FORMAT_VERSION,
  type Workflow,
  type WorkflowPack
} from '@shared/automation'
import { allSteps, validateWorkflow, zPackWorkflow, zStep } from './schema'

export function exportPack(workflows: Workflow[], now = new Date()): WorkflowPack {
  return {
    format: AUTOMATION_FORMAT,
    version: AUTOMATION_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    workflows: workflows.map(({ permissions: _p, ...w }) => ({ ...w }))
  }
}

export function importPack(
  text: string,
  now = Date.now()
): { workflows: Workflow[]; skipped: string[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  const pack = data as Partial<WorkflowPack>
  if (pack?.format !== AUTOMATION_FORMAT || !Array.isArray(pack.workflows)) {
    throw new Error('This file is not an AI Hub workflow pack.')
  }
  if ((pack.version ?? 0) > AUTOMATION_FORMAT_VERSION) {
    throw new Error(
      'This workflow pack was made with a newer version of AI Hub. Please update the app.'
    )
  }
  const workflows: Workflow[] = []
  const skipped: string[] = []
  for (const raw of pack.workflows) {
    const parsed = zPackWorkflow.safeParse(raw)
    const name = (raw as { name?: string })?.name ?? '(unnamed)'
    if (!parsed.success) {
      skipped.push(`${name}: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
      continue
    }
    const stepsOk = parsed.data.steps.every((s) => zStep.safeParse(s).success)
    if (!stepsOk) {
      skipped.push(`${name}: invalid steps`)
      continue
    }
    const w: Workflow = {
      ...(parsed.data as unknown as Workflow),
      id: newId('wf_'),
      enabled: false,
      permissions: { writeFolders: [], httpHosts: [] },
      createdAt: now,
      updatedAt: now
    }
    const problems = validateWorkflow({ ...w, enabled: false })
    if (problems.length) {
      skipped.push(`${name}: ${problems[0]}`)
      continue
    }
    workflows.push(w)
  }
  return { workflows, skipped }
}

/** Next free "stepN" id for a new step. */
export function nextStepId(steps: Workflow['steps']): string {
  const used = new Set(allSteps(steps).map((s) => s.id))
  let n = 1
  while (used.has(`step${n}`)) n++
  return `step${n}`
}

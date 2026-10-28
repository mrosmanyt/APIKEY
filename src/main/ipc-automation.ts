import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import type { InvokeChannel } from '../preload/api-types'
import type { AutomationService } from './automation/service'
import { zWorkflow } from './automation/schema'
import { zId, zTemplateDefaults } from './validation'

type Handle = <A extends unknown[]>(
  channel: InvokeChannel,
  schema: z.ZodType<A>,
  fn: (...args: A) => unknown
) => void

const zApproval = z.object({ kind: z.enum(['write', 'http']), target: z.string().min(1).max(2000) })

export function registerAutomationIpc(handle: Handle, automation: AutomationService): void {
  const none = z.tuple([])
  const one = <T extends z.ZodTypeAny>(t: T) => z.tuple([t])
  const win = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  /** Every automation channel is refused while the module is turned off. */
  const on = <A extends unknown[]>(
    channel: InvokeChannel,
    schema: z.ZodType<A>,
    fn: (...args: A) => unknown
  ) =>
    handle(channel, schema, (...args: A) => {
      if (!automation.isEnabled())
        throw new Error('Automation is turned off. Enable it in Settings › Automation.')
      return fn(...args)
    })

  handle('automation:status', none, () => ({
    enabled: automation.isEnabled(),
    running: automation.isRunning(),
    nextRuns: automation.nextScheduledRuns()
  }))

  on('automation:listWorkflows', none, () => automation.listWorkflows())
  on('automation:saveWorkflow', one(zWorkflow), (w) => automation.saveWorkflow(w))
  on('automation:deleteWorkflow', one(zId), (id) => automation.deleteWorkflow(id))
  on('automation:templates', none, () => automation.templates())
  on(
    'automation:createFromTemplate',
    z.tuple([z.string().max(100), zTemplateDefaults]),
    (id, defaults) => automation.createFromTemplate(id, defaults)
  )
  on('automation:preflight', one(zId), (id) => automation.preflight(id))
  on('automation:approve', z.tuple([zId, z.array(zApproval).max(50)]), (id, approvals) =>
    automation.approve(id, approvals)
  )
  on(
    'automation:revoke',
    z.tuple([zId, z.enum(['write', 'http']), z.string().max(2000)]),
    (id, kind, target) => automation.revokePermission(id, kind, target) ?? null
  )

  on('automation:run', z.tuple([zId, z.string().max(1_000_000).nullable()]), (id, input) =>
    automation.runManually(id, input ?? undefined)
  )
  on('automation:cancelRun', one(zId), (id) => automation.cancelRun(id))
  on('automation:listRuns', z.tuple([zId.nullable()]), (id) => automation.listRuns(id ?? undefined))
  on('automation:clearRuns', none, () => automation.clearRuns())
  on('automation:retryRun', one(zId), (id) => automation.retryRun(id))
  on('automation:approveRun', one(zId), (id) => automation.approveRun(id))

  on('automation:listBatches', none, () => automation.listBatches())
  on(
    'automation:startBatch',
    one(
      z.object({
        workflowId: zId,
        source: z.enum(['csv', 'txt', 'folder']),
        sourcePath: z.string().min(1).max(2000),
        pattern: z.string().max(300).optional(),
        concurrency: z.number().int().min(1).max(8)
      })
    ),
    (opts) => automation.startBatch(opts)
  )
  on('automation:pauseBatch', one(zId), (id) => automation.pauseBatch(id) ?? null)
  on('automation:resumeBatch', one(zId), (id) => automation.resumeBatch(id) ?? null)
  on('automation:cancelBatch', one(zId), (id) => automation.cancelBatch(id) ?? null)
  on('automation:deleteBatch', one(zId), (id) => automation.deleteBatch(id))

  on('automation:export', one(z.array(zId).max(1000)), async (ids) => {
    const res = await dialog.showSaveDialog(win(), {
      defaultPath: path.join(
        app.getPath('documents'),
        `ai-hub-workflows-${new Date().toISOString().slice(0, 10)}.json`
      ),
      filters: [{ name: 'AI Hub workflows', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return null
    await fs.promises.writeFile(res.filePath, automation.exportWorkflows(ids), 'utf8')
    return res.filePath
  })
  on('automation:import', none, async () => {
    const res = await dialog.showOpenDialog(win(), {
      properties: ['openFile'],
      filters: [{ name: 'AI Hub workflows', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return automation.importWorkflows(await fs.promises.readFile(res.filePaths[0], 'utf8'))
  })

  on('automation:webhookInfo', none, () => automation.webhookInfo())
  on('automation:regenerateToken', none, () => automation.regenerateToken())

  on(
    'automation:pickPath',
    z.tuple([z.enum(['file', 'folder', 'save']), z.array(z.string().max(20)).max(20).nullable()]),
    async (kind, extensions) => {
      const filters = extensions?.length ? [{ name: extensions.join(', '), extensions }] : undefined
      if (kind === 'save') {
        const res = await dialog.showSaveDialog(win(), { filters })
        return res.canceled ? null : (res.filePath ?? null)
      }
      const res = await dialog.showOpenDialog(win(), {
        properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
        filters
      })
      return res.canceled ? null : (res.filePaths[0] ?? null)
    }
  )
}

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateCondition, runWorkflow } from '../../src/main/automation/engine'
import type { Step } from '../../src/shared/automation'
import { fakeDeps, wf } from './helpers'

const llm = (id: string, prompt: string): Step => ({
  id,
  type: 'llm',
  providerId: 'openai',
  model: 'gpt-4o',
  prompt
})

describe('workflow engine', () => {
  it('chains outputs through {{stepN.output}} and built-in variables', async () => {
    const deps = fakeDeps()
    const run = await runWorkflow(
      {
        workflow: wf([
          llm('step1', 'Outline about {{input}}'),
          llm('step2', 'Write from: {{step1.output}}'),
          { id: 'step3', type: 'writeFile', path: 'posts/{{date}}.md', content: '{{step2.output}}' }
        ]),
        source: 'manual',
        input: 'cats'
      },
      deps
    )
    expect(run.status).toBe('success')
    expect((deps.log.calls[1].args as { prompt: string }).prompt).toBe(
      'Write from: LLM(Outline about cats)'
    )
    const written = [...deps.log.files.entries()][0]
    expect(written[0]).toMatch(/out[\\/]automation[\\/]posts[\\/]\d{4}-\d{2}-\d{2}\.md$/)
    expect(written[1]).toBe('LLM(Write from: LLM(Outline about cats))')
    expect(run.steps.map((s) => s.status)).toEqual(['success', 'success', 'success'])
    expect(run.costUsd).toBeCloseTo(0.004) // 2 LLM calls × 2000 tokens × $1/1M
    expect(run.outputs.step1).toBe('LLM(Outline about cats)')
  })

  it('evaluates conditions and branches (next / stop / go to)', async () => {
    expect(evaluateCondition('Hello World', 'contains', 'world')).toBe(true)
    expect(evaluateCondition('', 'isEmpty')).toBe(true)
    expect(evaluateCondition('10', 'greaterThan', '9.5')).toBe(true)
    expect(evaluateCondition('abc', 'matches', '^a.c$')).toBe(true)
    expect(evaluateCondition('x', 'lessThan', '2')).toBe(false)
    expect(() => evaluateCondition('x', 'matches', '(')).toThrow(/Invalid pattern/)

    const deps = fakeDeps()
    const steps: Step[] = [
      llm('step1', 'Is it spam? {{input}}'),
      {
        id: 'step2',
        type: 'condition',
        left: '{{input}}',
        operator: 'contains',
        right: 'buy now',
        ifTrue: { action: 'stop' },
        ifFalse: { action: 'goto', stepId: 'step4' }
      },
      llm('step3', 'never runs'),
      llm('step4', 'Reply to {{input}}')
    ]
    const stopped = await runWorkflow(
      { workflow: wf(steps), source: 'manual', input: 'BUY NOW cheap' },
      deps
    )
    expect(stopped.status).toBe('success')
    expect(stopped.steps.map((s) => s.stepId)).toEqual(['step1', 'step2'])

    const jumped = await runWorkflow(
      { workflow: wf(steps), source: 'manual', input: 'hello' },
      fakeDeps()
    )
    expect(jumped.steps.map((s) => s.stepId)).toEqual(['step1', 'step2', 'step4'])
  })

  it('loops over a list with {{loop.item}} and collects the outputs', async () => {
    const deps = fakeDeps()
    const run = await runWorkflow(
      {
        workflow: wf([
          {
            id: 'step1',
            type: 'loop',
            items: '{{input}}',
            steps: [
              {
                id: 'step2',
                type: 'image',
                providerId: 'openai',
                model: 'dall-e-3',
                prompt: '{{loop.index}}: {{loop.item}}'
              }
            ]
          },
          { id: 'step3', type: 'writeFile', path: 'list.txt', content: '{{step1.output}}' }
        ]),
        source: 'manual',
        input: 'a cat\n\na dog\na bird'
      },
      deps
    )
    expect(run.status).toBe('success')
    expect(
      deps.log.calls
        .filter((c) => c.kind === 'image')
        .map((c) => (c.args as { prompt: string }).prompt)
    ).toEqual(['1: a cat', '2: a dog', '3: a bird'])
    expect([...deps.log.files.values()][0]).toBe('/img/0.png\n/img/0.png\n/img/0.png')
    expect(run.steps.filter((s) => s.stepId === 'step2').map((s) => s.iteration)).toEqual([1, 2, 3])
  })

  it('stops at the spending cap before the next paid step', async () => {
    const deps = fakeDeps({ chatCost: () => 0.6 })
    const run = await runWorkflow(
      {
        workflow: wf([llm('step1', 'a'), llm('step2', 'b'), llm('step3', 'c')], {
          safety: { spendingCapUsd: 1, maxRunsPerHour: 0 }
        }),
        source: 'manual'
      },
      deps
    )
    expect(run.status).toBe('capped')
    expect(deps.log.calls.filter((c) => c.kind === 'llm')).toHaveLength(2)
    expect(run.error).toMatch(/spending cap of \$1\.00/)
  })

  it('counts prior batch spend against the cap', async () => {
    const deps = fakeDeps()
    const run = await runWorkflow(
      {
        workflow: wf([llm('step1', 'a')], { safety: { spendingCapUsd: 0.5, maxRunsPerHour: 0 } }),
        source: 'batch',
        priorSpendUsd: () => 0.5
      },
      deps
    )
    expect(run.status).toBe('capped')
    expect(deps.log.calls).toHaveLength(0)
  })

  it('requires approval to write outside the output folder or call external hosts', async () => {
    const outside = path.resolve('/tmp/aihub-elsewhere/report.txt')
    const write = await runWorkflow(
      {
        workflow: wf([
          llm('step1', 'x'),
          { id: 'step2', type: 'writeFile', path: outside, content: 'hi' }
        ]),
        source: 'manual'
      },
      fakeDeps()
    )
    expect(write.status).toBe('needs_approval')
    expect(write.approval).toEqual({ kind: 'write', target: path.dirname(outside) })
    expect(write.failedStepId).toBe('step2')

    const approved = fakeDeps()
    const ok = await runWorkflow(
      {
        workflow: wf([{ id: 'step1', type: 'writeFile', path: outside, content: 'hi' }], {
          permissions: { writeFolders: [path.dirname(outside)], httpHosts: [] }
        }),
        source: 'manual'
      },
      approved
    )
    expect(ok.status).toBe('success')

    const http = await runWorkflow(
      {
        workflow: wf([
          {
            id: 'step1',
            type: 'http',
            method: 'POST',
            url: 'https://hooks.example.com/x',
            body: '{{input}}'
          }
        ]),
        source: 'manual'
      },
      fakeDeps()
    )
    expect(http.approval).toEqual({ kind: 'http', target: 'hooks.example.com' })

    const ping: Step = {
      id: 'step1',
      type: 'http',
      method: 'GET',
      url: 'http://localhost:8080/ping'
    }
    const local = await runWorkflow({ workflow: wf([ping]), source: 'manual' }, fakeDeps())
    expect(local.status).toBe('needs_approval')
    expect(local.approval).toEqual({ kind: 'http', target: 'localhost:8080' })
    const localApproved = await runWorkflow(
      {
        workflow: wf([ping], { permissions: { writeFolders: [], httpHosts: ['localhost:8080'] } }),
        source: 'manual'
      },
      fakeDeps()
    )
    expect(localApproved.status).toBe('success')
  })

  it('never reads or writes the private app data folder', async () => {
    const deps = fakeDeps()
    const keys = path.join(deps.protectedDir, 'data', 'keys.json')
    const read = await runWorkflow(
      { workflow: wf([{ id: 'step1', type: 'readFile', path: keys }]), source: 'manual' },
      deps
    )
    expect(read.status).toBe('failed')
    expect(read.error).toMatch(/private data folder/)
    const write = await runWorkflow(
      {
        workflow: wf([{ id: 'step1', type: 'writeFile', path: keys, content: 'x' }], {
          permissions: { writeFolders: [deps.protectedDir], httpHosts: [] }
        }),
        source: 'manual'
      },
      deps
    )
    expect(write.status).toBe('failed')
  })

  it('hides secret header values in the recorded inputs and fails on HTTP errors', async () => {
    const deps = fakeDeps({ http: async () => ({ status: 500, body: 'boom' }) })
    const run = await runWorkflow(
      {
        workflow: wf(
          [
            {
              id: 'step1',
              type: 'http',
              method: 'POST',
              url: 'https://api.example.com',
              headers: [
                { name: 'Authorization', value: 'Bearer my-own-token-123' },
                { name: 'X-Mode', value: 'fast' }
              ]
            }
          ],
          { permissions: { writeFolders: [], httpHosts: ['api.example.com'] } }
        ),
        source: 'manual'
      },
      deps
    )
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/HTTP 500/)
    expect(run.steps[0].input['header Authorization']).toBe('[hidden]')
    expect(run.steps[0].input['header X-Mode']).toBe('fast')
    expect(JSON.stringify(run)).not.toContain('my-own-token-123')
  })

  it('records failures with the failed step and supports retry from it', async () => {
    let fail = true
    const deps = fakeDeps({
      llm: async (r) => {
        if (r.prompt.startsWith('second') && fail) throw new Error('Rate limited')
        return { text: `LLM(${r.prompt})` }
      }
    })
    const workflow = wf([
      llm('step1', 'first {{input}}'),
      llm('step2', 'second {{step1.output}}'),
      llm('step3', 'third {{step2.output}}')
    ])
    const failed = await runWorkflow({ workflow, source: 'manual', input: 'x' }, deps)
    expect(failed.status).toBe('failed')
    expect(failed.failedStepId).toBe('step2')
    expect(failed.error).toBe('Rate limited')

    fail = false
    const retried = await runWorkflow(
      {
        workflow,
        source: 'retry',
        input: 'x',
        resume: { fromStepId: 'step2', outputs: failed.outputs, retryOf: failed.id }
      },
      deps
    )
    expect(retried.status).toBe('success')
    expect(retried.steps.map((s) => s.stepId)).toEqual(['step2', 'step3']) // step1 not re-run
    expect(retried.outputs.step3).toBe('LLM(third LLM(second LLM(first x)))')
    expect(retried.retryOf).toBe(failed.id)
  })

  it('can be cancelled mid-run', async () => {
    const controller = new AbortController()
    const deps = fakeDeps({
      sleep: async (_ms, signal) => {
        controller.abort()
        if (signal.aborted) {
          const e = new Error('aborted')
          e.name = 'AbortError'
          throw e
        }
      }
    })
    const run = await runWorkflow(
      {
        workflow: wf([{ id: 'step1', type: 'delay', seconds: 60 }, llm('step2', 'never')]),
        source: 'manual',
        signal: controller.signal
      },
      deps
    )
    expect(run.status).toBe('cancelled')
    expect(deps.log.calls).toHaveLength(0)
  })

  it('guards against endless goto loops', async () => {
    const run = await runWorkflow(
      {
        workflow: wf([
          {
            id: 'step1',
            type: 'condition',
            left: 'a',
            operator: 'equals',
            right: 'a',
            ifTrue: { action: 'goto', stepId: 'step1' },
            ifFalse: { action: 'next' }
          }
        ]),
        source: 'manual'
      },
      fakeDeps()
    )
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/endless loop/)
  })

  it('skips disabled steps and reports live updates', async () => {
    const updates: string[] = []
    const run = await runWorkflow(
      {
        workflow: wf([{ ...llm('step1', 'a'), disabled: true }, llm('step2', 'b')]),
        source: 'manual',
        onUpdate: (r) => updates.push(r.status)
      },
      fakeDeps()
    )
    expect(run.steps.map((s) => s.status)).toEqual(['skipped', 'success'])
    expect(updates.length).toBeGreaterThan(2)
    expect(updates[updates.length - 1]).toBe('success')
  })
})

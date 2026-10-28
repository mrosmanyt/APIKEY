import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as prettier from 'prettier'
import { describe, expect, it } from 'vitest'
import { verifyLicense as appVerify } from '../src/main/license/core'
import {
  createKeypair,
  isPlaceholderKey,
  issueLicense,
  paths,
  readEmbeddedPublicKey
} from '../tools/license-lib.mjs'
import { tmpDir } from './helpers/fakes'

const REPO = path.resolve(__dirname, '..')
const TOOLS = path.join(REPO, 'tools')

/** A throwaway copy of the repo layout the tools need, so tests never touch the real key. */
function fakeRepo(lineEnding: '\n' | '\r\n' = '\n') {
  const root = tmpDir()
  const target = path.join(root, 'src/main/license/publicKey.ts')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const original = fs.readFileSync(path.join(REPO, 'src/main/license/publicKey.ts'), 'utf8')
  fs.writeFileSync(target, original.replace(/\r?\n/g, lineEnding))
  return root
}

/** Run a tool exactly like `node tools\\x.mjs` would on Windows: plain node, no tsx/npm. */
function runTool(script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { encoding: 'utf8' })
}

describe('license tools (plain Node, no dependencies)', () => {
  it('only import Node built-ins', () => {
    for (const f of fs.readdirSync(TOOLS).filter((f) => f.endsWith('.mjs'))) {
      const src = fs.readFileSync(path.join(TOOLS, f), 'utf8')
      const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
      for (const i of imports)
        expect(i.startsWith('node:') || i.startsWith('./'), `${f} imports ${i}`).toBe(true)
    }
  })

  it('detects the placeholder key in the repository', () => {
    expect(isPlaceholderKey(fakeRepo())).toBe(true)
  })

  it('creates a keypair, embeds the public key and refuses to overwrite', async () => {
    const root = fakeRepo()
    const r = createKeypair(root)
    expect(fs.readFileSync(r.privateKey, 'utf8')).toContain('BEGIN PRIVATE KEY')
    expect(isPlaceholderKey(root)).toBe(false)
    expect(readEmbeddedPublicKey(root)).toBe(r.publicKeyPemText)

    // The generated TS module exports the same key...
    const mod = (await import(r.publicKeyTs)) as { LICENSE_PUBLIC_KEY_PEM: string }
    expect(mod.LICENSE_PUBLIC_KEY_PEM).toBe(r.publicKeyPemText)
    // ...and passes the repository's Prettier check (so CI stays green after committing it).
    const src = fs.readFileSync(r.publicKeyTs, 'utf8')
    const options =
      (await prettier.resolveConfig(path.join(REPO, 'src/main/license/publicKey.ts'))) ?? {}
    expect(await prettier.check(src, { ...options, filepath: r.publicKeyTs })).toBe(true)
    expect(src).not.toContain('\r')

    expect(() => createKeypair(root)).toThrow(/already exists/)
    const before = fs.readFileSync(r.privateKey, 'utf8')
    createKeypair(root, { force: true })
    expect(fs.readFileSync(r.privateKey, 'utf8')).not.toBe(before)
  })

  it('works on a Windows (CRLF) checkout', () => {
    const root = fakeRepo('\r\n')
    expect(isPlaceholderKey(root)).toBe(true)
    createKeypair(root)
    const { key, matchesApp } = issueLicense(root, { name: 'CRLF Buyer' })
    expect(matchesApp).toBe(true)
    expect(appVerify(key, readEmbeddedPublicKey(root)).valid).toBe(true)
  })

  it('issues keys the app accepts and records them', () => {
    const root = fakeRepo()
    createKeypair(root)
    const r = issueLicense(root, {
      name: 'Jane, "JD" Doe',
      email: 'jane@example.com',
      id: 'ORDER-7',
      expires: '2030-01-31'
    })
    expect(r.matchesApp).toBe(true)
    const verified = appVerify(r.key, readEmbeddedPublicKey(root), new Date('2029-01-01'))
    expect(verified).toMatchObject({
      valid: true,
      payload: {
        name: 'Jane, "JD" Doe',
        email: 'jane@example.com',
        id: 'ORDER-7',
        product: 'ai-hub'
      }
    })
    expect(appVerify(r.key, readEmbeddedPublicKey(root), new Date('2031-01-01'))).toEqual({
      valid: false,
      reason: 'expired'
    })
    const csv = fs.readFileSync(paths(root).issuedLog, 'utf8').trim().split('\n')
    expect(csv[0]).toBe('issuedAt,id,name,email,expiresAt')
    expect(csv[1]).toContain('ORDER-7,"Jane, ""JD"" Doe",jane@example.com,2030-01-31')
  })

  it('reports keys that do not match the embedded public key', () => {
    const a = fakeRepo()
    const b = fakeRepo()
    createKeypair(a)
    createKeypair(b)
    const r = issueLicense(a, { name: 'X', keyPath: paths(b).privateKey })
    expect(r.matchesApp).toBe(false)
    expect(appVerify(r.key, readEmbeddedPublicKey(a)).valid).toBe(false)
  })

  it('validates input', () => {
    const root = fakeRepo()
    expect(() => issueLicense(root, { name: 'X' })).toThrow(/Private key not found/)
    createKeypair(root)
    expect(() => issueLicense(root, { name: ' ' })).toThrow(/name is required/)
    expect(() => issueLicense(root, { name: 'X', expires: 'not-a-date' })).toThrow(
      /Invalid --expires/
    )
  })

  it('CLI: keypair + license end to end with plain node', () => {
    const root = fakeRepo()
    const kp = runTool('generate-keypair.mjs', ['--root', root])
    expect(kp.status).toBe(0)
    expect(kp.stdout).toContain('PRIVATE key')
    const again = runTool('generate-keypair.mjs', ['--root', root])
    expect(again.status).toBe(2)
    expect(again.stderr).toContain('already exists')

    const out = execFileSync(
      process.execPath,
      [
        path.join(TOOLS, 'generate-license.mjs'),
        '--root',
        root,
        '--name',
        'Jane Doe',
        '--email',
        'jane@example.com',
        '--id',
        'ORDER-1001'
      ],
      { encoding: 'utf8' }
    )
    const key = /AIHUB1\.[\w-]+\.[\w-]+/.exec(out)?.[0]
    expect(key).toBeDefined()
    expect(out).not.toContain('WARNING')
    expect(appVerify(key!, readEmbeddedPublicKey(root))).toMatchObject({
      valid: true,
      payload: { name: 'Jane Doe', id: 'ORDER-1001' }
    })
  })

  it('CLI: license without --name and without a terminal prints usage', () => {
    const r = runTool('generate-license.mjs', ['--root', fakeRepo()])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Usage')
  })
})

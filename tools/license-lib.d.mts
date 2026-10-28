// Type declarations for tools/license-lib.mjs (used by the tests).
export const LICENSE_PREFIX: string
export const PRODUCT_ID: string
export const PLACEHOLDER_PUBLIC_KEY: string
export const DEFAULT_ROOT: string
export interface ToolPaths {
  keysDir: string
  privateKey: string
  publicKeyPem: string
  issuedLog: string
  publicKeyTs: string
}
export function paths(root?: string): ToolPaths
export function publicKeyModuleSource(publicKeyPem: string): string
export function readEmbeddedPublicKey(root?: string): string
export function isPlaceholderKey(root?: string): boolean
export function createKeypair(
  root?: string,
  opts?: { force?: boolean }
): ToolPaths & { publicKeyPemText: string }
export function signLicense(payload: object, privateKeyPem: string): string
export function verifyLicense(key: string, publicKeyPem: string): boolean
export interface IssueOptions {
  name?: string
  email?: string
  id?: string
  expires?: string
  keyPath?: string
}
export function issueLicense(
  root?: string,
  opts?: IssueOptions
): { key: string; payload: Record<string, unknown>; matchesApp: boolean; logFile: string }
export function parseArgs(argv: string[]): Record<string, string | true>

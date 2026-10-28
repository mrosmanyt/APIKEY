export interface CodeBlock {
  language: string
  code: string
  fileName?: string
}

const FENCE = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g

const EXT: Record<string, string> = {
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  python: 'py',
  py: 'py',
  java: 'java',
  csharp: 'cs',
  cs: 'cs',
  'c#': 'cs',
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  ruby: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  powershell: 'ps1',
  ps1: 'ps1',
  markdown: 'md',
  md: 'md',
  xml: 'xml',
  dockerfile: 'Dockerfile',
  toml: 'toml',
  vue: 'vue'
}

/** Detect "// path/to/file.ts" or "# file.py" on the first line of a code block. */
function detectFileName(code: string): string | undefined {
  const first = code.split('\n', 1)[0]?.trim() ?? ''
  const m = /^(?:\/\/|#|--|<!--|\/\*)\s*([\w./\\-]+\.[A-Za-z0-9]{1,10})\s*(?:-->|\*\/)?$/.exec(
    first
  )
  return m?.[1]
}

export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const out: CodeBlock[] = []
  for (const m of markdown.matchAll(FENCE)) {
    const code = m[2].replace(/\n$/, '')
    out.push({ language: m[1] || 'text', code, fileName: detectFileName(code) })
  }
  return out
}

export function suggestFileName(block: CodeBlock, index: number): string {
  if (block.fileName) return block.fileName.split(/[\\/]/).pop()!
  const ext = EXT[block.language.toLowerCase()] ?? 'txt'
  return ext === 'Dockerfile' ? 'Dockerfile' : `snippet-${index + 1}.${ext}`
}

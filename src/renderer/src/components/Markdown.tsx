import { memo, type ReactNode, isValidElement } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { CopyButton } from './CopyButton'

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ''
}

function Pre({ children }: { children?: ReactNode }) {
  const code = nodeText(children).replace(/\n$/, '')
  const child = Array.isArray(children) ? children[0] : children
  const cls = isValidElement(child)
    ? String((child.props as { className?: string }).className ?? '')
    : ''
  const lang = /language-([\w+#.-]+)/.exec(cls)?.[1] ?? ''
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-700 bg-[#0d1117] text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-1 text-xs text-slate-400">
        <span>{lang || 'code'}</span>
        <CopyButton text={code} className="btn btn-sm text-slate-300 hover:bg-slate-700" />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown" dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: Pre,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

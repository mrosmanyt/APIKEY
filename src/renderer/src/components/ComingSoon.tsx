import { PageHeader } from './PageHeader'

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-1 items-center justify-center text-slate-500">…</div>
    </>
  )
}

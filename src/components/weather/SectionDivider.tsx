export function SectionDivider({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-4 my-8">
      <div className="h-px bg-gray-800 flex-1" />
      <h2 className="text-xs font-bold tracking-[0.2em] text-gray-500 uppercase">
        {title}
      </h2>
      <div className="h-px bg-gray-800 flex-1" />
    </div>
  )
}

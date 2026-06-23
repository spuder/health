export default function RawDataModal({ label, data, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center p-4 pt-16 overflow-auto"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1520] border border-[#243450] rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#243450] shrink-0">
          <span className="font-mono text-[#374d6c] text-xs">{label} · raw</span>
          <button onClick={onClose} className="text-[#475569] hover:text-white text-sm leading-none transition-colors">✕</button>
        </div>
        <pre className="p-4 text-[11px] font-mono text-[#475569] overflow-auto max-h-[70vh] leading-relaxed whitespace-pre-wrap break-all">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  )
}

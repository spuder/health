import { useState, useRef, useEffect } from 'react'
import { api } from '../api'
import RawDataModal from './RawDataModal'

// Brief, non-diagnostic blurbs for genes people commonly ask about.
// Same pattern as MARKER_INFO in LabsSection — expand over time.
const GENE_INFO = {
  MTHFR: {
    summary: 'Affects how your body processes folate (vitamin B9).',
    details: 'Common variants are C677T and A1298C. Being homozygous (e.g. CT/CT or TT) can reduce the enzyme\'s efficiency, which some people offset by taking methylated folate (5-MTHF) instead of folic acid. Talk to a doctor before changing supplements based on this alone.',
  },
  APOE: {
    summary: 'Affects cholesterol transport and is linked to Alzheimer\'s risk.',
    details: 'Reported as a pair of alleles (e2, e3, e4). e3/e3 is most common and considered neutral risk. Carrying one or two e4 alleles is associated with higher Alzheimer\'s and cardiovascular risk; e2 may be modestly protective for Alzheimer\'s but linked to different lipid effects.',
  },
  COMT: {
    summary: 'Affects how quickly you break down dopamine.',
    details: 'Often called the "warrior vs. worrier" gene. The Val/Val variant clears dopamine quickly (calmer under stress, may need more stimulation); Met/Met clears it slowly (sharper focus, more stress-sensitive). Val/Met is in between.',
  },
  FTO: {
    summary: 'Associated with appetite regulation and obesity risk.',
    details: 'Certain variants (e.g. the "AA" genotype at rs9939609) are associated with higher BMI and stronger appetite response to high-fat food on average — a tendency, not a determinant.',
  },
  ACTN3: {
    summary: 'Influences fast-twitch muscle fiber function — the "speed gene".',
    details: 'The RR genotype is common in elite power/sprint athletes; XX means no functional protein, associated with better endurance adaptation; RX is in between.',
  },
  VDR: {
    summary: 'Affects how sensitive your cells are to vitamin D.',
    details: 'Certain variants are associated with lower vitamin D receptor sensitivity, which some use as a reason to target higher serum vitamin D levels.',
  },
}

const KNOWN_GENES = Object.keys(GENE_INFO)

function GeneInfoPopup({ gene }) {
  const info = GENE_INFO[gene?.toUpperCase()]
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (!info) return null

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-4 h-4 rounded-full border border-[#374d6c] text-[#475569] hover:text-[#94a3b8] hover:border-[#475569] text-[9px] font-bold flex items-center justify-center transition-colors"
      >
        ?
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-20 w-64 bg-[#111826] border border-[#243450] rounded-xl p-4 shadow-2xl">
          <p className="text-white text-xs font-medium mb-2">{info.summary}</p>
          <p className="text-[#64748b] text-xs leading-relaxed">{info.details}</p>
        </div>
      )}
    </div>
  )
}

function TraitModal({ files, onClose, onSave }) {
  const [gene, setGene] = useState('')
  const [variant, setVariant] = useState('')
  const [genotype, setGenotype] = useState('')
  const [result, setResult] = useState('')
  const [notes, setNotes] = useState('')
  const [fileId, setFileId] = useState('')
  const [loading, setLoading] = useState(false)
  const overlayRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!gene.trim()) return
    setLoading(true)
    try {
      await onSave({
        gene: gene.trim(),
        variant: variant.trim() || undefined,
        genotype: genotype.trim() || undefined,
        result: result.trim() || undefined,
        notes: notes.trim() || undefined,
        file_id: fileId || undefined,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(7, 11, 18, 0.85)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="bg-[#131d2e] border border-[#243450] rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#243450]">
          <h2 className="text-white font-semibold text-base">Add Genetic Trait</h2>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] text-xl transition-colors leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[#94a3b8] text-xs font-medium block mb-1.5">Gene</label>
              <input
                autoFocus
                type="text"
                list="known-genes"
                placeholder="MTHFR"
                value={gene}
                onChange={e => setGene(e.target.value)}
                required
              />
              <datalist id="known-genes">
                {KNOWN_GENES.map(g => <option key={g} value={g} />)}
              </datalist>
            </div>
            <div>
              <label className="text-[#94a3b8] text-xs font-medium block mb-1.5">
                Variant <span className="text-[#475569] font-normal">— optional</span>
              </label>
              <input type="text" placeholder="C677T or rs1801133" value={variant} onChange={e => setVariant(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[#94a3b8] text-xs font-medium block mb-1.5">
                Genotype <span className="text-[#475569] font-normal">— optional</span>
              </label>
              <input type="text" placeholder="CT" value={genotype} onChange={e => setGenotype(e.target.value)} />
            </div>
            <div>
              <label className="text-[#94a3b8] text-xs font-medium block mb-1.5">
                Result <span className="text-[#475569] font-normal">— optional</span>
              </label>
              <input type="text" placeholder="Heterozygous" value={result} onChange={e => setResult(e.target.value)} />
            </div>
          </div>

          {files.length > 0 && (
            <div>
              <label className="text-[#94a3b8] text-xs font-medium block mb-1.5">
                Source file <span className="text-[#475569] font-normal">— optional</span>
              </label>
              <select value={fileId} onChange={e => setFileId(e.target.value)}>
                <option value="">None</option>
                {files.map(f => <option key={f.id} value={f.id}>{f.original_filename}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-[#94a3b8] text-xs font-medium block mb-1.5">
              Notes <span className="text-[#475569] font-normal">— optional</span>
            </label>
            <textarea rows={2} placeholder="Taking methylated B vitamins as a result" value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'none' }} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-[#1a2540] border border-[#243450] hover:border-[#374d6c] text-[#94a3b8] text-sm font-medium py-2.5 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading || !gene.trim()} className="flex-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
              {loading ? 'Saving...' : 'Add Trait'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TraitRow({ trait, onDelete }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-[#161f30] last:border-0 hover:bg-[#0f1825]/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-white text-sm font-medium">{trait.gene}</span>
          <GeneInfoPopup gene={trait.gene} />
          {trait.variant && <span className="text-[#64748b] text-xs font-mono">{trait.variant}</span>}
          {trait.genotype && (
            <span className="text-cyan-400 text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-900">
              {trait.genotype}
            </span>
          )}
        </div>
        {trait.result && <p className="text-[#94a3b8] text-xs mt-1">{trait.result}</p>}
        {trait.notes && <p className="text-[#475569] text-xs mt-1 italic">{trait.notes}</p>}
      </div>
      {confirming ? (
        <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
          <span className="text-[#94a3b8] text-xs">Delete?</span>
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors">Yes</button>
          <button onClick={() => setConfirming(false)} className="text-xs text-[#475569] hover:text-[#94a3b8] transition-colors">No</button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="flex-shrink-0 text-[#374d6c] hover:text-red-400 transition-colors text-sm pt-0.5"
          title="Delete trait"
        >
          ✕
        </button>
      )}
    </div>
  )
}

function FileRow({ file, userId, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const isTxt = file.filename?.endsWith('.txt')

  return (
    <div className="flex items-center justify-between bg-[#131d2e] border border-[#243450] rounded-xl px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <svg className="w-4 h-4 text-[#475569] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <div className="min-w-0">
          <p className="text-white text-sm font-medium truncate">{file.original_filename}</p>
          <p className="text-[#475569] text-xs mt-0.5">{isTxt ? 'Raw data' : 'PDF'} · {new Date(file.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href={api.dnaFileUrl(userId, file.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#475569] hover:text-white text-xs font-medium px-3 py-1.5 rounded-lg border border-[#243450] hover:border-[#374d6c] transition-colors"
        >
          View
        </a>
        {confirming ? (
          <div className="flex items-center gap-1.5">
            <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors">Yes</button>
            <button onClick={() => setConfirming(false)} className="text-xs text-[#475569] hover:text-[#94a3b8] transition-colors">No</button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="text-[#374d6c] hover:text-red-400 transition-colors text-sm" title="Delete file">
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export default function DnaSection({ data, userId, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  const traits = data?.traits ?? []
  const files = data?.files ?? []

  async function handleUpload(file) {
    if (!file) return
    const nameLower = file.name.toLowerCase()
    if (!nameLower.endsWith('.pdf') && !nameLower.endsWith('.txt')) {
      setError('Please upload a PDF or .txt file.')
      return
    }
    setError(null)
    setUploading(true)
    try {
      await api.uploadDnaFile(userId, file)
      onRefresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleFileInput(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) handleUpload(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  return (
    <section id="dna" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-cyan-500" />
          <h2 className="text-white text-xl font-semibold">DNA</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span className="text-base leading-none">+</span>
            Add Trait
          </button>
          <button onClick={() => setShowRaw(true)} className="font-mono text-[10px] text-[#243450] hover:text-[#475569] px-1 transition-colors" title="raw data">{'{}'}</button>
        </div>
      </div>

      {/* Traits list */}
      {traits.length === 0 ? (
        <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-12 text-center mb-6">
          <p className="text-[#374d6c] text-4xl mb-3">🧬</p>
          <p className="text-[#475569] text-sm">No traits logged yet. Add one manually — e.g. MTHFR.</p>
        </div>
      ) : (
        <div className="bg-[#131d2e] border border-[#243450] rounded-2xl overflow-hidden mb-6">
          {traits.map(t => (
            <TraitRow key={t.id} trait={t} onDelete={async () => { await api.deleteDnaTrait(userId, t.id); onRefresh() }} />
          ))}
        </div>
      )}

      {/* Raw test files */}
      <div>
        <h3 className="text-[#94a3b8] text-sm font-medium mb-3">Test Files</h3>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed transition-colors flex items-center justify-center gap-2.5 py-3.5 select-none mb-4
            ${dragging ? 'border-cyan-500 bg-cyan-500/5' : 'border-[#243450] bg-[#131d2e] hover:border-[#374d6c] hover:bg-[#111827]'}`}
        >
          <input ref={fileInputRef} type="file" accept=".pdf,.PDF,.txt,.TXT" className="hidden" onChange={handleFileInput} />
          {uploading ? (
            <svg className="w-4 h-4 text-cyan-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-[#475569]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          )}
          <p className="text-[#94a3b8] text-xs font-medium">
            {uploading ? 'Uploading…' : 'Drop a PDF or .txt raw-data file, or click to browse'}
          </p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-950 border border-red-800 text-red-300 text-sm flex items-center justify-between gap-3">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)} className="opacity-50 hover:opacity-100">✕</button>
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-col gap-2">
            {files.map(f => (
              <FileRow key={f.id} file={f} userId={userId} onDelete={async () => { await api.deleteDnaFile(userId, f.id); onRefresh() }} />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <TraitModal
          files={files}
          onClose={() => setShowAdd(false)}
          onSave={async (trait) => {
            await api.addDnaTrait(userId, trait)
            onRefresh()
            setShowAdd(false)
          }}
        />
      )}
      {showRaw && <RawDataModal label="dna" data={data} onClose={() => setShowRaw(false)} />}
    </section>
  )
}

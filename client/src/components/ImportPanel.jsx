import { useState, useEffect } from 'react'
import { api } from '../api'

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#1d2a3e] text-[#64748b] text-[10px] font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[#94a3b8] text-xs font-semibold mb-1">{title}</p>
        {children}
      </div>
    </div>
  )
}

function CopyField({ value }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for non-HTTPS
      const el = document.createElement('textarea')
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 bg-[#070b12] border border-[#1d2a3e] rounded-lg px-3 py-2 min-w-0">
        <p className="text-[#475569] text-[10px] font-mono break-all leading-relaxed">{value}</p>
      </div>
      <button
        onClick={handleCopy}
        className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
          copied
            ? 'bg-emerald-900 text-emerald-400 border border-emerald-700'
            : 'bg-[#1d2a3e] hover:bg-[#2d3d58] text-[#94a3b8] border border-[#2d3d58]'
        }`}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Setting({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#1d2a3e] last:border-0">
      <span className="text-[#475569] text-xs">{label}</span>
      <span className={`text-xs font-medium font-mono ${highlight ? 'text-[#a78bfa]' : 'text-[#94a3b8]'}`}>
        {value}
      </span>
    </div>
  )
}

export default function ImportPanel({ userId, onClose }) {
  const [stats, setStats] = useState(null)

  const webhookUrl = `${window.location.origin}/api/${userId}/import/apple-health`

  useEffect(() => {
    api.getImportStats(userId)
      .then(setStats)
      .catch(() => setStats(null))
  }, [userId])

  const lastSync  = stats?.apple_health?.last_date
  const syncCount = stats?.apple_health?.count ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(7,11,18,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1d2a3e]">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🍎</span>
            <div>
              <h2 className="text-white font-semibold text-sm">Apple Health Sync</h2>
              <p className="text-[#475569] text-xs">via Health Auto Export</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5">

          {/* Status badge */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
            syncCount > 0
              ? 'bg-emerald-950 border-emerald-800'
              : 'bg-[#0a0f1a] border-[#1d2a3e]'
          }`}>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${syncCount > 0 ? 'bg-emerald-400' : 'bg-[#2d3d58]'}`} />
            <div>
              {syncCount > 0 ? (
                <>
                  <p className="text-emerald-400 text-xs font-semibold">Connected</p>
                  <p className="text-[#475569] text-xs">{syncCount} entries · last: {lastSync}</p>
                </>
              ) : (
                <>
                  <p className="text-[#475569] text-xs font-semibold">Not yet connected</p>
                  <p className="text-[#2d3d58] text-xs">Follow the steps below</p>
                </>
              )}
            </div>
          </div>

          {/* Step 1 */}
          <Step n="1" title="Copy your webhook URL">
            <p className="text-[#475569] text-xs mb-1">Paste this into the Health Auto Export app on your iPhone.</p>
            <CopyField value={webhookUrl} />
          </Step>

          {/* Step 2 */}
          <Step n="2" title="Configure Health Auto Export on iPhone">
            <p className="text-[#475569] text-xs mb-2">
              Open the app → <span className="text-[#64748b]">Automations</span> → <span className="text-[#64748b]">+ New</span> → <span className="text-[#64748b]">REST API</span>. Create <span className="text-[#94a3b8] font-medium">two automations</span> with the same URL — one for metrics, one for workouts.
            </p>
            <p className="text-[#475569] text-[11px] font-semibold mb-1 mt-2">Automation 1 — Health Metrics</p>
            <div className="bg-[#070b12] border border-[#1d2a3e] rounded-xl px-4 py-1 mb-3">
              <Setting label="URL"            value="← paste above"      highlight />
              <Setting label="Method"         value="POST" />
              <Setting label="Data Type"      value="Health Metrics" />
              <Setting label="Export Format"  value="JSON" />
              <Setting label="Aggregate Data" value="Enabled" />
              <Setting label="Interval"       value="Days" />
              <Setting label="Batch Requests" value="Enabled" />
            </div>
            <p className="text-[#475569] text-[11px] font-semibold mb-1">Automation 2 — Workouts <span className="text-[#f97316] font-normal">(needed for exercise data)</span></p>
            <div className="bg-[#070b12] border border-[#1d2a3e] rounded-xl px-4 py-1">
              <Setting label="URL"            value="← same URL"         highlight />
              <Setting label="Method"         value="POST" />
              <Setting label="Data Type"      value="Workouts" />
              <Setting label="Export Format"  value="JSON" />
              <Setting label="Batch Requests" value="Enabled" />
            </div>
          </Step>

          {/* Step 3 */}
          <Step n="3" title="Trigger first sync">
            <p className="text-[#475569] text-xs mb-2">
              In the app, tap <span className="text-[#64748b]">Manual Export</span>, pick a date range, and send.
              Future syncs run automatically on your chosen interval.
            </p>
            <div className="bg-[#070b12] border border-[#1d2a3e] rounded-xl px-4 py-3">
              <p className="text-[#2d3d58] text-xs">
                The sync is <span className="text-[#475569]">inbound</span> — the HAE app pushes data here.
                Once sent, your weight history will appear in the chart above.
              </p>
            </div>
          </Step>

        </div>
      </div>
    </div>
  )
}

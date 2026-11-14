import { useMemo, useState } from 'react'
import { ArrowDownToLine, Check, GitMerge, RotateCcw, TriangleAlert } from 'lucide-react'
import { preserveEditedLineEndings } from '../lib/text'
import { findMergeConflicts, type Conflict } from '../lib/merge'
import { ExternalLaunchError } from '../lib/external-launch'
import { useLanguage } from '../i18n'
import './merge.css'

export type MergeInputs = {
  baseName: string
  localName: string
  remoteName: string
  mergedName: string
  baseText: string
  localText: string
  remoteText: string
  mergedText: string
}

function preview(text: string, emptyLabel: string): string {
  const first = text.trim().split(/\r\n|\r|\n/).slice(0, 2).join(' · ')
  return first.length > 130 ? `${first.slice(0, 130)}…` : first || emptyLabel
}

export default function MergeWorkspace({ inputs, onSave, onCancel }: {
  inputs: MergeInputs
  onSave: (text: string) => Promise<void>
  onCancel: () => void
}) {
  const { tr } = useLanguage()
  const [mergedText, setMergedText] = useState(inputs.mergedText)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const conflicts = useMemo(() => findMergeConflicts(mergedText), [mergedText])
  const hasMarker = /^(?:<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)/m.test(mergedText)

  function resolve(conflict: Conflict, choice: 'local' | 'remote' | 'both') {
    const replacement = choice === 'local' ? conflict.local : choice === 'remote' ? conflict.remote : conflict.local + conflict.remote
    setMergedText((current) => current.slice(0, conflict.start) + replacement + current.slice(conflict.end))
    setError('')
  }

  async function save() {
    if (hasMarker) { setError('结果中仍有冲突标记，请解决后再完成合并。'); return }
    setSaving(true)
    setError('')
    try { await onSave(mergedText) }
    catch (cause) { setError(cause instanceof ExternalLaunchError ? cause.message : '写入合并结果失败'); setSaving(false) }
  }

  return <div className="merge-workspace">
    <section className="workspace-card merge-intro">
      <div className="merge-intro__icon"><GitMerge size={23} /></div>
      <div><span className="eyebrow">{tr('外部工具调用', 'External tool launch')}</span><h2>{tr('三方合并', 'Three-way merge')} · {inputs.mergedName}</h2><p>{tr('查看共同基线、当前分支和传入分支，解决冲突后写回 Git 指定的结果文件。', 'Review the common base, current branch, and incoming branch. Resolve conflicts, then write the result to the file specified by Git.')}</p></div>
      <button className="button button-secondary" type="button" onClick={onCancel}>{tr('取消合并', 'Cancel merge')}</button>
    </section>

    <section className="merge-references" aria-label={tr('三方版本', 'Three merge versions')}>
      {([
        [tr('共同基线', 'Common base'), inputs.baseName, inputs.baseText, 'base'],
        [tr('当前分支', 'Current branch'), inputs.localName, inputs.localText, 'local'],
        [tr('传入分支', 'Incoming branch'), inputs.remoteName, inputs.remoteText, 'remote'],
      ] as const).map(([label, name, content, side]) => <div className={`workspace-card merge-reference merge-reference--${side}`} key={side}>
        <div className="merge-reference__head"><strong>{label}</strong><span title={name}>{name}</span></div>
        <pre>{content || tr('（空文件）', '(empty file)')}</pre>
      </div>)}
    </section>

    <section className="workspace-card merge-result">
      <div className="card-titlebar merge-result__head"><div><span className="eyebrow">{tr('最终结果', 'Final result')}</span><h2>{tr('编辑合并结果', 'Edit merge result')} <span className={`result-count ${conflicts.length ? 'merge-result__count--pending' : ''}`}>{conflicts.length ? tr(`${conflicts.length} 处待处理`, `${conflicts.length} to resolve`) : tr('冲突已解决', 'Conflicts resolved')}</span></h2></div><div className="card-actions"><button className="button button-secondary" type="button" onClick={() => { setMergedText(inputs.mergedText); setError('') }}><RotateCcw size={15} /> {tr('重置', 'Reset')}</button><button className="button button-primary" type="button" disabled={saving || hasMarker} onClick={() => void save()}><ArrowDownToLine size={15} /> {saving ? tr('正在写入…', 'Writing…') : tr('完成合并并写回', 'Complete merge and write back')}</button></div></div>
      {conflicts.length > 0 && <div className="merge-conflicts" aria-label={tr('冲突列表', 'Conflict list')}>{conflicts.map((conflict) => <div className="merge-conflict" key={conflict.start}><div className="merge-conflict__text"><strong>{tr(`冲突 ${conflict.number}`, `Conflict ${conflict.number}`)}</strong><span title={preview(conflict.local, tr('（空内容）', '(empty content)'))}>{preview(conflict.local, tr('（空内容）', '(empty content)'))} ↔ {preview(conflict.remote, tr('（空内容）', '(empty content)'))}</span></div><div className="merge-conflict__actions"><button type="button" onClick={() => resolve(conflict, 'local')}>{tr('采用当前', 'Use current')}</button><button type="button" onClick={() => resolve(conflict, 'remote')}>{tr('采用传入', 'Use incoming')}</button><button type="button" onClick={() => resolve(conflict, 'both')}>{tr('保留两侧', 'Keep both')}</button></div></div>)}</div>}
      {hasMarker && conflicts.length === 0 && <div className="merge-warning"><TriangleAlert size={16} /> {tr('检测到未成对的冲突标记，请在结果中手动处理。', 'Unpaired conflict markers were found. Resolve them manually in the result.')}</div>}
      {!hasMarker && <div className="merge-ready"><Check size={15} /> {tr('结果中没有冲突标记，可继续编辑或写回 Git。', 'No conflict markers remain. Continue editing or write the result back to Git.')}</div>}
      <label className="merge-editor-label" htmlFor="merge-output">{tr('合并结果', 'Merge result')} · {inputs.mergedName}</label>
      <textarea id="merge-output" className="merge-editor" spellCheck={false} value={mergedText} onChange={(event) => { const edited = event.currentTarget.value; setMergedText((previous) => preserveEditedLineEndings(previous, edited)); setError('') }} />
      {error && <div className="inline-error" role="alert">{error === '结果中仍有冲突标记，请解决后再完成合并。' ? tr(error, 'Conflict markers remain in the result. Resolve them before completing the merge.') : error === '外部合并只能在桌面应用中保存。' ? tr(error, 'An external merge can only be saved in the desktop app.') : tr(error, 'Failed to write the merge result')}</div>}
      <div className="table-footnote">{tr('“完成合并并写回”会更新 Git 提供的 MERGED 文件；关闭窗口或取消时不会标记合并成功。', '“Complete merge and write back” updates the MERGED file provided by Git. Closing or canceling does not mark the merge as successful.')}</div>
    </section>
  </div>
}

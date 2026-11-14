import { useRef, useState } from 'react'
import { FileUp, X } from 'lucide-react'
import { formatBytes } from '../lib/files'
import { useLanguage } from '../i18n'

type Props = {
  side: 'left' | 'right'
  file?: File | null
  accept?: string
  hint: string
  onFile: (file: File | null) => void
  compact?: boolean
}

export default function FileDropzone({ side, file, accept, hint, onFile, compact = false }: Props) {
  const { tr } = useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={`file-dropzone ${dragging ? 'is-dragging' : ''} ${compact ? 'is-compact' : ''} ${file ? 'has-file' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const dropped = event.dataTransfer.files[0]
        if (dropped) onFile(dropped)
      }}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={accept}
        aria-label={side === 'left' ? tr('选择原始文件', 'Select original file') : tr('选择修改后文件', 'Select modified file')}
        onChange={(event) => {
          onFile(event.target.files?.[0] ?? null)
          event.currentTarget.value = ''
        }}
      />
      <div className="file-dropzone__icon"><FileUp size={19} strokeWidth={1.8} /></div>
      <div className="file-dropzone__copy">
        <div className="file-dropzone__name">{file ? file.name : side === 'left' ? tr('选择原始文件', 'Select original file') : tr('选择修改后文件', 'Select modified file')}</div>
        <div className="file-dropzone__hint">{file ? `${formatBytes(file.size)} · ${tr('点击可更换', 'Click to replace')}` : hint}</div>
      </div>
      <button className="file-dropzone__pick" type="button" onClick={() => inputRef.current?.click()}>
        {file ? tr('更换', 'Replace') : tr('浏览文件', 'Browse files')}
      </button>
      {file && (
        <button className="icon-button subtle" type="button" aria-label={tr('移除文件', 'Remove file')} title={tr('移除文件', 'Remove file')} onClick={() => onFile(null)}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Check, Clipboard, GitBranch, Terminal, X } from 'lucide-react'
import { isTauriApp } from '../lib/files'
import { getExternalToolPath } from '../lib/external-launch'
import { useLanguage } from '../i18n'
import './integration.css'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function shellDoubleQuote(value: string): string {
  return `"${value.replaceAll(/[\\"$`]/g, '\\$&')}"`
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function isAbsoluteExecutablePath(value: string): boolean {
  return !/[\r\n\0]/.test(value) && !/[\\/]$/.test(value) && (value.startsWith('/') || isWindowsPath(value))
}

export function gitConfigCommands(executablePath: string): { diff: string; merge: string } {
  const windows = isWindowsPath(executablePath)
  const binary = shellDoubleQuote(windows ? executablePath.replaceAll('\\', '/') : executablePath)
  const configQuote = windows ? powershellQuote : shellQuote
  return {
    diff: [
      'git config --global diff.tool mgdiff',
      `git config --global difftool.mgdiff.cmd ${configQuote(`${binary} --diff "$LOCAL" "$REMOTE"`)}`,
      'git config --global difftool.prompt false',
    ].join('\n'),
    merge: [
      'git config --global merge.tool mgdiff',
      `git config --global mergetool.mgdiff.cmd ${configQuote(`${binary} --merge "$BASE" "$LOCAL" "$REMOTE" "$MERGED"`)}`,
      'git config --global mergetool.mgdiff.trustExitCode true',
    ].join('\n'),
  }
}

type PathSource = 'loading' | 'desktop' | 'local-build' | 'manual' | 'unavailable'
type CopyKind = 'path' | 'verify' | 'diff' | 'merge'

export default function IntegrationPanel({ onClose }: { onClose: () => void }) {
  const { tr } = useLanguage()
  const [executablePath, setExecutablePath] = useState('')
  const [pathSource, setPathSource] = useState<PathSource>('loading')
  const [copied, setCopied] = useState<CopyKind | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    async function findPath() {
      try {
        if (isTauriApp()) {
          const path = await getExternalToolPath()
          if (mounted && path && isAbsoluteExecutablePath(path)) {
            setExecutablePath(path)
            setPathSource('desktop')
            return
          }
        } else if (import.meta.env.DEV) {
          const response = await fetch('/__mgdiff/cli-path')
          if (response.ok) {
            const result: { path?: unknown } = await response.json()
            if (mounted && typeof result.path === 'string' && isAbsoluteExecutablePath(result.path)) {
              setExecutablePath(result.path)
              setPathSource('local-build')
              return
            }
          }
        }
      } catch { /* No discoverable executable in a browser build or after a failed native call. */ }
      if (mounted) setPathSource('unavailable')
    }
    void findPath()
    return () => { mounted = false }
  }, [])

  const pathReady = isAbsoluteExecutablePath(executablePath)
  const commands = pathReady ? gitConfigCommands(executablePath) : null
  const verifyCommand = pathReady ? isWindowsPath(executablePath)
    ? `& ${powershellQuote(executablePath)} --help`
    : `${shellQuote(executablePath)} --help` : ''

  async function copy(kind: CopyKind) {
    const value = kind === 'path' ? executablePath : kind === 'verify' ? verifyCommand : commands?.[kind]
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setError('')
    } catch { setError(tr('复制失败，请手动选中内容复制。', 'Copy failed. Select and copy the text manually.')) }
  }

  function copyButton(kind: CopyKind, label: string) {
    return <button className="button button-secondary" type="button" disabled={!pathReady} onClick={() => void copy(kind)}>{copied === kind ? <Check size={15} /> : <Clipboard size={15} />}{copied === kind ? tr('已复制', 'Copied') : label}</button>
  }

  return <div className="integration-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="integration-dialog" role="dialog" aria-modal="true" aria-labelledby="integration-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className="integration-head"><div className="integration-head__icon"><GitBranch size={21} /></div><div><span className="eyebrow">{tr('外部工具调用', 'External tool launch')}</span><h2 id="integration-title">{tr('Git 与命令行集成', 'Git and command-line integration')}</h2></div><button className="icon-button" type="button" aria-label={tr('关闭工具集成', 'Close tool integration')} onClick={onClose}><X size={18} /></button></div>
      <p className="integration-intro">{tr('MGDiff 可从终端接收文件或目录路径，也可作为 Git 的对比与合并工具。请使用下方的可执行文件绝对路径。', 'MGDiff accepts file or folder paths from a terminal and can serve as a Git diff and merge tool. Use the absolute executable path below.')}</p>
      <div className="integration-path" aria-live="polite">
        <strong>{tr('程序路径', 'Executable path')}</strong>
        <code title={executablePath || undefined}>{executablePath || (pathSource === 'loading' ? tr('正在查找…', 'Finding executable…') : tr('尚未找到可执行文件', 'Executable not found'))}</code>
        {pathReady && copyButton('path', tr('复制路径', 'Copy path'))}
      </div>
      {pathSource === 'local-build' && <p className="integration-note">{tr('已找到本机的构建产物。浏览器页面不能接收命令行参数；请在终端使用该路径运行桌面程序。', 'Found a local build. This browser page cannot receive command-line arguments; run the desktop executable from a terminal using this path.')}</p>}
      {pathSource === 'desktop' && <p className="integration-note">{tr('这是当前桌面程序的实际路径。MGDiff 不会自动加入系统 PATH。', 'This is the running desktop executable. MGDiff is not automatically added to your system PATH.')}</p>}
      {pathReady && isWindowsPath(executablePath) && <p className="integration-note">{tr('以下命令适用于 Windows PowerShell；Git 配置中的程序路径会使用正斜杠。', 'Run these commands in Windows PowerShell. The Git tool path uses forward slashes.')}</p>}
      {(pathSource === 'unavailable' || pathSource === 'manual') && <div className="integration-manual">
        {pathSource === 'unavailable' && <p>{isTauriApp()
          ? tr('无法读取当前程序路径，请输入实际可执行文件的绝对路径。', 'Could not read the running executable path. Enter its actual absolute path.')
          : tr('未找到桌面可执行文件。请先运行 npm run tauri build 或安装桌面应用，再输入实际文件的绝对路径。', 'No desktop executable was found. Run npm run tauri build or install the desktop app, then enter the actual executable’s absolute path.')}</p>}
        <label htmlFor="integration-executable-path">{tr('可执行文件绝对路径', 'Absolute executable path')}</label>
        <input id="integration-executable-path" type="text" spellCheck={false} value={executablePath} onChange={(event) => { setExecutablePath(event.target.value); setPathSource('manual'); setCopied(null) }} aria-describedby="integration-path-help" />
        <small id="integration-path-help">{pathReady ? tr('请确认此文件存在且可执行。', 'Confirm this file exists and is executable.') : tr('macOS 构建产物位于项目目录/src-tauri/target/release/bundle/macos/MGDiff.app/Contents/MacOS/mgdiff', 'A macOS build is at project directory/src-tauri/target/release/bundle/macos/MGDiff.app/Contents/MacOS/mgdiff')}</small>
      </div>}
      <div className="integration-section">
        <div className="integration-section__head"><div><Terminal size={17} /><strong>{tr('命令行验证', 'Verify the CLI')}</strong></div>{copyButton('verify', tr('复制命令', 'Copy command'))}</div>
        {pathReady ? <pre>{verifyCommand}</pre> : <p>{tr('找到或输入实际程序路径后，这里会显示可直接运行的验证命令。', 'The runnable verification command appears here after an executable path is found or entered.')}</p>}
      </div>
      <div className="integration-section">
        <div className="integration-section__head"><div><Terminal size={17} /><strong>{tr('对比工具', 'Diff tool')}</strong><span>git difftool</span></div>{copyButton('diff', tr('复制命令', 'Copy commands'))}</div>
        {commands ? <pre>{commands.diff}</pre> : <p>{tr('需要可执行文件绝对路径才能生成 Git 配置命令。', 'An absolute executable path is required to generate Git configuration commands.')}</p>}
        <p>{tr('配置后运行', 'After setup, run')} <code>git difftool -y</code>{tr('。目录对比可用', '. For folder comparisons, use')} <code>git difftool --dir-diff --no-symlinks -y</code>{tr('。', '.')}</p>
      </div>
      <div className="integration-section">
        <div className="integration-section__head"><div><GitBranch size={17} /><strong>{tr('合并工具', 'Merge tool')}</strong><span>git mergetool</span></div>{copyButton('merge', tr('复制命令', 'Copy commands'))}</div>
        {commands ? <pre>{commands.merge}</pre> : <p>{tr('需要可执行文件绝对路径才能生成 Git 配置命令。', 'An absolute executable path is required to generate Git configuration commands.')}</p>}
        <p>{tr('冲突时运行', 'When conflicts occur, run')} <code>git mergetool</code>{tr('，在 MGDiff 内解决冲突并点击“完成合并并写回”。', ', resolve conflicts in MGDiff, then click “Complete merge and write back”.')}</p>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="integration-foot">{tr('其他工具也可用上述绝对路径调用', 'Other tools can use the absolute path above to call')} <code>--diff LEFT RIGHT</code> {tr('或', 'or')} <code>--merge BASE LOCAL REMOTE MERGED</code>{tr('。', '.')}</div>
    </div>
  </div>
}

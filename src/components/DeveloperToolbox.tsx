import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle, Binary, Braces, CalendarDays, Check, Clock3, CodeXml, Copy,
  FileCode2, Fingerprint, Hash, Link2, Network, Regex, Search, ShieldCheck,
  WandSparkles, type LucideIcon,
} from 'lucide-react'
import { useLanguage } from '../i18n'
import {
  addDate, analyzeIp, convertBase, dateDifference, decodeBase64, decodeHtml, decodeJwt,
  encodeBase64, encodeHtml, formatJson, formatLocalDateTime, minifyJson, parseDateInput, parseTimestamp,
} from '../lib/devtools'
import { useWorkspaceState } from '../lib/workspace-state'
import DateTimePicker from './DateTimePicker'
import Dropdown from './Dropdown'
import './developer-toolbox.css'

type ToolId = 'json' | 'timestamp' | 'date' | 'base' | 'ip' | 'base64' | 'url' | 'html' | 'hash' | 'uuid' | 'jwt' | 'regex'
type ToolGroup = 'data' | 'time' | 'network' | 'encoding' | 'security' | 'text'
type ToolDefinition = { id: ToolId; group: ToolGroup; title: [string, string]; description: [string, string]; icon: LucideIcon; keywords: string }

const tools: ToolDefinition[] = [
  { id: 'json', group: 'data', title: ['JSON 格式化', 'JSON formatter'], description: ['校验、缩进与压缩', 'Validate, indent, and minify'], icon: Braces, keywords: 'json format minify validate 格式化 压缩 校验' },
  { id: 'timestamp', group: 'time', title: ['时间戳转换', 'Timestamp converter'], description: ['Unix 秒 / 毫秒与日期互转', 'Convert Unix seconds, milliseconds, and dates'], icon: Clock3, keywords: 'unix epoch timestamp 时间戳 秒 毫秒' },
  { id: 'date', group: 'time', title: ['日期计算', 'Date calculator'], description: ['日期加减与间隔', 'Add dates and calculate intervals'], icon: CalendarDays, keywords: 'date time difference add 日期 计算 间隔' },
  { id: 'base', group: 'data', title: ['进制转换', 'Base converter'], description: ['2–36 进制大整数转换', 'Convert large integers from base 2 to 36'], icon: Binary, keywords: 'binary decimal hex octal 进制 二进制 十六进制' },
  { id: 'ip', group: 'network', title: ['IPv4 / IPv6', 'IPv4 / IPv6'], description: ['地址校验与 CIDR 范围', 'Validate addresses and CIDR ranges'], icon: Network, keywords: 'ip ipv4 ipv6 cidr subnet 子网 地址' },
  { id: 'base64', group: 'encoding', title: ['Base64', 'Base64'], description: ['UTF-8 文本编解码', 'Encode and decode UTF-8 text'], icon: FileCode2, keywords: 'base64 utf8 encode decode 编码 解码' },
  { id: 'url', group: 'encoding', title: ['URL 编解码', 'URL encoder'], description: ['组件编解码与网址解析', 'Encode components and inspect URLs'], icon: Link2, keywords: 'url uri percent encode decode query 网址 参数' },
  { id: 'html', group: 'encoding', title: ['HTML 实体', 'HTML entities'], description: ['特殊字符转义与还原', 'Escape and unescape special characters'], icon: CodeXml, keywords: 'html entity escape unescape 转义 实体' },
  { id: 'hash', group: 'security', title: ['哈希计算', 'Hash calculator'], description: ['SHA-256 / 384 / 512', 'SHA-256 / 384 / 512'], icon: Hash, keywords: 'sha digest hash 哈希 摘要' },
  { id: 'uuid', group: 'security', title: ['UUID 生成', 'UUID generator'], description: ['生成随机 v4 标识符', 'Generate random v4 identifiers'], icon: Fingerprint, keywords: 'uuid guid random 随机 标识符' },
  { id: 'jwt', group: 'security', title: ['JWT 查看', 'JWT inspector'], description: ['解码 Header 与 Payload', 'Decode header and payload'], icon: ShieldCheck, keywords: 'jwt token json web token 令牌 解码' },
  { id: 'regex', group: 'text', title: ['正则测试', 'Regex tester'], description: ['匹配位置、分组与标志', 'Inspect matches, groups, and flags'], icon: Regex, keywords: 'regex regexp pattern match 正则 表达式 匹配' },
]
const groups: { id: ToolGroup; label: [string, string] }[] = [
  { id: 'data', label: ['数据与数字', 'Data & numbers'] },
  { id: 'time', label: ['时间', 'Time'] },
  { id: 'network', label: ['网络', 'Network'] },
  { id: 'encoding', label: ['编码', 'Encoding'] },
  { id: 'security', label: ['标识与安全', 'Identity & security'] },
  { id: 'text', label: ['文本', 'Text'] },
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Clipboard unavailable')
}

function CopyButton({ value }: { value: string }) {
  const { tr } = useLanguage()
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  async function copy() {
    try {
      await copyText(value)
      setState('copied')
    } catch {
      setState('error')
    }
    window.setTimeout(() => setState('idle'), 1800)
  }
  return <button className="devtool-copy" type="button" onClick={copy} disabled={!value} aria-label={tr('复制结果', 'Copy result')}>
    {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
    {state === 'copied' ? tr('已复制', 'Copied') : state === 'error' ? tr('复制失败', 'Copy failed') : tr('复制', 'Copy')}
  </button>
}

function ToolPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { tr } = useLanguage()
  return <section className="devtool-panel workspace-card">
    <div className="devtool-panel-head"><div><span className="eyebrow">{tr('开发工具', 'DEVELOPER TOOL')}</span><h2>{title}</h2><p>{description}</p></div></div>
    <div className="devtool-panel-body">{children}</div>
  </section>
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="devtool-field"><span className="devtool-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function Action({ children, onClick, secondary = false, disabled = false }: { children: ReactNode; onClick: () => void; secondary?: boolean; disabled?: boolean }) {
  return <button type="button" className={'button ' + (secondary ? 'button-secondary' : 'button-primary')} onClick={onClick} disabled={disabled}>{children}</button>
}

function Message({ error, children }: { error?: string | null; children?: ReactNode }) {
  if (error) return <div className="devtool-message devtool-message--error" role="alert"><AlertCircle size={16} />{error}</div>
  return children ? <div className="devtool-message devtool-message--success" role="status"><Check size={16} />{children}</div> : null
}

function Output({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return <div className="devtool-output"><div className="devtool-output-head"><span>{label}</span><CopyButton value={value} /></div>{multiline
    ? <pre>{value}</pre>
    : <code>{value}</code>}</div>
}

function JsonTool() {
  const { tr } = useLanguage()
  const [input, setInput] = useWorkspaceState('toolbox.json.input', '')
  const [indent, setIndent] = useWorkspaceState('toolbox.json.indent', 2)
  const [output, setOutput] = useWorkspaceState('toolbox.json.output', '')
  const [error, setError] = useState('')
  const [status, setStatus] = useWorkspaceState<'valid' | 'complete' | ''>('toolbox.json.status', '')
  function run(kind: 'format' | 'minify' | 'validate') {
    try {
      if (!input.trim()) throw new Error(tr('请输入 JSON', 'Enter JSON first'))
      const result = kind === 'minify' ? minifyJson(input) : formatJson(input, indent)
      setOutput(kind === 'validate' ? '' : result)
      setError('')
      setStatus(kind === 'validate' ? 'valid' : 'complete')
    } catch (cause) {
      setOutput('')
      setStatus('')
      setError(errorMessage(cause))
    }
  }
  return <ToolPanel title={tr('JSON 格式化', 'JSON formatter')} description={tr('粘贴 JSON，检查语法并生成缩进或压缩版本。', 'Paste JSON to validate its syntax and create an indented or minified version.')}>
    <Field label={tr('输入 JSON', 'Input JSON')}><textarea className="devtool-textarea" value={input} onChange={(event) => { setInput(event.target.value); setOutput(''); setStatus(''); setError('') }} spellCheck={false} placeholder='{"name":"MG Diff","items":[1,2,3]}' /></Field>
    <div className="devtool-controls"><Field label={tr('缩进空格', 'Indent spaces')}><Dropdown value={String(indent)} onChange={(value) => { setIndent(Number(value)); setOutput(''); setStatus('') }} ariaLabel={tr('缩进空格', 'Indent spaces')} options={[{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '0', label: '0' }]} /></Field><div className="devtool-actions"><Action onClick={() => run('format')}><WandSparkles size={15} />{tr('格式化', 'Format')}</Action><Action onClick={() => run('minify')} secondary>{tr('压缩', 'Minify')}</Action><Action onClick={() => run('validate')} secondary>{tr('仅校验', 'Validate only')}</Action></div></div>
    <Message error={error}>{status === 'valid' ? tr('JSON 语法有效', 'Valid JSON syntax') : status === 'complete' ? tr('转换完成', 'Conversion complete') : ''}</Message>
    {output && <Output label={tr('结果', 'Result')} value={output} multiline />}
    <p className="devtool-note">{tr('提示：重排 JSON 会按标准解析后重新生成；重复键及超出安全整数范围的数字可能发生变化。', 'Note: JSON is parsed and regenerated. Duplicate keys and numbers beyond the safe integer range may change.')}</p>
  </ToolPanel>
}

function TimestampTool() {
  const { language, tr } = useLanguage()
  const [initialNow] = useState(() => new Date())
  const [input, setInput] = useWorkspaceState('toolbox.timestamp.input', String(initialNow.getTime()))
  const [unit, setUnit] = useWorkspaceState<'auto' | 's' | 'ms'>('toolbox.timestamp.unit', 'auto')
  const [resultTimestamp, setResultTimestamp] = useWorkspaceState<number | null>('toolbox.timestamp.result', initialNow.getTime())
  const [dateInput, setDateInput] = useWorkspaceState('toolbox.timestamp.dateInput', formatLocalDateTime(initialNow, true))
  const [error, setError] = useState('')
  const result = resultTimestamp === null ? null : new Date(resultTimestamp)
  function parse() {
    try {
      const date = parseTimestamp(input, unit)
      setResultTimestamp(date.getTime())
      setDateInput(formatLocalDateTime(date, true))
      setError('')
    }
    catch (cause) { setResultTimestamp(null); setError(errorMessage(cause)) }
  }
  function fromDate() {
    try { const date = parseDateInput(dateInput); setResultTimestamp(date.getTime()); setInput(String(date.getTime())); setUnit('ms'); setError('') }
    catch (cause) { setResultTimestamp(null); setError(errorMessage(cause)) }
  }
  function now() {
    const date = new Date()
    setInput(String(date.getTime()))
    setDateInput(formatLocalDateTime(date, true))
    setUnit('ms')
    setResultTimestamp(date.getTime())
    setError('')
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return <ToolPanel title={tr('时间戳转换', 'Timestamp converter')} description={tr('Unix 时间戳与本地日期互转，同时查看 UTC 时间。', 'Convert Unix timestamps and local dates, with UTC alongside.')}>
    <div className="devtool-timezone-row"><span>{tr('本机时区：', 'Device time zone: ')}{timezone}</span><Action onClick={now} secondary><Clock3 size={15} />{tr('设为当前时间', 'Set current time')}</Action></div>
    <h3 className="devtool-subheading">{tr('时间戳 → 时间', 'Timestamp → date and time')}</h3>
    <div className="devtool-grid-2"><Field label={tr('Unix 时间戳', 'Unix timestamp')}><input value={input} onChange={(event) => { setInput(event.target.value); setResultTimestamp(null); setError('') }} inputMode="numeric" placeholder="1731542400" /></Field><Field label={tr('单位', 'Unit')}><Dropdown value={unit} onChange={(value) => { setUnit(value as 'auto' | 's' | 'ms'); setResultTimestamp(null); setError('') }} ariaLabel={tr('单位', 'Unit')} options={[{ value: 'auto', label: tr('自动识别', 'Auto detect') }, { value: 's', label: tr('秒', 'Seconds') }, { value: 'ms', label: tr('毫秒', 'Milliseconds') }]} /></Field></div>
    <div className="devtool-actions"><Action onClick={parse}>{tr('转为日期时间', 'Convert to date and time')}</Action></div>
    <div className="devtool-divider" />
    <h3 className="devtool-subheading">{tr('时间 → 时间戳', 'Date and time → timestamp')}</h3>
    <DateTimePicker label={tr('本地日期时间', 'Local date and time')} value={dateInput} onChange={(value) => { setDateInput(value); setResultTimestamp(null); setError('') }} hint={tr('可手动输入，或点击日历选择；时区偏移可区分夏令时的重复时刻。', 'Type a date and time, or choose it from the calendar. The UTC offset disambiguates repeated daylight-saving times.')} includeOffset />
    <div className="devtool-actions"><Action onClick={fromDate}>{tr('转为时间戳', 'Convert to timestamp')}</Action></div>
    <Message error={error} />
    {result && <div className="devtool-output-grid"><Output label={tr('本地时间', 'Local time')} value={result.toLocaleString(language, { dateStyle: 'full', timeStyle: 'long' })} /><Output label="UTC / ISO 8601" value={result.toISOString()} /><Output label={tr('Unix 秒', 'Unix seconds')} value={String(Math.floor(result.getTime() / 1000))} /><Output label={tr('Unix 毫秒', 'Unix milliseconds')} value={String(result.getTime())} /></div>}
  </ToolPanel>
}

function BaseTool() {
  const { tr } = useLanguage()
  const [value, setValue] = useWorkspaceState('toolbox.base.value', '255')
  const [fromBase, setFromBase] = useWorkspaceState('toolbox.base.fromBase', 10)
  const [toBase, setToBase] = useWorkspaceState('toolbox.base.toBase', 36)
  const [results, setResults] = useWorkspaceState<{ base: number; value: string }[]>('toolbox.base.results', [])
  const [error, setError] = useState('')
  function run() {
    try {
      const bases = Array.from(new Set([2, 8, 10, 16, toBase]))
      const next = bases.map((base) => ({ base, value: convertBase(value, fromBase, base) }))
      setResults(next)
      setError('')
    } catch (cause) { setResults([]); setError(errorMessage(cause)) }
  }
  return <ToolPanel title={tr('进制转换', 'Base converter')} description={tr('使用大整数计算，避免普通数字的精度限制。', 'Uses big integers to avoid ordinary number precision limits.')}>
    <div className="devtool-grid-3"><Field label={tr('输入整数', 'Input integer')}><input value={value} onChange={(event) => { setValue(event.target.value); setResults([]); setError('') }} spellCheck={false} placeholder="255" /></Field><Field label={tr('输入进制', 'Input base')}><input type="number" min={2} max={36} value={fromBase} onChange={(event) => { setFromBase(Number(event.target.value)); setResults([]); setError('') }} /></Field><Field label={tr('额外输出进制', 'Extra output base')}><input type="number" min={2} max={36} value={toBase} onChange={(event) => { setToBase(Number(event.target.value)); setResults([]); setError('') }} /></Field></div>
    <div className="devtool-actions"><Action onClick={run}>{tr('转换', 'Convert')}</Action></div>
    <Message error={error} />
    {results.length > 0 && <div className="devtool-output-grid">{results.map((item) => <Output key={item.base} label={tr('进制 ', 'Base ') + item.base} value={item.value} />)}</div>}
    <p className="devtool-note">{tr('支持 2–36 进制及负数。字母 A–Z 对应 10–35。', 'Supports bases 2–36 and negative integers. A–Z represent 10–35.')}</p>
  </ToolPanel>
}

function IpTool() {
  const { tr } = useLanguage()
  const [input, setInput] = useWorkspaceState('toolbox.ip.input', '192.168.1.10/24')
  const [result, setResult] = useWorkspaceState<ReturnType<typeof analyzeIp> | null>('toolbox.ip.result', null)
  const [error, setError] = useState('')
  function run() {
    try { setResult(analyzeIp(input)); setError('') }
    catch (cause) { setResult(null); setError(errorMessage(cause)) }
  }
  const categoryNames: Record<string, [string, string]> = {
    private: ['私有地址', 'Private'], public: ['公网地址', 'Public'], loopback: ['环回地址', 'Loopback'],
    'link-local': ['链路本地地址', 'Link-local'], multicast: ['组播地址', 'Multicast'],
    unspecified: ['未指定地址', 'Unspecified'], reserved: ['保留地址', 'Reserved'],
    documentation: ['文档示例地址', 'Documentation'], 'unique-local': ['唯一本地地址', 'Unique local'],
    broadcast: ['广播地址', 'Broadcast'], shared: ['共享地址', 'Shared'],
    benchmarking: ['基准测试地址', 'Benchmarking'], 'ipv4-mapped': ['IPv4 映射地址', 'IPv4-mapped'],
  }
  return <ToolPanel title={tr('IPv4 / IPv6 地址分析', 'IPv4 / IPv6 address analyzer')} description={tr('校验地址或 CIDR，查看规范形式和网络范围。', 'Validate an address or CIDR and inspect its canonical form and range.')}>
    <div className="devtool-inline"><Field label={tr('IP 地址或 CIDR', 'IP address or CIDR')}><input value={input} onChange={(event) => { setInput(event.target.value); setResult(null); setError('') }} spellCheck={false} placeholder="2001:db8::1/64" /></Field><Action onClick={run}>{tr('分析地址', 'Analyze address')}</Action></div>
    <Message error={error} />
    {result && <div className="devtool-output-grid">
      <Output label={tr('地址类型', 'Version')} value={'IPv' + result.version} />
      <Output label={tr('地址类别', 'Category')} value={categoryNames[result.category] ? tr(...categoryNames[result.category]) : result.category} />
      <Output label={tr('规范地址', 'Canonical address')} value={result.normalized} />
      {result.prefixLength !== null && <Output label="CIDR" value={result.cidr ?? ''} />}
      {result.version === 6 && result.expanded && <Output label={tr('展开形式', 'Expanded form')} value={result.expanded} />}
      {result.version === 6 && result.compressed && <Output label={tr('压缩形式', 'Compressed form')} value={result.compressed} />}
      <Output label={tr('网络地址', 'Network address')} value={result.networkAddress} />
      <Output label={tr('范围起点', 'Range start')} value={result.firstAddress} />
      <Output label={tr('范围终点', 'Range end')} value={result.lastAddress} />
      <Output label={tr('地址数量', 'Address count')} value={result.addressCount} />
    </div>}
    <p className="devtool-note">{tr('CIDR 范围显示全部地址；不把首尾地址自动扣除为“可用主机”。', 'CIDR ranges include every address; endpoints are not automatically removed as “usable hosts”.')}</p>
  </ToolPanel>
}

function DateTool() {
  const { language, tr } = useLanguage()
  const [source, setSource] = useWorkspaceState('toolbox.date.source', () => formatLocalDateTime(new Date()))
  const [amount, setAmount] = useWorkspaceState('toolbox.date.amount', 1)
  const [unit, setUnit] = useWorkspaceState<'days' | 'weeks' | 'months' | 'years'>('toolbox.date.unit', 'days')
  const [calculatedTimestamp, setCalculatedTimestamp] = useWorkspaceState<number | null>('toolbox.date.calculated', null)
  const [diffA, setDiffA] = useWorkspaceState('toolbox.date.diffA', () => formatLocalDateTime(new Date()))
  const [diffB, setDiffB] = useWorkspaceState('toolbox.date.diffB', () => formatLocalDateTime(new Date(Date.now() + 86400000)))
  const [difference, setDifference] = useWorkspaceState<ReturnType<typeof dateDifference> | null>('toolbox.date.difference', null)
  const [error, setError] = useState('')
  const calculated = calculatedTimestamp === null ? null : new Date(calculatedTimestamp)
  function calculate(sign: number) {
    try { setCalculatedTimestamp(addDate(source, sign * amount, unit).getTime()); setError('') }
    catch (cause) { setCalculatedTimestamp(null); setError(errorMessage(cause)) }
  }
  function compare() {
    try { setDifference(dateDifference(diffA, diffB)); setError('') }
    catch (cause) { setDifference(null); setError(errorMessage(cause)) }
  }
  const total = Math.abs(difference?.milliseconds ?? 0)
  const days = Math.floor(total / 86400000)
  const hours = Math.floor((total % 86400000) / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  return <ToolPanel title={tr('日期计算', 'Date calculator')} description={tr('在本地时间上加减日期，并计算两个时间点的间隔。', 'Add or subtract calendar dates and calculate the interval between two moments.')}>
    <h3 className="devtool-subheading">{tr('日期加减', 'Add or subtract')}</h3>
    <div className="devtool-grid-3"><DateTimePicker label={tr('起始日期时间', 'Start date and time')} value={source} onChange={(value) => { setSource(value); setCalculatedTimestamp(null); setError('') }} /><Field label={tr('数量', 'Amount')}><input type="number" value={amount} onChange={(event) => { setAmount(Number(event.target.value)); setCalculatedTimestamp(null); setError('') }} /></Field><Field label={tr('单位', 'Unit')}><Dropdown value={unit} onChange={(value) => { setUnit(value as typeof unit); setCalculatedTimestamp(null); setError('') }} ariaLabel={tr('单位', 'Unit')} options={[{ value: 'days', label: tr('天', 'Days') }, { value: 'weeks', label: tr('周', 'Weeks') }, { value: 'months', label: tr('月', 'Months') }, { value: 'years', label: tr('年', 'Years') }]} /></Field></div>
    <div className="devtool-actions"><Action onClick={() => calculate(1)}>{tr('加上', 'Add')}</Action><Action onClick={() => calculate(-1)} secondary>{tr('减去', 'Subtract')}</Action></div>
    {calculated && <Output label={tr('计算结果', 'Calculated date')} value={calculated.toLocaleString(language, { dateStyle: 'full', timeStyle: 'medium' })} />}
    <div className="devtool-divider" />
    <h3 className="devtool-subheading">{tr('日期间隔', 'Date interval')}</h3>
    <div className="devtool-grid-2"><DateTimePicker label={tr('起点', 'From')} value={diffA} onChange={(value) => { setDiffA(value); setDifference(null); setError('') }} /><DateTimePicker label={tr('终点', 'To')} value={diffB} onChange={(value) => { setDiffB(value); setDifference(null); setError('') }} /></div>
    <div className="devtool-actions"><Action onClick={compare}>{tr('计算间隔', 'Calculate interval')}</Action></div>
    {difference && <Output label={tr('经过时长（终点 − 起点）', 'Elapsed duration (to − from)')} value={(difference.milliseconds < 0 ? '−' : '') + days + tr(' 天 ', ' d ') + hours + tr(' 小时 ', ' h ') + minutes + tr(' 分钟 ', ' min ') + seconds + tr(' 秒', ' sec')} />}
    <Message error={error} />
    <p className="devtool-note">{tr('按本地日历加减；月底会夹取到目标月份最后一天。间隔按实际经过时间计算，可能受到夏令时影响。', 'Calendar arithmetic uses local dates and clamps to the last day of the target month. The interval is elapsed time and may reflect daylight saving changes.')}</p>
  </ToolPanel>
}

function Base64Tool() {
  const { tr } = useLanguage()
  const [input, setInput] = useWorkspaceState('toolbox.base64.input', '')
  const [output, setOutput] = useWorkspaceState('toolbox.base64.output', '')
  const [error, setError] = useState('')
  function run(mode: 'encode' | 'decode') {
    try {
      setOutput(mode === 'encode' ? encodeBase64(input) : decodeBase64(input.trim()))
      setError('')
    } catch (cause) { setOutput(''); setError(errorMessage(cause)) }
  }
  return <ToolPanel title="Base64" description={tr('按 UTF-8 处理文本，支持中文和其他 Unicode 字符。', 'Encode UTF-8 text, including Chinese and other Unicode characters.')}>
    <Field label={tr('输入文本或 Base64', 'Text or Base64 input')}><textarea className="devtool-textarea" value={input} onChange={(event) => { setInput(event.target.value); setOutput(''); setError('') }} spellCheck={false} placeholder={tr('输入需要编码的文本', 'Enter text to encode')} /></Field>
    <div className="devtool-actions"><Action onClick={() => run('encode')}>{tr('编码', 'Encode')}</Action><Action onClick={() => run('decode')} secondary>{tr('解码', 'Decode')}</Action></div>
    <Message error={error} />
    {output && <Output label={tr('结果', 'Result')} value={output} multiline />}
  </ToolPanel>
}

function UrlTool() {
  const { tr } = useLanguage()
  const [input, setInput] = useWorkspaceState('toolbox.url.input', '')
  const [output, setOutput] = useWorkspaceState('toolbox.url.output', '')
  const [partsUrl, setPartsUrl] = useWorkspaceState<string | null>('toolbox.url.parts', null)
  const [error, setError] = useState('')
  const parts = partsUrl === null ? null : new URL(partsUrl)
  function run(mode: 'encode' | 'decode' | 'parse') {
    try {
      if (!input) throw new Error(tr('请输入内容', 'Enter a value first'))
      if (mode === 'parse') {
        setPartsUrl(new URL(input).href)
        setOutput('')
      } else {
        setOutput(mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input))
        setPartsUrl(null)
      }
      setError('')
    } catch (cause) { setPartsUrl(null); setOutput(''); setError(errorMessage(cause)) }
  }
  return <ToolPanel title={tr('URL 编解码与解析', 'URL encoding and parsing')} description={tr('对 URL 组件进行百分号编解码，也可拆解完整网址。', 'Percent-encode URL components or inspect the parts of a full URL.')}>
    <Field label={tr('文本或完整网址', 'Text or full URL')}><textarea className="devtool-textarea devtool-textarea--short" value={input} onChange={(event) => { setInput(event.target.value); setOutput(''); setPartsUrl(null); setError('') }} spellCheck={false} placeholder="https://example.com/search?q=hello%20world" /></Field>
    <div className="devtool-actions"><Action onClick={() => run('encode')}>{tr('编码组件', 'Encode component')}</Action><Action onClick={() => run('decode')} secondary>{tr('解码组件', 'Decode component')}</Action><Action onClick={() => run('parse')} secondary>{tr('解析网址', 'Parse URL')}</Action></div>
    <Message error={error} />
    {output && <Output label={tr('结果', 'Result')} value={output} multiline />}
    {parts && <div className="devtool-output-grid">
      <Output label={tr('协议', 'Protocol')} value={parts.protocol} />
      <Output label={tr('主机', 'Host')} value={parts.host} />
      <Output label={tr('路径', 'Path')} value={parts.pathname} />
      <Output label={tr('查询字符串', 'Query string')} value={parts.search} />
      <Output label={tr('片段', 'Fragment')} value={parts.hash} />
      {[...parts.searchParams.entries()].map(([key, value], index) => <Output key={key + index} label={tr('参数：', 'Parameter: ') + key} value={value} />)}
    </div>}
    <p className="devtool-note">{tr('“编码组件”适用于查询值等单个片段；解析网址需要含协议的完整 URL。', '“Encode component” is for individual values such as query parameters. Parsing requires an absolute URL with a scheme.')}</p>
  </ToolPanel>
}

function HtmlTool() {
  const { tr } = useLanguage()
  const [input, setInput] = useWorkspaceState('toolbox.html.input', '')
  const [output, setOutput] = useWorkspaceState('toolbox.html.output', '')
  const [error, setError] = useState('')
  function run(mode: 'encode' | 'decode') {
    try { setOutput(mode === 'encode' ? encodeHtml(input) : decodeHtml(input)); setError('') }
    catch (cause) { setOutput(''); setError(errorMessage(cause)) }
  }
  return <ToolPanel title={tr('HTML 实体编解码', 'HTML entity encoder')} description={tr('转义特殊字符，或将 HTML 实体还原为文本。', 'Escape special characters or turn HTML entities back into text.')}>
    <Field label={tr('输入文本', 'Input text')}><textarea className="devtool-textarea" value={input} onChange={(event) => { setInput(event.target.value); setOutput(''); setError('') }} spellCheck={false} placeholder={'<div title="hello">你好 & hello</div>'} /></Field>
    <div className="devtool-actions"><Action onClick={() => run('encode')}>{tr('转义', 'Escape')}</Action><Action onClick={() => run('decode')} secondary>{tr('还原', 'Unescape')}</Action></div>
    <Message error={error} />
    {output && <Output label={tr('结果', 'Result')} value={output} multiline />}
    <p className="devtool-note">{tr('还原支持数字实体及常见具名实体。', 'Unescape supports numeric references and common named entities.')}</p>
  </ToolPanel>
}

function HashTool() {
  const { tr } = useLanguage()
  const [input, setInput] = useWorkspaceState('toolbox.hash.input', '')
  const [algorithm, setAlgorithm] = useWorkspaceState<'SHA-256' | 'SHA-384' | 'SHA-512'>('toolbox.hash.algorithm', 'SHA-256')
  const [output, setOutput] = useWorkspaceState('toolbox.hash.output', '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      if (!crypto.subtle) throw new Error(tr('当前环境不支持 Web Crypto', 'Web Crypto is unavailable in this environment'))
      const bytes = new TextEncoder().encode(input)
      const digest = await crypto.subtle.digest(algorithm, bytes)
      setOutput(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''))
      setError('')
    } catch (cause) { setOutput(''); setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <ToolPanel title={tr('SHA 哈希计算', 'SHA hash calculator')} description={tr('在本机计算文本的 SHA 摘要。', 'Calculate a SHA digest for text on your device.')}>
    <Field label={tr('输入文本', 'Input text')}><textarea className="devtool-textarea" value={input} onChange={(event) => { setInput(event.target.value); setOutput(''); setError('') }} spellCheck={false} placeholder={tr('粘贴需要计算摘要的文本', 'Paste text to hash')} /></Field>
    <div className="devtool-controls"><Field label={tr('算法', 'Algorithm')}><Dropdown value={algorithm} onChange={(value) => { setAlgorithm(value as typeof algorithm); setOutput('') }} ariaLabel={tr('算法', 'Algorithm')} options={[{ value: 'SHA-256', label: 'SHA-256' }, { value: 'SHA-384', label: 'SHA-384' }, { value: 'SHA-512', label: 'SHA-512' }]} /></Field><div className="devtool-actions"><Action onClick={() => { void run() }} disabled={busy}>{busy ? tr('计算中…', 'Calculating…') : tr('计算哈希', 'Calculate hash')}</Action></div></div>
    <Message error={error} />
    {output && <Output label={algorithm + ' (hex)'} value={output} />}
    <p className="devtool-note">{tr('输入按 UTF-8 编码；修改输入后请重新计算。', 'Input is encoded as UTF-8. Recalculate after editing it.')}</p>
  </ToolPanel>
}

function uuidV4(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
}

function UuidTool() {
  const { tr } = useLanguage()
  const [count, setCount] = useWorkspaceState('toolbox.uuid.count', 5)
  const [output, setOutput] = useWorkspaceState<string[]>('toolbox.uuid.output', [])
  const [error, setError] = useState('')
  function generate() {
    try {
      if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error(tr('数量必须是 1–100 的整数', 'Count must be an integer from 1 to 100'))
      setOutput(Array.from({ length: count }, uuidV4))
      setError('')
    } catch (cause) { setOutput([]); setError(errorMessage(cause)) }
  }
  return <ToolPanel title={tr('UUID v4 生成', 'UUID v4 generator')} description={tr('使用系统安全随机数生成标识符。', 'Generate identifiers using the system cryptographic random source.')}>
    <div className="devtool-controls"><Field label={tr('生成数量', 'Count')}><input type="number" min={1} max={100} value={count} onChange={(event) => { setCount(Number(event.target.value)); setOutput([]); setError('') }} /></Field><div className="devtool-actions"><Action onClick={generate}>{tr('生成 UUID', 'Generate UUIDs')}</Action></div></div>
    <Message error={error} />
    {output.length > 0 && <Output label={tr('生成结果', 'Generated IDs')} value={output.join('\n')} multiline />}
  </ToolPanel>
}

function JwtTool() {
  const { tr } = useLanguage()
  const [input, setInput] = useWorkspaceState('toolbox.jwt.input', '')
  const [result, setResult] = useWorkspaceState<{ header: Record<string, unknown>; payload: Record<string, unknown>; signature: string } | null>('toolbox.jwt.result', null)
  const [error, setError] = useState('')
  function run() {
    try {
      setResult(decodeJwt(input))
      setError('')
    } catch (cause) { setResult(null); setError(errorMessage(cause)) }
  }
  const timestamp = result && typeof result.payload.exp === 'number' && Number.isFinite(result.payload.exp)
    ? new Date(result.payload.exp * 1000) : null
  return <ToolPanel title={tr('JWT 解码查看', 'JWT inspector')} description={tr('解码 Token 的 Header 和 Payload，方便检查声明。', 'Decode a token’s header and payload to inspect its claims.')}>
    <Field label="JWT"><textarea className="devtool-textarea" value={input} onChange={(event) => { setInput(event.target.value); setResult(null); setError('') }} spellCheck={false} placeholder="eyJhbGciOi..." /></Field>
    <div className="devtool-actions"><Action onClick={run}>{tr('解码', 'Decode')}</Action></div>
    <Message error={error} />
    {result && <div className="devtool-output-grid"><Output label="Header" value={JSON.stringify(result.header, null, 2)} multiline /><Output label="Payload" value={JSON.stringify(result.payload, null, 2)} multiline />{timestamp && Number.isFinite(timestamp.getTime()) && <Output label={tr('过期时间（本地）', 'Expiration (local)')} value={timestamp.toLocaleString()} />}</div>}
    <p className="devtool-warning"><AlertCircle size={16} />{tr('仅解码查看，不验证签名；请勿将结果视为可信身份信息。', 'Decoded only. The signature is not verified; do not treat these claims as trusted identity data.')}</p>
  </ToolPanel>
}

type RegexMatch = { index: number; value: string; groups: string[] }
function runRegex(pattern: string, flags: string, input: string): Promise<RegexMatch[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../lib/regex-worker.ts', import.meta.url), { type: 'module' })
    const timer = window.setTimeout(() => { worker.terminate(); reject(new Error('Regex timed out after 1 second')) }, 1000)
    worker.onmessage = (event: MessageEvent<{ matches?: RegexMatch[]; error?: string }>) => {
      window.clearTimeout(timer)
      worker.terminate()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.matches ?? [])
    }
    worker.onerror = () => {
      window.clearTimeout(timer)
      worker.terminate()
      reject(new Error('Unable to run regex'))
    }
    worker.postMessage({ pattern, flags, input })
  })
}

function RegexTool() {
  const { tr } = useLanguage()
  const [pattern, setPattern] = useWorkspaceState('toolbox.regex.pattern', '')
  const [flags, setFlags] = useWorkspaceState('toolbox.regex.flags', 'g')
  const [input, setInput] = useWorkspaceState('toolbox.regex.input', '')
  const [matches, setMatches] = useWorkspaceState<RegexMatch[] | null>('toolbox.regex.matches', null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      if (!pattern) throw new Error(tr('请输入正则表达式', 'Enter a regular expression'))
      if (pattern.length > 500 || input.length > 100000) throw new Error(tr('表达式或测试文本过长', 'Pattern or test text is too long'))
      setMatches(await runRegex(pattern, flags, input))
      setError('')
    } catch (cause) { setMatches(null); setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <ToolPanel title={tr('正则表达式测试', 'Regex tester')} description={tr('查看匹配内容、位置和捕获分组。', 'Inspect matches, positions, and captured groups.')}>
    <div className="devtool-grid-2"><Field label={tr('表达式', 'Pattern')}><input value={pattern} onChange={(event) => { setPattern(event.target.value); setMatches(null); setError('') }} spellCheck={false} placeholder="\\b\\w+\\b" /></Field><Field label={tr('标志', 'Flags')}><input value={flags} onChange={(event) => { setFlags(event.target.value); setMatches(null); setError('') }} spellCheck={false} placeholder="gim" /></Field></div>
    <Field label={tr('测试文本', 'Test text')}><textarea className="devtool-textarea" value={input} onChange={(event) => { setInput(event.target.value); setMatches(null); setError('') }} spellCheck={false} placeholder={tr('输入待匹配的文本', 'Enter text to test')} /></Field>
    <div className="devtool-actions"><Action onClick={() => { void run() }} disabled={busy}>{busy ? tr('匹配中…', 'Matching…') : tr('查找匹配', 'Find matches')}</Action></div>
    <Message error={error} />
    {matches && <div className="devtool-match-list"><strong>{tr('匹配数量：', 'Matches: ') + matches.length}{matches.length === 100 ? tr('（最多显示 100 条）', ' (showing up to 100)') : ''}</strong>{matches.length === 0 && <p>{tr('没有匹配结果。', 'No matches found.')}</p>}{matches.map((match, index) => <div className="devtool-match" key={index}><span>#{index + 1} · {tr('位置', 'Index')} {match.index}</span><code>{match.value || tr('（空匹配）', '(empty match)')}</code>{match.groups.length > 0 && <small>{tr('分组：', 'Groups: ') + match.groups.map((group) => group ?? '∅').join(' · ')}</small>}</div>)}</div>}
  </ToolPanel>
}

const panelComponents: Record<ToolId, () => ReactNode> = {
  json: JsonTool, timestamp: TimestampTool, date: DateTool, base: BaseTool, ip: IpTool,
  base64: Base64Tool, url: UrlTool, html: HtmlTool, hash: HashTool, uuid: UuidTool,
  jwt: JwtTool, regex: RegexTool,
}

export default function DeveloperToolbox() {
  const { tr } = useLanguage()
  const [active, setActive] = useWorkspaceState<ToolId>('toolbox.active', 'json')
  const [query, setQuery] = useWorkspaceState('toolbox.query', '')
  const filtered = useMemo(() => tools.filter((tool) => {
    const text = (tool.title.join(' ') + ' ' + tool.description.join(' ') + ' ' + tool.keywords).toLowerCase()
    return text.includes(query.trim().toLowerCase())
  }), [query])
  const selected = tools.find((tool) => tool.id === active) ?? tools[0]
  const CurrentIcon = selected.icon
  return <div className="devtool-layout">
    <aside className="devtool-list workspace-card" aria-label={tr('工具列表', 'Tool list')}>
      <div className="devtool-list-head"><strong>{tr('工具列表', 'Tools')}</strong><span>{tools.length}</span></div>
      <label className="devtool-search"><Search size={16} /><span className="visually-hidden">{tr('搜索工具', 'Search tools')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr('搜索工具…', 'Search tools…')} /></label>
      <div className="devtool-list-scroll">{filtered.length === 0 && <p className="devtool-empty">{tr('没有找到工具，请尝试其他关键词。', 'No tools found. Try another keyword.')}</p>}{groups.map((group) => {
        const entries = filtered.filter((tool) => tool.group === group.id)
        if (!entries.length) return null
        return <div className="devtool-group" key={group.id}><div className="devtool-group-label">{tr(...group.label)}</div>{entries.map((tool) => {
          const Icon = tool.icon
          return <button key={tool.id} className={'devtool-list-item ' + (active === tool.id ? 'active' : '')} aria-current={active === tool.id ? 'page' : undefined} type="button" onClick={() => setActive(tool.id)}><Icon size={16} /><span>{tr(...tool.title)}</span></button>
        })}</div>
      })}</div>
    </aside>
    <div className="devtool-main"><div className="devtool-current"><CurrentIcon size={17} /><span>{tr(...selected.title)}</span><small>{tr(...selected.description)}</small></div>{tools.map((tool) => {
      const Panel = panelComponents[tool.id]
      return <div key={tool.id} hidden={active !== tool.id}><Panel /></div>
    })}</div>
  </div>
}

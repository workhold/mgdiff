import ExcelJS from 'exceljs'

export interface TableSheet {
  name: string
  rows: string[][]
  /** Formula source at the same row and column as `rows`; empty for plain values. */
  formulas: string[][]
}

export interface TableData {
  sheets: TableSheet[]
}

export interface TableComparisonRow {
  /** Zero-based index in the aligned comparison. */
  index: number
  /** Original zero-based row indices; absent for inserted or removed rows. */
  leftIndex?: number
  rightIndex?: number
  left: string[]
  right: string[]
  status: 'same' | 'changed' | 'left-only' | 'right-only'
  /** Zero-based columns whose cell values differ. */
  changedColumns: number[]
  /** Subset of changedColumns where the underlying formula differs. */
  formulaChangedColumns: number[]
}

export interface TableComparison {
  rows: TableComparisonRow[]
  changedRows: number
  changedCells: number
  changedFormulaCells: number
  alignmentUsed: TableAlignment
  alignmentWarning?: string
}

export type TableAlignment = 'index' | 'first-column'

export interface TableComparisonOptions {
  alignment?: TableAlignment
  compareFormulas?: boolean
  leftFormulas?: string[][]
  rightFormulas?: string[][]
}

function parseDelimited(input: string, delimiter: string): string[][] {
  const source = input.replace(/^\uFEFF/, '')
  if (!source) return []

  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let i = 0; i < source.length; i += 1) {
    const character = source[i]

    if (character === '"') {
      if (quoted && source[i + 1] === '"') {
        value += '"'
        i += 1
      } else if (quoted || value === '') {
        quoted = !quoted
      } else {
        value += character
      }
    } else if (character === delimiter && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      row.push(value)
      rows.push(row)
      row = []
      value = ''
      if (character === '\r' && source[i + 1] === '\n') i += 1
    } else {
      value += character
    }
  }

  // A final line break ends the last row; it does not add another empty row.
  if (value !== '' || row.length > 0 || !/[\r\n]$/.test(source)) {
    row.push(value)
    rows.push(row)
  }

  return rows
}

async function readDelimitedText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if ('richText' in value) return value.richText.map((part) => part.text).join('')
  if ('result' in value && value.result != null) {
    if (value.result instanceof Date) return value.result.toISOString()
    if (typeof value.result === 'object') return value.result.error
    return String(value.result)
  }
  if ('text' in value && typeof value.text === 'string') return value.text
  if ('formula' in value) return `=${value.formula}`
  if ('sharedFormula' in value) return `=${value.sharedFormula}`
  if ('error' in value) return value.error
  return cell.text
}

function cellFormula(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null || typeof value !== 'object' || value instanceof Date) return ''
  if ('formula' in value && typeof value.formula === 'string') return `=${value.formula}`
  if ('sharedFormula' in value) return `=${cell.formula || value.sharedFormula}`
  return ''
}

/** Reads CSV, TSV, and XLSX files into string-valued sheets. */
export async function parseTable(file: File): Promise<TableData> {
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'csv' || extension === 'tsv') {
    const rows = parseDelimited(await readDelimitedText(file), extension === 'tsv' ? '\t' : ',')
    return { sheets: [{ name: file.name, rows, formulas: [] }] }
  }

  // Git may omit one side of an added or deleted workbook. Its zero-byte
  // temporary file has no sheets, regardless of whether it retains .xlsx.
  if (file.size === 0) return { sheets: [] }

  if (extension !== 'xlsx') {
    throw new Error(`Unsupported table format: ${file.name}. Use .csv, .tsv, or .xlsx.`)
  }

  const workbook = new ExcelJS.Workbook()
  const bytes = new Uint8Array(await file.arrayBuffer())
  // ExcelJS's declaration says Node Buffer, while its browser build accepts Uint8Array.
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])

  return {
    sheets: workbook.worksheets.map((worksheet) => {
      const rows: string[][] = []
      const formulas: string[][] = []

      for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex)
        const values: string[] = []
        const rowFormulas: string[] = []
        for (let columnIndex = 1; columnIndex <= row.cellCount; columnIndex += 1) {
          const cell = row.getCell(columnIndex)
          values.push(cellText(cell))
          rowFormulas.push(cellFormula(cell))
        }
        while (values.length > 0 && values[values.length - 1] === '' && rowFormulas.at(-1) === '') {
          values.pop()
          rowFormulas.pop()
        }
        rows.push(values)
        formulas.push(rowFormulas)
      }

      return { name: worksheet.name, rows, formulas }
    }),
  }
}

function keyPositions(rows: string[][]): Map<string, number[]> {
  const positions = new Map<string, number[]>()
  rows.forEach((row, index) => {
    const key = row[0]?.trim() ?? ''
    const group = positions.get(key) ?? []
    group.push(index)
    positions.set(key, group)
  })
  return positions
}

function rowSignature(values: string[], formulas: string[], compareFormulas: boolean): string {
  let length = Math.max(values.length, compareFormulas ? formulas.length : 0)
  while (length > 0 && (values[length - 1] ?? '') === '' && (!compareFormulas || (formulas[length - 1] ?? '') === '')) {
    length -= 1
  }
  return JSON.stringify([
    Array.from({ length }, (_, index) => values[index] ?? ''),
    compareFormulas ? Array.from({ length }, (_, index) => formulas[index] ?? '') : [],
  ])
}

/** Compares values and, by default, formulas; optionally aligns rows by first-column keys. */
export function compareTableSheets(
  leftRows: string[][],
  rightRows: string[][],
  options: TableComparisonOptions = {},
): TableComparison {
  const rows: TableComparisonRow[] = []
  let changedRows = 0
  let changedCells = 0
  let changedFormulaCells = 0
  const requestedAlignment = options.alignment ?? 'index'
  const leftPositions = keyPositions(leftRows)
  const rightPositions = keyPositions(rightRows)
  const hasNamedKeys = [...leftPositions.keys(), ...rightPositions.keys()].some((key) => key !== '')
  const alignmentUsed: TableAlignment = requestedAlignment === 'first-column' && hasNamedKeys ? 'first-column' : 'index'
  const hasAmbiguousKeys = [...new Set([...leftPositions.keys(), ...rightPositions.keys()])].some((key) =>
    key === '' || (leftPositions.get(key)?.length ?? 0) > 1 || (rightPositions.get(key)?.length ?? 0) > 1,
  )
  const alignmentWarning = requestedAlignment !== 'first-column' ? undefined
    : !hasNamedKeys ? '首列没有可用键，已改为按行号对齐。'
      : hasAmbiguousKeys ? '首列有空值或重复键；相关行优先按完整内容匹配，其余按出现顺序对齐。'
        : undefined

  function addRow(leftIndex?: number, rightIndex?: number) {
    const index = rows.length
    const left = leftIndex === undefined ? [] : leftRows[leftIndex]
    const right = rightIndex === undefined ? [] : rightRows[rightIndex]
    const changedColumns: number[] = []
    const formulaChangedColumns: number[] = []
    const leftFormulaRow = leftIndex === undefined ? [] : options.leftFormulas?.[leftIndex] ?? []
    const rightFormulaRow = rightIndex === undefined ? [] : options.rightFormulas?.[rightIndex] ?? []

    if (leftIndex === undefined || rightIndex === undefined) {
      const present = leftIndex === undefined ? right : left
      for (let column = 0; column < Math.max(1, present.length); column += 1) {
        changedColumns.push(column)
      }
    } else {
      for (let column = 0; column < Math.max(left.length, right.length); column += 1) {
        const formulaChanged = options.compareFormulas !== false &&
          (leftFormulaRow[column] ?? '') !== (rightFormulaRow[column] ?? '')
        if (formulaChanged) formulaChangedColumns.push(column)
        if ((left[column] ?? '') !== (right[column] ?? '') || formulaChanged) {
          changedColumns.push(column)
        }
      }
    }

    if (changedColumns.length > 0) {
      changedRows += 1
      changedCells += changedColumns.length
      changedFormulaCells += formulaChangedColumns.length
    }
    const status = leftIndex === undefined ? 'right-only' : rightIndex === undefined
      ? 'left-only' : changedColumns.length > 0 ? 'changed' : 'same'
    rows.push({ index, leftIndex, rightIndex, left, right, status, changedColumns, formulaChangedColumns })
  }

  if (alignmentUsed === 'index') {
    for (let index = 0; index < Math.max(leftRows.length, rightRows.length); index += 1) {
      addRow(index < leftRows.length ? index : undefined, index < rightRows.length ? index : undefined)
    }
  } else {
    const leftToRight = new Map<number, number>()
    const rightToLeft = new Map<number, number>()
    const match = (leftIndex: number, rightIndex: number) => {
      leftToRight.set(leftIndex, rightIndex)
      rightToLeft.set(rightIndex, leftIndex)
    }

    // Match identities directly; a row moving to another position is still the same row.
    for (const [key, leftIndices] of leftPositions) {
      const rightIndices = rightPositions.get(key) ?? []
      if (rightIndices.length === 0) continue
      if (key !== '' && leftIndices.length === 1 && rightIndices.length === 1) {
        match(leftIndices[0], rightIndices[0])
        continue
      }

      // Ambiguous keys: preserve exact rows first, then pair remaining occurrences.
      const exactLeft = new Map<string, { indices: number[]; next: number }>()
      for (const leftIndex of leftIndices) {
        const signature = rowSignature(
          leftRows[leftIndex], options.leftFormulas?.[leftIndex] ?? [], options.compareFormulas !== false,
        )
        const group = exactLeft.get(signature) ?? { indices: [], next: 0 }
        group.indices.push(leftIndex)
        exactLeft.set(signature, group)
      }
      for (const rightIndex of rightIndices) {
        const signature = rowSignature(
          rightRows[rightIndex], options.rightFormulas?.[rightIndex] ?? [], options.compareFormulas !== false,
        )
        const group = exactLeft.get(signature)
        const leftIndex = group?.indices[group.next]
        if (leftIndex !== undefined && group) {
          group.next += 1
          match(leftIndex, rightIndex)
        }
      }
      const unmatchedLeft = leftIndices.filter((index) => !leftToRight.has(index))
      const unmatchedRight = rightIndices.filter((index) => !rightToLeft.has(index))
      for (let index = 0; index < Math.min(unmatchedLeft.length, unmatchedRight.length); index += 1) {
        match(unmatchedLeft[index], unmatchedRight[index])
      }
    }

    // Use the modified sheet's order. Place removed rows before their next
    // surviving neighbour so insertions and removals stay near their context.
    const leftOnlyBefore = new Map<number, number[]>()
    let pendingLeftOnly: number[] = []
    for (let leftIndex = 0; leftIndex < leftRows.length; leftIndex += 1) {
      const rightIndex = leftToRight.get(leftIndex)
      if (rightIndex === undefined) {
        pendingLeftOnly.push(leftIndex)
      } else if (pendingLeftOnly.length > 0) {
        leftOnlyBefore.set(rightIndex, pendingLeftOnly)
        pendingLeftOnly = []
      }
    }
    for (let rightIndex = 0; rightIndex < rightRows.length; rightIndex += 1) {
      for (const leftIndex of leftOnlyBefore.get(rightIndex) ?? []) addRow(leftIndex, undefined)
      addRow(rightToLeft.get(rightIndex), rightIndex)
    }
    for (const leftIndex of pendingLeftOnly) addRow(leftIndex, undefined)
  }

  return { rows, changedRows, changedCells, changedFormulaCells, alignmentUsed, alignmentWarning }
}

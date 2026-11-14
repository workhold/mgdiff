import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

export type Language = 'zh-CN' | 'en'

type LanguageContextValue = {
  language: Language
  setLanguage: (language: Language) => void
  tr: (chinese: string, english: string) => string
}

const storageKey = 'mgdiff.language'
const LanguageContext = createContext<LanguageContextValue | null>(null)

function initialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(storageKey)
    if (saved === 'zh-CN' || saved === 'en') return saved
  } catch { /* Private browsing may disable local storage. */ }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage)
  const tr = useCallback((chinese: string, english: string) => language === 'zh-CN' ? chinese : english, [language])

  useLayoutEffect(() => {
    document.documentElement.lang = language
    document.title = language === 'zh-CN' ? 'MG Diff — 文件比较与开发工具' : 'MG Diff — File comparison & developer tools'
    try { window.localStorage.setItem(storageKey, language) } catch { /* Keep the in-memory choice. */ }
  }, [language])

  const value = useMemo(() => ({ language, setLanguage, tr }), [language, tr])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used within LanguageProvider')
  return context
}

/** Display labels for synthetic files supplied to Git comparisons. */
export function displayFileName(name: string, tr: LanguageContextValue['tr']): string {
  if (name === '__mgdiff_missing_original__.svg' || name === '原始侧文件缺失（透明占位）.svg') {
    return tr('原始侧文件缺失（透明占位）.svg', 'Missing original image (transparent placeholder).svg')
  }
  if (name === '__mgdiff_missing_modified__.svg' || name === '修改侧文件缺失（透明占位）.svg') {
    return tr('修改侧文件缺失（透明占位）.svg', 'Missing modified image (transparent placeholder).svg')
  }
  return name
}

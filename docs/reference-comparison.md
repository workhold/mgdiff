# MGDiff 与 Diffchecker Desktop：功能参考和差距

> 官网资料调研：2026-11-13，下载链接与功能矩阵复核：2026-11-14，MGDiff 代码对照更新：2026-11-14。Diffchecker macOS 桌面程序未安装、未运行，因此下文的官方功能是**官网产品声明**，不是桌面版实测结论。MGDiff 的“已实现”以撰写时的源码为准，也不代表全面兼容性验收。

## 证据范围与下载记录

- 官方基线：[Desktop 介绍](https://www.diffchecker.com/desktop/)、[定价页的 Desktop 功能矩阵](https://www.diffchecker.com/pricing/)，以及[文本](https://www.diffchecker.com/)、[图片](https://www.diffchecker.com/image-compare/)、[文档](https://www.diffchecker.com/word-pdf-compare/)、[表格](https://www.diffchecker.com/excel-compare/)专题页。专题页含网页版描述；功能矩阵列明的项目才作为 Desktop 能力，专题页单独描述的细节只用作交互参考。
- [官方试用下载页](https://www.diffchecker.com/download-trial/)的 macOS 链接在首次检查时指向 `https://dl.diffchecker.com/Diffchecker-7.3.4-universal.dmg`。该文件的 HTTP 响应标明长度为 342,515,026 字节。CDN 传输极慢，下载被中止，`/tmp/Diffchecker-7.3.4-universal.dmg.partial` 仅约 2.8 MiB；**这不是完整安装包，未挂载、未安装、未运行，也未验证安装包签名**。
- 2026-11-14 复核时同一官方 macOS 下载链接指向 `https://dl.diffchecker.com/Diffchecker-7.3.5-universal.dmg`。7.3.5 仅确认了官网链接目标，未下载或测试。版本更新也说明不能把官网展示推断为特定版本的实测交互。
- MGDiff 对照依据：[入口和五种模式](../src/App.tsx)、[文本](../src/components/TextCompare.tsx)、[表格](../src/components/TableCompare.tsx)、[图片](../src/components/ImageCompare.tsx)、[PDF](../src/components/PdfCompare.tsx)、[文件夹](../src/components/FolderCompare.tsx)、[历史](../src/lib/history.ts)、[外部启动](../src/lib/external-launch.ts)、[Git 配置面板](../src/components/IntegrationPanel.tsx)、[三方合并](../src/components/MergeWorkspace.tsx)及 [Tauri 原生命令](../src-tauri/src/lib.rs)。

## 本轮已落地的工作流

- 五种对比模式均采用“选择/编辑输入 → 点击开始比对 → 独立结果页”的流程；结果页可返回修改或重新比对。外部 `--diff` 调用会带入路径并自动进入结果。
- 顶部“对比历史”保存本机差异摘要；文本、表格、图片和 PDF 在大小与存储允许时保存输入快照并可重开。文本快照上限为两侧合计 2 MiB；文件快照为单个 16 MiB、两侧合计 24 MiB。文件夹只记录摘要，不能直接重开；历史不保存完整结果页状态或视图设置。
- Tauri 可执行文件支持 `--diff LEFT RIGHT`（两个文件或两个目录）以及 `--merge BASE LOCAL REMOTE MERGED`。顶部“工具集成”显示实际程序路径并生成 `git difftool`/`git mergetool` 配置命令，供用户复制执行。三方合并限 UTF-8 文本，显式确认后写回 MERGED；取消或关闭不会报告合并成功。
- 以上是 **MGDiff 源码实现范围**，并非由 Diffchecker 桌面版实际运行对照验证的交互等价结论。使用方法见 [README](../README.md)。

## 已实现与待实现

| 模式 | MGDiff 当前已实现 | 主要缺口及官网交互参考 |
| --- | --- | --- |
| 文本 | 两侧文件导入、粘贴与实时编辑；并排/统一结果；智能/词/字符高亮；忽略空格和行尾格式、忽略大小写；隐藏相同行、自动换行；差异导航、块级双向合并；导出 `.patch`、保存右侧文本。 | 语法高亮、自定义忽略规则、对比结果 PDF 导出。官方[矩阵](https://www.diffchecker.com/pricing/)列有这些能力。 |
| 表格 | `.xlsx`、`.csv`、`.tsv`；工作表选择；按首列键或行号对齐；单元格及公式变化标记；仅看差异；导出 TXT 报告。首列键不适用时会回退到行号并提示。 | `.xls/.xlsm/.xlsb/.ods/.dif` 等格式；日期归一化、忽略空格/大小写、隐藏相同列；Excel redline、PDF/Excel 导出，见[矩阵](https://www.diffchecker.com/pricing/)。[表格专题页](https://www.diffchecker.com/excel-compare/)另展示两侧工作表独立选择，可借鉴，但桌面版该细节未实测。 |
| 图片 | 拖入/选取两图；并排、叠加、滑块、差异、相减、闪烁六种视图；容差、尺寸、近似变化像素百分比；PNG 差异图导出。 | 自动对齐、分组差异区域及导航、图中文字 OCR、EXIF 对比、PDF 图片输入，见[矩阵](https://www.diffchecker.com/pricing/)。[图片专题页](https://www.diffchecker.com/image-compare/)另描述手动对齐、同步缩放和平移，可借鉴，但桌面版这些细节未实测。`image/*` 能否读取 HEIC 取决于 WebView 解码，不应视为已验证支持。 |
| 文档/PDF | PDF 对 PDF；提取文字并逐页比较；渲染页面做像素比较；差异页列表、页面双栏预览、视觉高亮、分组差异区域选择和文本差异。扫描件能检测**视觉变化**。 | 扫描件 OCR 文字识别；DOC/DOCX/PPTX 及跨格式配对；排版/格式变化、移动内容、页面重排、受密码保护 PDF 的专门流程；多视图同步滚动、redline 接受/拒绝、PDF/Word/修订记录导出。当前视觉比较有 1600 像素的页面长边上限，细微差异需另测。参考[文档页](https://www.diffchecker.com/word-pdf-compare/)及[矩阵](https://www.diffchecker.com/pricing/)。 |
| 文件夹 | Tauri 原生文件夹选择；递归扫描文件并用 SHA-256 判等；按相对路径组织可折叠树；状态统计、搜索/筛选；双击常见文本文件跳转文本差异。空文件夹可选，但扫描仅保留文件，空子目录不会单独出现在树中。 | 从树中直接打开图片、表格、PDF 专用对比；批量比较/批量处理；忽略文件或目录规则。官方[矩阵](https://www.diffchecker.com/pricing/)明确列有递归文件树和批量比较。 |
| 桌面工作流 | Tauri 本地窗口和本地文件处理；五模式输入页与独立结果页；中英切换、快捷键、使用指南；本地对比历史与有限快照重开；文本/图片等结果导出。 | 深色模式、可移植项目文件及完整结果页状态恢复、系统化大文件性能策略。官方[矩阵](https://www.diffchecker.com/pricing/)列有本地保存和“无文件大小限制”；MGDiff 历史有快照上限，不应声称同等。 |
| 外部工具与 Git | `--diff` 可接收文件或目录并自动打开对应对比；生成供用户执行的 `git difftool`/`git mergetool` 配置命令；UTF-8 文本三方合并可处理冲突并写回 Git 指定的 MERGED 文件。 | 官方[矩阵](https://www.diffchecker.com/pricing/)仅确认 Desktop 有 Git 集成，未实测其 CLI、冲突处理或退出码细节；MGDiff 目前没有二进制文件三方合并。 |

Diffchecker 的[功能矩阵](https://www.diffchecker.com/pricing/)把 AI 差异摘要、云端保存、分享链接、文本行内评论列为 Web/Pro 能力，**Desktop 列未包含**；因此它们不计作 MGDiff 对桌面目标的缺口。

## 关键交互差异与优先级

| 优先级 | 交互差异 | 建议的可验收切片 |
| --- | --- | --- |
| P0 | 图片轻微位移或分辨率不同会造成大片像素误报；当前对齐只是按尺寸缩放并居中。 | 加入自动平移对齐与手动微调，展示原始/对齐后的变化率，并用已知平移样例验证。图片页也把“先对齐”作为处理整幅误报的步骤。 |
| P0 | 文件夹结果树目前只能下钻到文本；没有文本层的扫描件 PDF 仅有像素差异，不能搜索或比较识别出的文字。 | 依扩展名路由到对应模式；给 PDF 增加 OCR 并区分“视觉差异”和“OCR 文字差异”，避免把视觉检测说成文字识别。 |
| P1 | 图片有差异图和百分比，但没有可逐项定位的变化清单；表格有逐格高亮，但缺少忽略规则和跨侧工作表配对。 | 图片做连通区域分组、序号及上一处/下一处导航；表格增加两侧工作表选择和空格、大小写、日期标准化开关。 |
| P1 | PDF 的当前界面可选差异区域，但仍以同页、PDF/PDF、低于渲染上限的像素图为中心。 | 加可同步缩放/滚动的高分辨率页视图，处理页面插入/重排；随后接入 DOCX/PPTX 转换，再做跨格式比较。 |
| P2 | 历史已能重开部分输入，但不是完整会话；官方的导出和深度编辑能力更完整。 | 分阶段做文本/表格/PDF 导出、完整会话与视图状态保存、深色模式；最后评估 redline、更多格式及批量任务。Git 外部工具接入已经实现，后续重点是验证跨平台打包与真实仓库工作流。 |

这些优先级是基于当前源码和官方公开功能做出的**实施建议**，不是 Diffchecker Desktop 实测性能排序。尤其 OCR、Office 格式转换、redline 应单独评估依赖、授权与跨平台成本。

## 其他开源项目的可借鉴实现

| 项目与准确来源 | 已采用或计划借鉴的点 |
| --- | --- |
| [Meld 官方项目页](https://meldmerge.org/)：说明文件/目录的两方或三方比较、变化块操作、目录下钻、忽略规则及版本控制集成。 | MGDiff 当前已有可折叠目录树、文本差异块合并、从目录进入文本比较，以及经外部工具入口处理 UTF-8 文本三方合并；下一步借鉴其忽略规则和向更多文件类型下钻。未直接复用 Meld 代码。 |
| [ImageMagick `compare` 官方文档](https://imagemagick.org/compare/)：说明图像差异的可视标注、数学指标（含 RMSE/PSNR）与比较选项。 | MGDiff 现有逐像素容差、差异图和相减图；计划加入可解释的误差指标及对齐前后对照。当前没有集成 ImageMagick 可执行文件或源码。 |
| [diff-pdf 官方源码仓库/README](https://github.com/vslavik/diff-pdf)：支持视觉 PDF 比较、差异 PDF 输出，GUI 可缩放，并可相对平移页面以处理位置偏移。 | MGDiff 已采用逐页渲染比对、视觉高亮的交互思路；计划评估页面平移校准、缩放与差异 PDF 导出。当前没有引入 diff-pdf 代码或二进制。 |

上述开源项目用于验证交互和算法方向；若以后实际引入其源码或二进制，需先核对各项目许可证及桌面分发方式。

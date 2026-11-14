# 从 Git 调用 MGDiff

[English](git-integration.en.md)

MGDiff 的桌面可执行文件接受两种参数（下方 `mgdiff` 表示实际可执行文件，不会因构建或安装而自动加入 `PATH`）：

```text
mgdiff --diff <left> <right>
mgdiff --merge <base> <local> <remote> <merged>
```

`--diff` 自动识别两个文件或两个目录，导入时不会自动修改输入。`--merge` 打开文本三方合并，同时读取 Git 已写入的 `MERGED` 初稿；保存时只写入该启动参数指定的路径。缺失的输入文件作为空文件处理。路径中的空格由命令行参数正常支持。

在 macOS 项目根目录运行 `npm run tauri build` 后，应用包内的二进制文件位于 `src-tauri/target/release/bundle/macos/MGDiff.app/Contents/MacOS/mgdiff`，独立构建产物位于 `src-tauri/target/release/mgdiff`。可从项目根目录取得绝对路径并验证 CLI：

```sh
APP_BINARY="$(pwd)/src-tauri/target/release/bundle/macos/MGDiff.app/Contents/MacOS/mgdiff"
"$APP_BINARY" --help
```

如果已将 `MGDiff.app` 安装到 `/Applications`，其实际二进制文件路径才是 `/Applications/MGDiff.app/Contents/MacOS/mgdiff`。桌面版“工具集成”会显示当前可执行文件的绝对路径（由 `get_external_tool_path` 返回）。本地 Vite 开发预览（`npm run dev`）通过 `/__mgdiff/cli-path` 查找已构建的可执行文件；静态浏览器预览需手动输入实际绝对路径。找到或输入路径后，页面可生成 Git 配置命令，但浏览器页面本身不能接收 CLI 参数。不要在 Git 配置中用 `open -a` 之类会提前返回的启动器；Git 需要等待 MGDiff 进程关闭。

## 配置 difftool

以下示例使用安装到 `/Applications` 后的路径；未安装时，请替换为上面 `APP_BINARY` 指向的绝对路径，或直接复制“工具集成”生成的命令。单引号让 `$LOCAL` 和 `$REMOTE` 在 Git 调用工具时才展开；内层双引号保证含空格的文件路径仍是单个参数。

```sh
git config --global diff.tool mgdiff
git config --global difftool.mgdiff.cmd '"/Applications/MGDiff.app/Contents/MacOS/mgdiff" --diff "$LOCAL" "$REMOTE"'
git config --global difftool.prompt false
```

```sh
git difftool --tool=mgdiff
git difftool --tool=mgdiff --dir-diff --no-symlinks
```

Git 的自定义 difftool 命令提供 `$LOCAL` 和 `$REMOTE`；`--dir-diff` 将变更复制到临时目录并执行目录对比。Git 在非 Windows 平台的目录模式可能使用符号链接，因此这里加 `--no-symlinks`，让 MGDiff 扫描实际文件。参见 [Git difftool 官方文档](https://git-scm.com/docs/git-difftool)。

## 配置 mergetool

```sh
git config --global merge.tool mgdiff
git config --global mergetool.mgdiff.cmd '"/Applications/MGDiff.app/Contents/MacOS/mgdiff" --merge "$BASE" "$LOCAL" "$REMOTE" "$MERGED"'
git config --global mergetool.mgdiff.trustExitCode true
```

```sh
git mergetool --tool=mgdiff
```

Git 将共同祖先、当前分支、待合并分支及结果路径分别放在 `$BASE`、`$LOCAL`、`$REMOTE`、`$MERGED`。`$BASE` 可能不可用；MGDiff 会把缺失的输入视为空内容。MGDiff 只有在合并结果成功保存到启动时指定的 `MERGED` 后，关闭窗口才返回退出码 `0`；未保存关闭返回非零。`mergetool.mgdiff.trustExitCode=true` 让 Git 使用该退出码判断合并是否完成。参见 [Git mergetool 官方文档](https://git-scm.com/docs/git-mergetool)。

这两个 CLI 入口也可用于 SVN、Mercurial 等允许传入文件路径并等待外部工具退出的程序；调用方需按上方参数顺序传入路径。

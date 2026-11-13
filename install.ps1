<#
.SYNOPSIS
  dsh-sidebar-cards 一键安装 / 更新脚本

.DESCRIPTION
  1. 把仓库克隆（或更新）到 %USERPROFILE%\.dsh\plugins\dsh-sidebar-cards
  2. Web profile：直接调用 `dsh plugin add <目录>` 完成安装
     Desktop profile：DSH 桌面版的 profile 由 Electron 独占管理，CLI 不能写入，
     脚本会打印「下一步」——在 DSH 里让 Agent 执行一条安装指令即可
  3. 最后提示重启 DSH 桌面版（Client 插件必须重启才生效）

.PARAMETER Profile
  目标 profile，默认 desktop；web profile 可全自动安装。

.PARAMETER Proxy
  可选 HTTP 代理，例如 http://127.0.0.1:7890（国内访问 GitHub 常用）。

.PARAMETER Dir
  安装目录，默认 %USERPROFILE%\.dsh\plugins\dsh-sidebar-cards

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Proxy http://127.0.0.1:7890
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$Proxy = '',
  [string]$Dir = (Join-Path $env:USERPROFILE '.dsh\plugins\dsh-sidebar-cards')
)

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/lnyuqian/dsh-sidebar-cards.git'

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }

Write-Step "检查运行环境"
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) { Write-Warn2 "未找到 dsh 命令；仍会完成克隆，安装步骤请按最后提示手动执行" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw '未找到 git，请先安装 Git for Windows' }
Write-Ok "git $((git --version) -replace 'git version ','')"

$gitProxyArgs = @()
if ($Proxy) { $gitProxyArgs = @('-c', "http.proxy=$Proxy", '-c', "https.proxy=$Proxy") }

Write-Step "准备目录 $Dir"
New-Item -ItemType Directory -Force -Path (Split-Path $Dir) | Out-Null
if (Test-Path (Join-Path $Dir '.git')) {
  Write-Host "    已存在仓库，执行更新…"
  Push-Location $Dir
  try { & git @gitProxyArgs pull --ff-only } finally { Pop-Location }
  Write-Ok "已更新到最新"
} else {
  if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
  & git @gitProxyArgs clone --depth 1 $repo $Dir
  Write-Ok "已克隆到 $Dir"
}

Write-Step "安装到 DSH profile（$Profile）"
$installed = $false
if ($dsh) {
  try {
    & dsh plugin --profile $Profile add $Dir 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -eq 0) { $installed = $true; Write-Ok 'dsh plugin add 完成' }
  } catch {
    Write-Warn2 ("CLI 安装失败：" + $_.Exception.Message)
  }
}

if (-not $installed) {
  if ($Profile -eq 'desktop') {
    Write-Warn2 'DSH 桌面版的 profile 由 Electron 独占管理，CLI 不能直接写入（这是 DSH 的既定限制）'
  }
  Write-Host @"

    下一步（二选一，30 秒完成）：

    A. 在 DSH 里对 Agent 说：
       安装插件 $Dir

    B. 打开 DSH 插件页 → 「从本地安装」→ 选择目录：
       $Dir

"@ -ForegroundColor White
}

Write-Step "完成"
Write-Host @"
    最后一步：完全退出并重新启动 DSH 桌面版。
    首次启动后，左侧栏应变为：插件 / 一周会话 / 置顶会话 / 自动化任务会话 / 工作区。
    卸载：在插件页停用 dsh-sidebar-cards，或让 Agent 执行 remove_bundle，然后重启。
"@ -ForegroundColor White

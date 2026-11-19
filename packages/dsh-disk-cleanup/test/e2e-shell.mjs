/**
 * 端到端：把本插件生成的 pwsh / bash 前缀真的丢给 shell 跑一遍，
 * 确认 TMP/TEMP 真的被改到 scratch，且用户自己设过的临时目录不被覆盖。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { repoUrl, recorder, tempDir } from './_helpers.mjs'

const { injectShellTemp } = await import(repoUrl('lib/shell-env.js'))

const BASE = tempDir('shell')
const SCRATCH = join(BASE, 'cache', 'scratch')
mkdirSync(SCRATCH, { recursive: true })

const { check, finish } = recorder()

const runPwsh = (command) => execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim()

// 1) 插件生成的前缀 + 读 TEMP
const cmd = injectShellTemp('pwsh', 'Write-Output $env:TEMP', SCRATCH)
check('生成的命令串确实带上了 scratch', cmd.includes(SCRATCH), cmd.slice(0, 120))
const temp = runPwsh(cmd)
check('pwsh 里 $env:TEMP 指向 scratch', temp.toLowerCase() === SCRATCH.toLowerCase(), temp)

// 2) 在子进程里用临时目录惯用法真的落到 scratch
const probe = injectShellTemp('pwsh', '$f = Join-Path $env:TEMP \'from-shell.ps1\'; \'Write-Host hi\' | Set-Content $f; Write-Output $f', SCRATCH)
const created = runPwsh(probe)
check('脚本真的写进 scratch', created.toLowerCase().startsWith(SCRATCH.toLowerCase()), created)

// 3) 用户自己设了 TEMP → 不覆盖
const userTemp = 'D:\\custom-temp'
const userCmd = injectShellTemp('pwsh', '$env:TEMP=\'' + userTemp + '\'; Write-Output $env:TEMP', SCRATCH)
check('用户自己设的 TEMP 不被覆盖', runPwsh(userCmd) === userTemp)

// 4) bash 形态的前缀语法（只校验生成文本）
const bashCmd = injectShellTemp('bash', 'echo $TMPDIR', SCRATCH)
check('bash 前缀导出 TMPDIR/TMP/TEMP',
  bashCmd.includes('export TMPDIR=') && bashCmd.includes('TMP=') && bashCmd.includes('TEMP='), bashCmd)

finish()
rmSync(BASE, { recursive: true, force: true })

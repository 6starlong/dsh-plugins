# @6starlong/dsh-disk-cleanup

[![npm](https://img.shields.io/npm/v/@6starlong/dsh-disk-cleanup?color=cb3837)](https://www.npmjs.com/package/@6starlong/dsh-disk-cleanup) [![downloads](https://img.shields.io/npm/dm/@6starlong/dsh-disk-cleanup?color=4c1)](https://www.npmjs.com/package/@6starlong/dsh-disk-cleanup) [![license](https://img.shields.io/npm/l/@6starlong/dsh-disk-cleanup?color=007ec6)](https://www.npmjs.com/package/@6starlong/dsh-disk-cleanup)

临时文件集中写到缓存目录并自动过期回收，工作区只留用户要的文件。

模型写出的探针脚本默认落在工作区内。这个插件给 shell 命令注入临时目录变量、补齐 scratch 目录的写入权限、在系统提示里说明临时文件该写哪里，并按保留天数清理过期文件与无主附件。不改写工具入参的路径：写哪里由提示词引导，不由插件替模型决定。

## 它做什么

| 机制 | 做法 |
|---|---|
| shell 环境注入 | 在 `pwsh` / `bash` 命令串前设置 `TMP` / `TEMP` / `TMPDIR`，指向 `<DSH_HOME>/cache/scratch` |
| 权限补齐 | 注册会话可写根，并给 scratch 补访问控制项，让受限子进程也能写 |
| 系统提示 | 点明临时文件写 scratch、用户文件留工作区；路径每次现算，只读会话不出这段 |
| 过期清理 | 按保留天数清 scratch 过期条目与请求图片缓存，回收无主附件，加载时与之后定期各扫一次 |

## 临时文件写哪

| 权限模式 | 位置 |
|---|---|
| workspace-write / danger-full-access | `<DSH_HOME>/cache/scratch` |
| read-only | 不启用 |
| 配置了 `scratchDir` | 配置指定的目录，不参与自动清理 |

`<DSH_HOME>` 默认 `~/.dsh`，跟随 `DSH_HOME` 环境变量；所有可写模式共用同一位置。workspace-write 下插件在会话创建时就注册可写根（文件工具）与访问控制项（子进程）；非 Windows 只做前者，任一步失败退到 `<工作区>/cache/scratch`。

## 过期清理

- **删什么**：`cache/scratch` 下最后修改时间早于分界线的顶层条目（整目录删），以及 scratch 内的空目录、`<DSH_HOME>` 下一级的空目录。
- **附件**：请求图片缓存按同样的保留天数清；原件先扫全部会话，只删零引用且过期的。会话读不全或没提取到引用时整批跳过，首次运行只统计不删。
- **何时清**：插件加载时一次，之后每 6 小时最多一次。
- 配置里自己指定 `scratchDir` 时，那个目录不自动清。

「过期清理」配置区可以关掉自动清理、调整保留天数（1–365，留空恢复默认 3 天）。

## 安装

在 DSH 的插件管理页里安装，或者用命令行装：

```powershell
dsh plugin --profile <profile> add @6starlong/dsh-disk-cleanup
```

安装后重启 DSH 生效。

## 配置

「过期清理」配置区只管 `autoCleanup` 与 `cleanupMaxAgeDays`；其余字段在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- id: dsh-disk-cleanup
  name: '@6starlong/dsh-disk-cleanup'
  config:
    enabled: true
    scratchDir: ''              # 留空 = 默认暂存目录并自动清理
    injectShellTemp: true       # pwsh/bash 的 TMP/TEMP 指向 scratch
    grantProcessWrite: true     # 给 scratch 补访问控制项
    promptSection: true         # 往系统提示里加一段说明
    autoCleanup: true
    cleanupMaxAgeDays: 3        # 1–365
```

## 边界

- read-only 不注入、不建目录；清理照常。
- 只清 scratch 与 `<DSH_HOME>` 下一级空目录，系统临时目录里 DSH 自建的文件不接管。
- 单个条目被占用或读不到就跳过，不中断整批。

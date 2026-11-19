# dsh-starlong

[![npm](https://img.shields.io/npm/v/dsh-starlong?color=444&label=)](https://www.npmjs.com/package/dsh-starlong)

Starlong 的 DSH 固执己见套件：一个插件，多个可独立开关的模块。

## Install

```powershell
dsh plugin --profile <profile> add dsh-starlong
```

安装后重启 DSH 生效。

## Structure

```text
dsh-starlong/
├─ cordis.patch.yml      # 插件行，插入 profile
├─ lib/
│  ├─ index.js           # 入口，装配模块
│  ├─ index.d.ts
│  ├─ core/              # 模块共享代码
│  └─ modules/           # 功能模块
├─ locale/
├─ test/
└─ README.md
```

## Modules

| 模块 | 作用 |
| --- | --- |

## License

[MIT](./LICENSE)

# ✧ 米哈游启动器背景提取器

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一键提取米哈游启动器中的动态背景视频与宣传图片，纯前端运行，不上传任何文件。

## 功能

- 🎬 提取启动器动态背景视频（.webm/.mp4）
- 🖼️ 提取游戏宣传图片（.png/.jpg/.webp）
- 📄 扫描缓存配置文件（.json/.html/.js 等）
- ⚡ 拖拽上传或点击选择文件，支持多选 `data_0`~`data_3`
- 📊 扫描进度可见，随时可取消（点「取消」或按 `Esc`）
- 🔎 按 视频 / 图片 / 其他 分类统计与筛选
- 📋 一键复制资源链接，点击即可预览
- 🚀 单次线性扫描 + 分块读取，大文件不卡顿、不占内存

## 使用方法

1. 打开米哈游启动器（让它加载过背景）
2. 进入缓存目录：
   ```
   %AppData%\miHoYo\HYP\1_1\fedata\Cache\Cache_Data
   ```
3. 选择 `data_1` 文件（可多选 `data_0`~`data_3`）
4. 等待扫描完成，即可预览和下载资源

## 在线使用

点击此链接使用：https://sophie92-spec.github.io/fictional-fortnight/

## 效果图

![效果图](效果图/b4420528dee7992664361d4d9f5956ac.png)

## 项目结构

```
index.html            页面结构
css/style.css         全部样式
js/script.js          扫描与交互逻辑
tests/scan.test.mjs   扫描核心的单元测试（开发用，不参与页面加载）
```

## 技术说明

- 纯前端 HTML + CSS + JavaScript，静态部署，无需构建
- 通过解析 Chromium Simple Cache 格式，从字节流中提取资源链接
- 扫描用 `Uint8Array#indexOf` 直接跳到下一个 `h`，配合 256 项字符查表判断 URL 边界，
  不再逐字节调用函数；块尾被截断的链接丢弃，交给下一块的 64 KB 重叠窗口补全
- 8 MB 分块读取，避免大文件一次性读入内存；去重键在扫描过程中即写入 `Set`，
  内存里只保留唯一资源
- 结果只渲染一次，筛选通过显隐分组实现（不重建 DOM，预览不会重新加载）；
  每组先渲染 80 条，其余点「展开」再补，避免上千条结果时卡顿
- 尊重 `prefers-reduced-motion`；标签页隐藏时暂停星空与流星动画

## 测试

```bash
node tests/scan.test.mjs
```

覆盖 URL 边界、标点剔除、块尾截断、跨块补全、按资源去重、进度回调、中断、分类映射。
扫描核心可直接在 Node 中运行（`js/script.js` 里以 `scan-core` 注释标记出可测试区间）。

## License

[MIT](LICENSE)

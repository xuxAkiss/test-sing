# GitHub Pages 手机 HTTPS 测试指南

这个部署方式把职责分成两部分：

- GitHub Pages 托管 React 静态前端，并提供手机麦克风所需的 HTTPS。
- 本地电脑运行 Python、Demucs 和评分 API，再通过临时 Cloudflare Tunnel 提供 HTTPS 地址。

Pages 可以一直在线；但上传、伴奏生成和评分期间，电脑上的后端与隧道终端都必须保持运行。

## 第一次部署

1. 将部署分支合并到 `main`。
2. 打开仓库的 `Settings` → `Pages`。
3. 在 `Build and deployment` 中把 `Source` 设为 `GitHub Actions`。
4. 打开仓库的 `Actions`，等待 `Deploy web app to GitHub Pages` 变成绿色。
5. 前端地址应为 `https://xuxakiss.github.io/test-sing/`。

工作流只部署 `frontend/dist`，不会把本地录音、模型缓存或 `data/` 上传到 GitHub。

## 每次手机测试

第一次先安装 Cloudflare Tunnel。脚本只写入项目的 D 盘 `.vendor` 目录：

```powershell
cd D:\project_ex1
powershell -ExecutionPolicy Bypass -File scripts/install_cloudflared.ps1
```

打开终端一，启动本地评分后端：

```powershell
cd D:\project_ex1
powershell -ExecutionPolicy Bypass -File scripts/run_public_backend.ps1
```

看到后端启动后，打开终端二，启动临时 HTTPS 隧道：

```powershell
cd D:\project_ex1
powershell -ExecutionPolicy Bypass -File scripts/run_public_tunnel.ps1
```

复制终端二显示的 `https://随机名称.trycloudflare.com`。用 PowerShell 生成手机入口链接：

```powershell
$api = "https://随机名称.trycloudflare.com"
"https://xuxakiss.github.io/test-sing/?api=$([uri]::EscapeDataString($api))"
```

把生成的完整链接发到手机并打开。网页会把后端地址保存在当前浏览器的本地存储中；同一个隧道存活期间，普通刷新不需要重新输入。

Quick Tunnel 每次重启都会得到新地址。地址变化后，重新生成一次带 `?api=` 的手机链接即可，不需要重新构建 GitHub Pages。

## 结束测试

在隧道终端和后端终端分别按 `Ctrl+C`。临时公网地址随隧道进程结束而失效。

Quick Tunnel 只用于开发测试。不要长时间无人看管地暴露评分接口，也不要把 `trycloudflare.com` 地址当成正式生产地址。

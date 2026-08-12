# Karaoke Pitch Lab

这是一个从零构建的智能 K 歌评分项目。当前已经完成可运行、可测试的音频评分引擎、本地 Web API 和响应式 Web 客户端：上传原唱后生成伴奏与参考音调线，再上传用户演唱并输出 DTW 对齐、分项评分与 SVG 对比图。

## 当前能力

- 读取常见 PCM WAV（8/16/24/32 位）
- 通过可选 FFmpeg 运行时导入 M4A、MP3 等压缩音频
- 使用 YIN 算法提取单音音高
- 自动估计用户录音相对参考音频的整体延迟
- 使用受约束 DTW 对齐不同前奏长度、段落偏移和局部速度变化
- 允许稳定的整八度演唱迁移
- 输出音准、节奏、完整度、稳定性和总分
- 生成无需绘图库的 SVG 音高对比图
- 使用 Demucs 从原唱和外放伴奏手机录音中提取人声
- FastAPI 上传、任务进度、伴奏、参考音调线和演唱评分接口
- D 盘本地任务存储、上传限制、重复歌曲缓存和失败恢复
- React + TypeScript 手机优先界面、伴奏播放器和滚动音调线
- 浏览器麦克风录音、客户端 YIN 实时音高检测和双轨音调线
- 歌曲处理进度、演唱上传、评分指标与音高对比图完整流程
- 使用合成旋律完成可重复的自动测试

当前版本已经完成离线音频引擎、后端 API、手机优先 Web MVP 和浏览器实时演唱模式验证。用户允许麦克风后可以边播放伴奏边查看实时音高，结束时录音会自动提交服务端高精度复算。规则分数仍是工程 baseline，尚未使用人工评分数据校准。

## 环境要求

- Python 3.11 或更高版本
- NumPy 1.26 或更高版本
- Node.js 22 或更高版本（仅 Web 客户端）
- pnpm 11 或更高版本（仅 Web 客户端）

## 快速体验

生成一组内置的参考旋律与轻微跑调示例，并立即分析：

```powershell
python -m audio_engine demo --output demo_output
```

结果位于 `demo_output/result/`：

- `report.json`：评分和对齐信息
- `reference_pitch.csv`：参考音高轨迹
- `performance_pitch.csv`：用户音高轨迹
- `performance_pitch_raw.csv`：DTW 前的原始用户音高轨迹
- `alignment_map.csv`：参考歌曲时间与用户录音时间的映射
- `pitch_comparison.svg`：两条音调线的可视化

检查一段手机录音，不需要参考旋律：

```powershell
python -m audio_engine inspect `
  --input myvoice/七里香.m4a `
  --output artifacts/七里香
```

这会生成音高轨迹、信号质量报告，并在检测覆盖率异常偏高时提示外放音乐污染风险。

分析自己的参考音频和演唱音频：

```powershell
python -m audio_engine analyze `
  --reference path/to/reference.wav `
  --performance path/to/performance.m4a `
  --output output `
  --max-shift-seconds 10 `
  --alignment dtw `
  --dtw-band-seconds 30
```

评分默认允许稳定的整八度声域迁移，并记录被八度归一化的帧比例。这适合男女声或不同声域演唱；节奏、完整度和稳定性仍单独计分。

M4A/MP3 输入需要 FFmpeg：

```powershell
python -m pip install -e ".[media]"
```

人声分离环境（默认安装体积较小的 CPU 版本）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_separation.ps1
```

需要 CUDA 版本时可以显式选择：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install_separation.ps1 -Compute cu128
```

安装脚本会把 `.venv`、安装临时文件和 PyTorch 模型缓存都放在当前项目目录，避免占用系统盘。依赖安装使用 `--no-cache-dir`，不会另外保留大型 wheel 缓存。

分离一段手机录音并自动生成分离前后报告：

```powershell
.venv\Scripts\python -m audio_engine separate `
  --input myvoice/七里香.m4a `
  --output artifacts/full_separation/七里香 `
  --device cpu
```

## 启动 Web 应用

安装 Web 和测试依赖，所有内容仍位于 D 盘项目虚拟环境：

```powershell
.venv\Scripts\python -m pip install --no-cache-dir -e ".[web,test]"
```

启动局域网 API：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_backend.ps1
```

另开一个终端安装并启动前端：

```powershell
pnpm --dir frontend install
pnpm --dir frontend dev
```

电脑打开 `http://127.0.0.1:5173` 使用完整界面；`http://127.0.0.1:8000/docs` 是 API 交互文档。手机与电脑在同一局域网时，访问 `http://电脑的局域网IP:5173`。

麦克风 API 受浏览器安全策略限制：电脑本机的 `localhost` 可以直接使用；手机访问局域网 HTTP 地址时仍可上传已有录音，但实时演唱需要部署到有效 HTTPS 地址。正式部署平台通常会自动提供 HTTPS。

前端工程检查：

```powershell
pnpm --dir frontend lint
pnpm --dir frontend test
pnpm --dir frontend build
```

面向手机的客户端/服务端职责划分见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

三首真实录音的 DTW 复评结果与可信度限制见 [docs/EXPERIMENT_004_DTW_SCORING.md](docs/EXPERIMENT_004_DTW_SCORING.md)。

Web API、数据目录、接口与端到端测试说明见 [docs/WEB_MVP_BACKEND.md](docs/WEB_MVP_BACKEND.md)。

Web 客户端状态流、组件划分与浏览器验收说明见 [docs/WEB_MVP_FRONTEND.md](docs/WEB_MVP_FRONTEND.md)。

运行测试：

```powershell
.venv\Scripts\python -m unittest discover -s tests -v
```

## 评分说明

当前评分是可解释的规则基线，而不是训练模型：

- 音准 55%：配对帧的音分误差
- 节奏 20%：参考与用户有声区间的重合程度
- 完整度 15%：应唱区间中实际唱出的比例
- 稳定性 10%：稳定参考音内的相对音高抖动

最终分数用于建立后续模型实验的 baseline，不代表专业声乐评价。

## 路线图

详细阶段和验收标准见 [docs/ROADMAP.md](docs/ROADMAP.md)。

GitHub Pages 与本地 HTTPS 后端的手机测试步骤见 [docs/GITHUB_PAGES_GUIDE.md](docs/GITHUB_PAGES_GUIDE.md)。

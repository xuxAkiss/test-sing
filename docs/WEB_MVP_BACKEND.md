# Web MVP 后端

## 目标

把已有的人声分离、音高提取、DTW 对齐和评分能力封装成手机浏览器可以调用的 HTTP API。第一版面向单机和局域网演示，不依赖数据库、Redis 或云存储。

## 数据目录

运行数据默认写入项目下的 `data/`，该目录已加入 `.gitignore`：

```text
data/
├── incoming/       # 尚未归档的上传临时文件
├── jobs/           # 每个后台任务一份 JSON 状态
├── songs/          # 原唱、分离结果、伴奏和参考音调线
└── performances/   # 演唱录音、分离结果和评分报告
```

接口只返回资源 URL，不暴露服务器绝对文件路径。上传采用分块写入并计算 SHA-256；相同原唱处理成功后再次上传会直接命中缓存。参考音调版本升级时，旧缓存会自动跳过并重新生成。

默认允许来自 localhost 和私有局域网地址的浏览器开发页面跨域访问，但拒绝公网来源。需要自定义时可设置 `KARAOKE_CORS_ORIGIN_REGEX`。

## API

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 服务健康检查 |
| POST | `/api/songs` | 上传原唱并创建后台任务 |
| GET | `/api/jobs/{job_id}` | 查询处理状态和进度 |
| GET | `/api/songs/{song_id}` | 查询歌曲元数据和资源 URL |
| GET | `/api/songs/{song_id}/accompaniment` | 播放或下载伴奏 |
| GET | `/api/songs/{song_id}/pitch` | 获取紧凑参考音高帧 JSON |
| POST | `/api/songs/{song_id}/performances` | 上传一次用户演唱 |
| GET | `/api/performances/{performance_id}` | 获取分项评分和结果 URL |
| GET | `/api/performances/{performance_id}/comparison` | 获取音调对比 SVG |

演唱上传使用 `multipart/form-data`。完整演唱只提交 `file`；片段演唱额外同时提交 `segment_start_seconds` 与 `segment_end_seconds`。后端会校验片段至少 5 秒且不超出歌曲时长，然后裁出完全相同范围的原唱人声再进行 DTW 与完整度评分。

`/api/songs/{song_id}/pitch` 的版本 2 数据带有 `source: "separated_original_vocals"`，只从分离后的原唱人声轨提取，并移除低可信或不足 100 毫秒的零碎音高段。

## 启动

安装 Web 依赖：

```powershell
.venv\Scripts\python -m pip install --no-cache-dir -e ".[web,test]"
```

启动局域网服务：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_backend.ps1
```

电脑浏览器打开 `http://127.0.0.1:8000/docs` 查看交互式接口文档。手机与电脑连接同一局域网后，使用电脑局域网 IP 和端口 8000 访问；Windows 防火墙首次可能请求放行。

## 当前限制

- 任务由进程内单工作线程执行，服务关闭时不会继续处理。
- Demucs 暂时只能报告阶段级进度，不能显示精确百分比。
- 伴奏目前以 WAV 返回，后续前端阶段再增加 AAC/Opus 压缩缓存。
- 第一版没有账号系统，不能直接暴露到公网。

## 测试

普通测试使用轻量假处理器，不会启动 Demucs：

```powershell
.venv\Scripts\python -m unittest discover -s tests -v
```

显式运行真实 HTTP → Demucs → 音高 → DTW 端到端测试：

```powershell
$env:KARAOKE_RUN_INTEGRATION = "1"
.venv\Scripts\python -m unittest tests.test_backend_integration -v
```

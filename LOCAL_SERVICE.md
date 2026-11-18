# 后端配置与本地运行

本文面向本地运行者和部署人员。Vue 前端通过同域 `/api/` 调用 FastAPI，后端负责模型请求、TikHub 搜索、任务状态和调用用量记录。

## 安装与启动

首次安装的完整命令见 [README](README.md#安装与运行)。将 `backend/.env.example` 复制为 `backend/.env` 后填写两个密钥，已有配置文件应保留。

```bash
npm run dev
```

该命令同时启动前端 `127.0.0.1:51458` 和后端 `127.0.0.1:51460`。也可分别运行 `npm run dev:frontend`、`npm run dev:backend`。启动脚本优先使用 `backend/.venv`，可用 `DILONG_PYTHON` 指定其他 Python 解释器，用 `DILONG_BACKEND_PORT` 指定后端端口。

修改 `.env` 后重启后端，刷新浏览器不会重新加载后端配置。

## 配置字段

默认配置使用百炼北京地域；两个模型共用 `MODEL_API_KEY`，TikHub 使用独立密钥。普通平台使用者不需要输入 Key，调用消耗部署者所配置账户的额度。

| 字段 | 默认值 / 用途 |
| --- | --- |
| `MODEL_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `MODEL_API_KEY` | 百炼 API Key，必填于本机 `.env` |
| `MODEL_NAME` | `qwen4-max`，理解检索描述及比较图片 |
| `MODEL_MAX_OUTPUT_TOKENS` | `4096`，单次文字响应输出上限 |
| `MODEL_THINKING_BUDGET` | `1024`，Qwen 思考预算，最多为输出上限一半；`0` 表示关闭思考 |
| `IMAGE_MODEL_NAME` | `qwen-image-3.0-pro`，图片生成与编辑 |
| `IMAGE_API_PROTOCOL` | `dashscope`；也可为兼容图片服务设置 `openai` |
| `TIKHUB_BASE_URL` | `https://api.tikhub.io` |
| `TIKHUB_API_KEY` | TikHub API Key，必填于本机 `.env` |
| `ALLOWED_ORIGINS` | 允许的网站来源，多个来源用英文逗号分隔 |

`ALLOWED_ORIGINS` 填写协议、主机和端口，不包含路径。例如网站部署在 `https://design.example.com/dilong/`，来源填写 `https://design.example.com`。

密钥的业务空间、地域和模型权限应与配置地址匹配。更换服务商时，需要核对其视觉理解、结构化输出和图像接口协议。

## 模型调用

| 功能 | 处理方式 |
| --- | --- |
| 文字搜索 | 编号、完整名称精确匹配直接返回；其他描述由模型拆解关键词，资料初筛后再看图排序 |
| 图片搜索、快速比对 | 结构算法先召回最多 20 项，模型比较候选预览图并重排 |
| 风格迁移 | 提交参考图、目标风格和变化倾向，生成一张编辑图 |
| 自动设计 | 提交参考图和设计要求，按所选数量顺序生成新图片 |

检索只发送预览图；生成和编辑使用完整像素参考图。模型接收的参考图数据限 PNG、JPG、WebP，体积不超过 10 MB，单边不超过 8000 像素，宽高比不超过 10:1。实际输出像素由图片服务返回，平台不自动放大图像。

文字模型使用 `/chat/completions`，检索条件和排序响应采用 JSON。默认图片协议使用同域名的 `/api/v1/services/aigc/multimodal-generation/generation`；设置 `IMAGE_API_PROTOCOL=openai` 时使用 `/images/generations`，参考图通过 JSON 扩展字段 `image` 提交。

风格迁移每次一张；自动设计默认三张，可选择三张或四张，旧任务的一张设置可继续恢复。模型已返回的成功图片会写入浏览器任务，部分失败时可继续生成剩余数量。需要保留的方案请保存为候选，再评价采用。

图片服务单次请求超时为 600 秒，包含结果下载的后台任务超时为 720 秒。取消会结束本机等待，上游是否停止处理及计费取决于服务商。

## TikHub 搜索

在 [TikHub](https://tikhub.io) 创建 API Key，填写 `TIKHUB_API_KEY`，并确认接口权限和可用额度。

| 平台 | 接口 |
| --- | --- |
| 小红书 | `GET /api/v1/xiaohongshu/app_v2/search_notes` |
| 抖音 | `POST /api/v1/douyin/search/fetch_general_search_v1` |

当前搜索通过 TikHub 数据接口完成，前端不需要登录小红书或抖音，也不启动采集浏览器。免费额度是否适用取决于具体接口，应在服务商控制台核对。

每次搜索读取所选平台的一页，点击“加载更多”才继续。平台内保留接口返回顺序，并按平台与帖子编号去重；不同平台的综合列表不提供统一排名。相同条件短时缓存 60 秒，分页会话保留 30 分钟。周期按返回的发布时间筛选，日期缺失内容不计入指定周期。

帖子封面和原帖链接由上游提供，可能过期或要求原站登录。帖子不会自动加入正式样例库。定向研究整理本次帖子与标题词频；趋势预测入口等待持续历史数据；趋势转化将来源链接和填写的要求带入设计任务。

## 数据与用量

个人样例、候选及历史保存在浏览器 IndexedDB。后端任务和帖子分页状态存在当前进程中，服务重启后需要重新发起未完成操作。已完成后台任务保留最长一小时。

后端在 `.dilong-runtime/model-usage.json` 记录最近 1000 次模型调用元数据，`/api/model/usage` 返回最近 100 条。记录包括模型、状态、时间及服务商报告的 Token / 图片数量，不包含密钥、提示词和图片内容。未报告字段保持为空，用量记录不替代服务商账单。

## 连接检查与常见提示

`/api/health` 和 `/api/model/status` 表示配置状态。填写配置后，应分别验证一次图片搜索、图片生成和帖子搜索，确认外部服务可以正常返回结果。

| 提示 | 检查方法 |
| --- | --- |
| 服务无法连接 | 确认 FastAPI 已启动，前端代理或部署网关指向正确后端端口 |
| 密钥无效 / 未获授权 | 核对 Key、地域、业务空间和具体模型或接口权限 |
| 额度不足 / 不支持免费额度 | 核对该接口的计费规则和账户可用额度 |
| 任务不存在 / 服务已重启 | 保存已有结果后重新发起未完成操作 |
| 没有找到符合描述的样例 | 调整关键词或补充样例资料；文字检索依赖现有资料初筛 |

## 部署与凭据管理

上传源码时保留 `.env.example`，不上传真实 `.env`、虚拟环境、运行日志及用户数据。Key 仅在后端配置，不放入前端环境变量。

前端通过 Web 服务器发布，`/api/` 同域转发至 FastAPI；公开使用时由部署方配置 HTTPS、访问控制及费用管理。当前任务状态适合单进程运行，不启用多个 worker。根路径和子目录配置见 [部署指南](MIGRATION.md)。

接口参考：[百炼文本与视觉理解](https://help.aliyun.com/zh/model-studio/text-generation-model)、[Qwen-Image](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)、[结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。

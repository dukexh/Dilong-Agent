# 帝龙装饰纸智能设计平台

面向装饰纸选样、纹理设计与配墨评估的工作台，提供样例管理、图片检索、连续纹理制作、模型设计及图像比对。

项目采用 Vue 3、TypeScript、Vite 和 Tailwind CSS，配合 Python FastAPI 后端调用模型与 TikHub。个人样例、候选及历史记录保存在浏览器 IndexedDB。当前版本面向本机及受控环境试用。

## 功能概览

| 模块 | 功能 |
| --- | --- |
| 首页 | 查看任务、候选方案与配墨记录，打开历史操作 |
| 样例库 | 浏览 2,990 条内置公共及演示样例，按资料或图片检索，导入、导出正式个人样例 ZIP |
| 设计智能体 | 快速比对排序、连续单元制作与扩展、模型风格迁移、参考图自动设计 |
| 配墨智能体 | 初步色层分析、合成预览、红黄蓝黑自由选墨、重量计算和建议单导出 |
| 生产比对 | 两图选区比较、色差与结构指标、差异热图和报告导出 |
| 颜色比对 | 目标色与实涂图比较、配墨建议、代表色色差及偏色方向分析 |
| 趋势洞察 | 通过 TikHub 搜索小红书、抖音帖子，整理专题资料并转为设计参考；趋势预测入口预留 |

设计结果、连续单元及已保存候选支持 TIF / PSD 导出，默认 300 ppi、8 位 RGB。连续工程保留图层和遮罩；普通生成图片导出为单图层 PSD。

## 环境要求

- Node.js：22.22.2 及以上的 22 系列、24.15.0 及以上的 24 系列，或 26.0.0 及以上版本；npm 10 及以上。
- Python 3.12 及以上。
- 支持 Canvas、Web Worker 和 IndexedDB 的现代浏览器。
- 模型功能需要百炼 API Key；真实帖子搜索需要 TikHub API Key 及相应接口权限、额度。

## 安装与运行

以下命令均在项目根目录执行。

### Windows PowerShell

```powershell
npm ci
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

编辑 `backend/.env`，填写 `MODEL_API_KEY` 和 `TIKHUB_API_KEY`，然后启动：

```powershell
npm run dev
```

### Linux / macOS

```bash
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
test -f backend/.env || cp backend/.env.example backend/.env
# 编辑 backend/.env，填写两个 API Key
npm run dev
```

统一启动命令会识别 Windows 与 Linux / macOS 的虚拟环境。访问 <http://127.0.0.1:51458/>；后端监听 `127.0.0.1:51460`。修改后端配置后需要重启服务。配置字段见 [后端配置说明](LOCAL_SERVICE.md)。

### 构建与预览

```bash
npm run build
npm run dev:backend
# 在另一个终端执行
npm run preview
```

构建产物位于 `dist/`，预览地址为 <http://127.0.0.1:51459/>。`python start-local.py` 可仅查看已构建的静态网站，不包含后端或 API 代理。

## 检索与设计

- **文字检索**：输入时按样例资料筛选；按回车或点击放大镜后执行检索。编号、完整名称精确匹配直接返回；自然语言描述先经模型理解，再按资料召回最多 20 项，由模型看图筛选和排序。
- **以图搜图 / 快速比对**：本地算法按纹理形态、疏密与走向召回最多 20 项，再由模型重排。仅正式样例参与检索。
- **风格迁移 / 自动设计**：默认分别使用 `qwen-image-3.0-pro` 编辑或生成图片；检索理解和排序使用 `qwen4-max`，两个模型共用百炼 Key。
- **连续纹理**：自动制作连续单元，确认后按原像素横向扩展 3 倍、5 倍或四周 3×3；当前为周期铺排。
- **结果保存**：模型已返回的成功图片写入任务记录，可选择保存为候选；部分生成失败时可继续生成剩余数量。候选经评价采用后，进入正式样例库。

## 数据与导出

- 浏览器按协议、域名和端口隔离数据，不提供跨设备自动同步。模型执行时会发送必要参考图给配置的模型服务。
- 本地样例 ZIP 包含普通导入样例、已采用候选及其资料，不包含公共图库、未采用候选、设计任务或配墨历史。
- 生产比对与颜色比对的会话可在切换模块后继续，刷新后不恢复完整会话。生产比对可导出报告；颜色比对需自行记录需要保留的数值与备注。
- 公共图库原始档案附带素材来源与许可信息。公共图片为网页展示图，使用前请查阅原始素材信息。
- 工程文件按实际图像像素导出。修改 ppi 不增加图像细节；图像处理受格式尺寸、4000 万像素和浏览器内存预算限制。
- 配墨与图像测量结果供打样参考，需结合光照、设备及工艺条件复核；当前不提供生产专色分版或工业配墨校准。

## 文档

| 文档 | 用途 |
| --- | --- |
| [后端配置与本地运行](LOCAL_SERVICE.md) | 模型、TikHub、密钥与服务配置 |
| [升级与部署指南](MIGRATION.md) | 前后端发布、反向代理、子目录与数据迁移 |
| [样例包制作指南](public/制作自己的样例包.txt) | 准备图片、制作 ZIP、导入与转交 |
| [样例包格式规范](public/样例包格式说明.txt) | 清单字段、容量与兼容规则 |
| [生产比对演示指南](public/demo-pair/操作说明.txt) | 演示图片、选区与报告操作 |
| [界面与主题维护](VISUAL_ADAPTATION.md) | 样式结构、主题、响应式与交互约定 |

可下载 [示例样例包](public/示例样例包.zip) 体验导入流程。

## 项目结构

```text
src/
  pages/          业务页面
  components/     共用组件与工作流
  core/           图像处理、检索、配方与文件编码
  services/       后端调用、浏览器数据与业务类型
  stores/         页面状态
  router/         页面路由
public/           素材、检索索引与可下载说明
backend/          FastAPI、模型与 TikHub 适配
scripts/          启动及素材构建工具
tests/            单元测试与浏览器回归
```

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run type-check` | TypeScript 类型检查 |
| `npm test` | 算法与业务单元测试 |
| `npm run test:backend` | 后端接口与适配测试 |
| `npm run test:browser` | 浏览器流程回归 |
| `npm run test:dist` | 构建产物与部署路径检查 |
| `npm run test:http` | HTTP 与存储受限场景检查 |

浏览器测试使用已安装的 Google Chrome 和独立测试上下文；构建产物测试前先执行 `npm run build`。真实服务需另行验证访问权限及返回结果。

# 升级与部署指南

本文面向部署与维护人员。项目由 Vue 静态前端和 FastAPI 后端组成，完整功能需要同时部署两者。

## 发布前准备

1. 安装依赖，按 [配置说明](LOCAL_SERVICE.md) 填写后端 `.env`，保留已有密钥。
2. 运行类型检查、单元测试及后端测试，构建前端。
3. 保存原发布版本，导出需要保留的正式个人样例、工程图片、建议单和比对报告。
4. 确认更新后的协议、域名与端口；更换访问来源不会自动迁移浏览器数据。
5. 等待正在执行、保存的操作结束后再更新服务。

```bash
npm ci
npm run type-check
npm test
npm run test:backend
npm run build
```

构建产物在 `dist/`，包括脚本、样式、素材和离线检索索引。发布时使用其中的全部文件。Python 依赖安装见 [README](README.md#安装与运行)。

## 后端运行

在项目根目录运行：

```bash
npm run dev:backend
```

启动器默认使用项目虚拟环境，监听 `127.0.0.1:51460`。部署时使用进程管理服务保持其运行，工作目录设为项目根目录，配置文件位于 `backend/.env`。修改配置后重启后端。

当前任务和分页状态在进程内，使用单进程运行。对外服务由网关提供 HTTPS、访问认证与费用管理，后端端口保持内网或回环访问。

## 根路径部署

将 `dist/` 内容发布到静态目录，例如 `/srv/dilong/dist/`。下面是 Nginx 静态路由和 API 转发示例，域名、目录及端口需按实际环境替换：

```nginx
server {
    listen 80;
    server_name design.example.com;
    root /srv/dilong/dist;
    index index.html;
    client_max_body_size 32m;

    location /api/ {
        proxy_pass http://127.0.0.1:51460;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

该 API 配置保留请求中的 `/api/` 前缀。示例展示路由关系，TLS 和访问认证按部署环境配置。不要把整个源码目录设为静态发布目录，避免暴露配置、运行数据及备份。

## 子目录部署

以 `/dilong/` 为例，先按目标路径构建：

Windows PowerShell：

```powershell
$env:DILONG_BASE = '/dilong/'
npm run build
Remove-Item Env:DILONG_BASE
```

Linux / macOS：

```bash
DILONG_BASE=/dilong/ npm run build
```

将产物放入 `/srv/www/dilong/`，Nginx 示例：

```nginx
server {
    listen 80;
    server_name design.example.com;
    root /srv/www;
    index index.html;
    client_max_body_size 32m;

    location = /dilong {
        return 301 /dilong/;
    }

    location /dilong/api/ {
        proxy_pass http://127.0.0.1:51460/api/;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location /dilong/ {
        try_files $uri $uri/ /dilong/index.html;
    }
}
```

此处将 `/dilong/api/` 替换为后端 `/api/`。前端基路径、静态目录与 API 转发必须一致。相关规则见 [Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) 和 [try_files](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)。

在 `ALLOWED_ORIGINS` 中使用网站来源，例如 `https://design.example.com`，不包含 `/dilong/` 路径。仅通过静态托管发布前端时，仍需单独运行后端并设置 API 转发。

## 数据兼容与迁移

业务数据使用浏览器 IndexedDB `dilong-workflows` v2。更新时保持数据库名称和兼容结构，不通过清空网站数据完成升级。

| 数据 | 兼容规则 |
| --- | --- |
| 普通导入样例 | 保留资料，继续作为正式个人样例 |
| 设计候选 | 保留评价状态；仅已采用候选进入正式样例库 |
| 旧独立四方连续任务 | 映射到补全流程的连续单元步骤，继续执行采用新流程 |
| 已保存补全结果与工程参数 | 按保存内容展示和导出 |
| 旧配墨记录 | 缺少选墨字段时按四墨解释，仅改重量不重算旧配方 |
| 仅含元数据的旧记录 | 可查看记录，未保存的图片和分析快照无法恢复 |
| v1 样例包 | 继续支持；候选评价状态保留，不自动采用 |

样例 ZIP 是正式个人样例的交换文件，不包含设计任务、未采用候选或配墨历史。跨浏览器、设备、域名或端口迁移时，通过 ZIP 转交正式样例，其余结果按各页面提供的方式导出。

导入有容量限制，转交前请在目标环境验证样例包可正常导入；确认备份有效后再处理原浏览器数据。格式见 [样例包规范](public/样例包格式说明.txt)。

## 发布验证

- 首页和各业务路由可直接打开、刷新。
- 样式、图片、离线检索索引与 Worker 加载正常。
- 同域 `/api/health` 可返回 JSON；图片检索、生成及帖子搜索可通过配置的服务完成。
- 个人样例、候选评价、连续工程和兼容历史可读取。
- 样例包导入导出、工程文件、建议单和报告下载正常。
- 窄屏和明暗主题下可完成主要操作。

可使用 `npm run test:browser`、`npm run test:dist`、`npm run test:http` 检查流程与部署路径。真实接口权限和返回结果需在目标环境另行验证。

公共图库或纹理算法变化时运行 `npm run build:search-index`，将清单、对应二进制索引及演示图片一起发布。仅新增个人样例无需重建公共索引。

## 回退与排查

回退时恢复相匹配的前端、后端与配置，保持原网站访问来源，并先确认数据库兼容性。网页版本回退不会自动回退浏览器数据。

| 现象 | 检查项 |
| --- | --- |
| 页面或素材缺失 | `dist/` 是否完整发布，构建基路径是否正确 |
| 刷新业务路由返回 404 | 静态服务器是否回退到对应 `index.html` |
| API 返回 HTML 或 404 | API 路由是否被静态页面回退覆盖，代理前缀是否正确 |
| 更换地址后看不到个人记录 | 浏览器、协议、域名、端口是否与原数据来源一致 |
| 不能导出本地样例包 | 是否存在正式个人样例，当前是否正在导入或导出 |
| 任务显示“状态待确认” | 先确认其他窗口没有继续执行，再处理该任务 |

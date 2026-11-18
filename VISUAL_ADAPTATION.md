# 界面与主题维护

本文面向前端维护者，说明帝龙工作台的样式结构、主题边界和交互约定。

## 设计原则

- 以纹理图像、色样、配方和测量结果为主要内容，减少重复装饰与常驻解释。
- 保持清晰的页面标题、区域标题、状态、主操作和次操作层级。
- 图片保持原始比例，放大查看与页面预览分开处理。
- 状态同时使用文字或图标表达，数据颜色与界面主题颜色分开。
- 功能与数据范围以 [README](README.md) 为准，使用方法写入相应操作文档。

## 样式结构

| 位置 | 职责 |
| --- | --- |
| `src/assets/css/style.css` | 全局导入顺序、Tailwind 扫描范围、主题别名 |
| `harness-theme.css` | `.dilong-theme` 内的 `--dl-*` 变量、明暗主题和宿主变量回退 |
| `harness-components.css` | 侧栏、标题、按钮、卡片、表单与焦点等共用样式 |
| `components/*.css` | 业务、图库、弹窗及壳层样式 |
| `workspace.css`、`workspace-polish.css` | 工作区布局与共享细节 |
| `readable-type.css`、`sample-archive.css` | 排版和样例档案样式 |
| Vue 单文件组件局部样式 | 具体模块的布局与交互状态 |

上表中的 CSS 文件均位于 `src/assets/css/`。修改前先检查导入顺序和选择器作用域，避免以重复覆盖解决局部布局问题。

## 主题与组件边界

主题变量限定在 `.dilong-theme` 中，支持独立运行的明暗回退，也保留对宿主 `--dsw-alias-*` 变量的映射。宿主插件的注册和挂载由集成方另行处理。

`App.vue` 从 CSS 变量读取 Ant Design 主题，并将弹出层挂载到主题容器。原生 `dialog` 和 Teleport 内容需要保留主题类。

字体继承主题设置；数值和单位使用稳定的对齐规则。图像、材质色块和测量热图属于业务数据，不随界面主题重新着色。

## 布局与响应式

- 使用内容决定面板高度；固定高度只用于有明确用途的预览或滚动区域。
- 图片使用适当的包含显示与尺寸约束，避免将小图拉伸为整页大图。
- 表格、数值与操作区域按统一列规则排列，错误提示和空选择不应造成相邻控件跳动。
- 窄屏下允许工作区按步骤换行；弹窗需限制在视口内，并保留可滚动内容和关闭入口。
- 布局修改同时检查默认、加载、空结果、错误、历史恢复和手动调整展开状态。

## 表单与交互

- 配方参数区分草稿和已确认值，确认结果应在保存成功后展示。
- 加载、禁用和选中状态清晰可辨；长任务提供状态和支持的取消操作。
- 按钮、输入、分段选项、图片查看和弹窗具备键盘操作与可见焦点。
- 弹窗关闭后尽量将焦点还给触发入口；删除或筛选行后保留合理的焦点位置。
- 尊重减少动态效果的系统偏好，不使用影响数值核对的位移动画。

## 验证

使用 `npm run test:browser` 检查业务与布局流程，使用 `npm run test:dist` 检查构建后的路由、资源和窄屏展示。必要时单独运行布局、主题及交互测试文件。

视觉调整应覆盖桌面和手机、明暗主题、展开和收起状态，并保留现有事件、数据绑定和业务确认机制。

## 设计参考与署名

主题映射与部分交互组织参考了 SB / DeepSeek Harness 及以下项目；实际尺寸和布局以本仓库为准：

- [DSH 社区插件目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：主题及界面实现参考。
- [File Explorer](https://github.com/439436269-ctrl/dsh-file-explorer)、[Plugin Versions](https://github.com/ACGNnsj/dsh-plugin-versions)：列表、列对齐和状态层级。
- [Prompt Forge](https://github.com/Aliboder/dsh-prompt-forge)、[Spotlight](https://github.com/0xsline/dsh-spotlight)：表单、焦点与弹出层组织。
- [Theme Studio](https://github.com/cherrchen/dsh-theme-studio)、[Prism Themes](https://github.com/elalamiimed/dsh-prism-themes)、[E-Ink Retro](https://github.com/exoticknight/dsh-theme-eink-retro)：主题变量与表面层级。
- [unslop](https://github.com/heydamir/unslop/tree/main/skills/unslop)：审查与分层修订方法，作者 Damir Sokolovsky（@heydamir），CC BY 4.0。

使用参考项目的具体代码或资源时，应遵守对应版本的许可和署名要求。

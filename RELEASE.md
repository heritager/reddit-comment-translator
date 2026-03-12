# 发布说明模板

这个文件用于整理 GitHub Release 和 GreasyFork 页面说明文案。

## GitHub Release 标题示例

```text
v4.0.1 - BYOK translation providers and release polish
```

## GitHub Release 内容模板

```markdown
## 更新内容

- 新增 OpenAI-compatible BYOK 支持
- 支持在 Tampermonkey 菜单中配置 provider、API Key、endpoint 和 model
- 优化 Reddit 评论节点处理逻辑
- 增加本地持久缓存
- 补充中文 README、LICENSE 和 GitHub 模板

## 安装方式

1. 安装 Tampermonkey
2. 导入 `reddit-comment-translator.user.js`
3. 打开 Reddit 页面后根据需要配置翻译 provider

## 注意事项

- 默认 `google` 模式依赖公开端点
- `openai` 模式需要用户自己提供兼容的 API
- 请不要在 issue 中公开你的 API Key
```

## GreasyFork 简介示例

```text
为 Reddit 评论区添加翻译按钮，支持默认翻译模式，也支持用户自定义 OpenAI-compatible API。
```

## GreasyFork 详细说明模板

```markdown
### 这是什么

这是一个 Reddit 评论翻译脚本。安装后，评论区会出现“翻译”按钮。

### 支持的站点

- reddit.com
- old.reddit.com
- new.reddit.com
- sh.reddit.com

### 支持的翻译方式

- 默认翻译模式
- 用户自定义 OpenAI-compatible API

### 如何配置

安装脚本后，打开 Reddit 页面，在 Tampermonkey 菜单中设置：

- provider
- target language
- endpoint
- API key
- model

### 说明

- 本脚本不提供后端服务
- API 请求直接从浏览器发送到用户配置的服务
- 请不要把自己的 API Key 泄露给他人
```

## 发布前检查清单

- [ ] `README.md` 已更新
- [ ] `LICENSE` 已存在
- [ ] userscript 版本号已递增
- [ ] Tampermonkey 菜单项可正常使用
- [ ] `google` 模式可用
- [ ] `openai` 模式可用
- [ ] 在至少一个 Reddit 评论页完成手动验证

# Reddit 评论翻译脚本

这是一个运行在 Tampermonkey（油猴）上的 Reddit 评论翻译脚本。

安装后，Reddit 评论区会出现 `翻译` 按钮。你可以直接使用默认翻译模式，也可以填写你自己的 OpenAI-compatible API 来进行翻译。

## 功能简介

- 支持 `reddit.com`、`old.reddit.com`、`new.reddit.com`、`sh.reddit.com`
- 在评论旁边添加 `翻译` 按钮
- 支持默认翻译模式
- 支持用户自定义 OpenAI-compatible API
- 支持本地缓存，减少重复请求
- 支持在 Tampermonkey 菜单中修改配置

## 1. 怎么安装油猴

油猴的英文名是 `Tampermonkey`，它是浏览器扩展，不是单独的软件。

安装步骤：

1. 打开你正在使用的浏览器扩展商店。
2. 搜索 `Tampermonkey`。
3. 找到扩展后点击安装。
4. 安装完成后，浏览器工具栏通常会出现 Tampermonkey 图标。

常见浏览器：

- Chrome：到 Chrome Web Store 搜索 `Tampermonkey`
- Edge：到 Edge 加载项商店搜索 `Tampermonkey`
- Firefox：到 Firefox Add-ons 搜索 `Tampermonkey`

安装完成后，先确认扩展已经启用。

## 2. 怎么安装插件

这里的“插件”指的是这个 userscript 脚本文件，不是浏览器扩展。

安装步骤：

1. 打开 Tampermonkey 面板。
2. 选择“创建新脚本”或 `Create a new script`。
3. 删除编辑器里默认生成的内容。
4. 打开仓库中的 `reddit-comment-translator.user.js`。
5. 把这个文件的完整内容复制进去。
6. 保存脚本。
7. 打开任意 Reddit 评论页并刷新页面。

如果安装成功，评论区附近会出现 `翻译` 按钮。

## 3. 怎么配置翻译服务

安装完成后，打开 Reddit 页面，再点开 Tampermonkey 菜单，你会看到这个脚本提供的配置项。

可配置内容包括：

- 切换翻译服务
- 设置目标语言
- 设置 OpenAI-compatible Endpoint
- 设置 OpenAI-compatible API Key
- 设置 OpenAI-compatible 模型
- 清空缓存

## 默认翻译模式

默认 provider 是 `google`。

优点是开箱即用，缺点是它依赖公开端点，稳定性不一定长期有保证。如果你更在意可控性，建议使用你自己的 API。

## 使用你自己的 API

如果你想接入自己的 OpenAI-compatible API：

1. 在 Tampermonkey 菜单里把 provider 切换成 `openai`
2. 填入你自己的接口地址
3. 填入你自己的 API Key
4. 填入你要使用的模型名

一个常见的接口地址示例：

```text
https://api.openai.com/v1/chat/completions
```

只要你的服务兼容 OpenAI Chat Completions 接口格式，通常都可以接入。

## 权限说明

脚本使用了 `@connect *`。

这是为了支持“用户自定义 API 域名”。因为 Tampermonkey 需要提前声明网络访问权限，如果这里只写死少数几个域名，就没法真正支持用户填写自己的接口地址。

## 隐私说明

- 脚本本身不带后端服务
- 请求会直接从你的浏览器发到你配置的翻译服务
- 如果你配置了自己的 API Key，它会保存在你本地的 Tampermonkey 存储中

## 已知限制

- Reddit 页面结构变化后，脚本可能需要更新选择器
- 默认翻译模式依赖公开端点，不保证一直稳定
- AI 翻译通常更慢，而且可能产生费用
- 保存在 userscript 环境里的 API Key 只适合个人使用，不适合高安全场景

## 开源协议

本项目使用 `MIT License`。

你可以自由使用、修改、分发，但请保留原始版权和许可证文本。详细内容见 `LICENSE` 文件。

## 问题反馈与贡献

如果你在使用过程中遇到问题，或者想提出功能建议，可以直接在 GitHub 仓库中提交：

- Bug 反馈
- 功能建议
- Pull Request

如果你准备提交代码，建议优先说明：

1. 问题出现在哪个 Reddit 页面
2. 使用的是哪种翻译 provider
3. 是否配置了自定义 API
4. 浏览器和 Tampermonkey 版本

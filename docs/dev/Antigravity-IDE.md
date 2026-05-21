---
title: Antigravity IDE 扩展链接说明
sidebar_label: Antigravity IDE
description: 简要记录 Antigravity IDE 在扩展插件机制中使用的三类核心链接与协议及其对应用途。
---

# Antigravity IDE 扩展链接说明

在配置和使用 Antigravity IDE 的过程中，以下三个链接和协议分别用于不同的功能场景：

### 1. `antigravity-ide:extension/openai.chatgpt`
* **类型**：自定义 URL 协议（URL Scheme）
* **用途**：用于一键唤醒并自动安装扩展。
* **说明**：在浏览器或终端中触发此协议，能够直接唤醒本地的 Antigravity IDE 客户端，并自动拉取并安装 ID 为 `openai.chatgpt` 的扩展插件。

### 2. `https://marketplace.visualstudio.com/items`
* **类型**：网页端插件详情链接
* **用途**：用于在浏览器中浏览插件详情。
* **说明**：微软 VS Code Marketplace 官方的插件详情展示页面，方便开发者在网页端查看该插件的详细介绍、版本迭代历史、配置选项和用户评价。

### 3. `https://marketplace.visualstudio.com/_apis/public/gallery`
* **类型**：插件市场 API 接口
* **用途**：用于 IDE 客户端在后台静默检索与下载插件。
* **说明**：这是微软 VS Code 插件市场的后台接口。Antigravity IDE 在底层通过该 API 与插件市场进行通信，从而实现插件的一键下载、安装部署及自动检测更新。

# OfferForge

OfferForge 是一个面向大三本科生的 AI 模拟面试训练项目，重点解决“没法高频对练”“简历追问不够深”“临场表达容易乱”这类问题。它提供了一个可直接使用的前端训练界面，并配套 Node.js 后端代理，用于连接大模型、读取简历、生成追问、做语音分析。

## 项目简介

这个项目的目标不是做一个通用聊天机器人，而是做一个更贴近真实面试场景的训练器：

- 通用模式下，系统会从高频面试题库里随机出题，并支持连续追问。
- 简历模式下，系统会先解析上传的 PDF 简历，再围绕简历中的有效内容进行提问和追问。
- 语音模式下，系统会把录音转成文本，并给出语言表达相关的反馈。
- 左侧还集成了计时器、训练配置和追问状态，尽量模拟面试时的压力感。

项目参考了实际面试训练中的几个核心痛点：表达紧张、答题节奏差、简历容易被追问穿透。当前版本已经把这些能力做成了一个完整的本地可运行原型。

## 运行方式

### 本地运行

先安装依赖：

```bash
npm install
```

启动项目：

```bash
npm start
```

默认会启动到 `127.0.0.1:3001`，然后直接打开：

```text
http://127.0.0.1:3001/
```

如果 3001 端口已被占用，可以换一个端口启动，例如：

```bash
PORT=3002 npm start
```

### 运行前需要准备的文件

后端会从项目根目录读取以下文件：

- `QianWen-API`：千问 API Key
- `Doubao-API`：豆包语音识别相关凭据
- `basic_question`：通用题库

如果你要使用简历模式，前端会通过本地 PDF.js 解析上传的文字版 PDF 简历。

### 部署更新

如果是在服务器上使用 Nginx 部署，修改完 `index.html`、`styles.css` 或 `app.js` 后执行：

```bash
./deploy.sh
```

脚本会把静态资源同步到 `/var/www/offerforge/`，并重载 Nginx。

## 技术栈

### 前端

- 原生 HTML / CSS / JavaScript
- PDF.js：用于解析上传的 PDF 简历
- 浏览器端 `localStorage`：保存训练状态、题目记录和界面偏好

### 后端

- Node.js 18+
- 原生 `http` 模块搭建服务
- 千问 OpenAI 兼容接口：用于生成面试问题和追问
- 豆包语音接口：用于录音分析和语言表达评价

### 项目结构

- `index.html`：页面结构
- `styles.css`：界面样式
- `app.js`：前端交互逻辑
- `server.js`：本地 API 服务与静态资源服务
- `deploy.sh`：服务器发布脚本

## 常用接口

- `GET /health`：健康检查
- `POST /api/opening-question`：获取开场题
- `POST /api/chat`：继续对话并生成追问
- `POST /api/format-resume`：解析简历
- `POST /api/resume-next-question`：针对简历段落生成下一问
- `POST /api/analyze-voice`：分析语音内容

## 生产环境说明

如果项目部署在服务器上，通常会采用：

- Nginx 对外提供页面访问
- Node 服务只监听本机端口
- 前端请求 `/api/*`，由 Nginx 转发给本机 Node 服务

常用检查命令如下：

```bash
systemctl status nginx
systemctl status offerforge-api
```

如果需要查看后端日志：

```bash
journalctl -u offerforge-api -n 80 --no-pager
```

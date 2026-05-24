# Starter Web UI

一个面向大三学生面试训练的 AI 对话原型，包含基础聊天 UI 和千问 API 服务端代理。

## 项目目录

```text
/root/workspace/OfferForge
```

这里是 OfferForge 的核心源码目录。

## 当前部署方式

```bash
systemctl status nginx
systemctl status offerforge-api
```

网站文件已发布到：

```text
/var/www/offerforge/
```

Nginx 监听标准 HTTP 端口：

```text
0.0.0.0:80
```

千问代理服务只监听本机端口：

```text
127.0.0.1:3001
```

访问：

```text
http://服务器公网IP/
```

如果外网打不开，实例内部已经验证没有拦截，通常需要在云厂商安全组里放行 TCP `80` 端口。

## 发布更新

修改 `index.html`、`styles.css` 或 `app.js` 后执行：

```bash
./deploy.sh
```

脚本会把核心目录里的静态文件同步到 Nginx 对外目录，并重载 Nginx。

## API 代理

浏览器请求：

```text
POST /api/chat
```

Nginx 会把请求转发到本机 Node 服务，Node 服务从 `QianWen-API` 文件读取 API key，再调用千问 OpenAI 兼容接口。API key 不会出现在前端代码里。

常用命令：

```bash
systemctl restart offerforge-api
journalctl -u offerforge-api -n 80 --no-pager
```

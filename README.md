# Starter Web UI

一个零依赖静态网站示例，包含基础 HTML、CSS 和 JavaScript 交互。

## 项目目录

```text
/root/workspace/OfferForge
```

这里是 OfferForge 的核心源码目录。

## 当前部署方式

```bash
systemctl status nginx
```

网站文件已发布到：

```text
/var/www/offerforge/
```

Nginx 监听标准 HTTP 端口：

```text
0.0.0.0:80
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

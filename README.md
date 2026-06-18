# 帮我问 AI

这是一个简单的 AI 问法整理工具。

用户随便输入一句话，比如“帮我写个请假条”或“帮我做个旅游计划”，工具会整理成一段更清楚、可以直接复制到 ChatGPT、豆包、DeepSeek、Kimi 等 AI 工具里的问法。

## 本地安装

```bash
npm install
```

## 配置 API Key

复制配置文件：

```bash
cp .env.example .env
```

然后在 `.env` 里填写 DeepSeek API Key：

```env
DEEPSEEK_API_KEY=your_api_key_here
PORT=3000
```

## 本地启动

```bash
npm start
```

打开：

```text
http://localhost:3000
```

## 部署到 Render

1. 把项目上传到 GitHub。
2. 在 Render 新建 Web Service。
3. 连接这个 GitHub 仓库。
4. Build Command 填：

```bash
npm install
```

5. Start Command 填：

```bash
npm start
```

6. 在 Render 的 Environment 里添加：

```env
DEEPSEEK_API_KEY=你的DeepSeek API Key
```

Render 会自动提供 `PORT`，不用手动填写。

## 注意

不要上传 `.env` 和 `node_modules/`。项目已经在 `.gitignore` 里忽略它们。

import { Browser, chromium } from "patchright";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();

app.use(bodyParser.json({ limit: "30mb" }));
app.use(bodyParser.urlencoded({ limit: "30mb", extended: true }));
app.use(cors());

global.browserLength = 0;
global.browserLimit = 20;

const port = process.env.PORT || 3000;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms * 1e3));

const scrape = async (browser: Browser, url: string) => {
  // url = "https://ipinfo.ipidea.io/";
  global.browserLength++;
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(url, {
    waitUntil: "networkidle",
  });

  const pass_verify = async () => {
    await sleep(0.5);
    try {
      const element = await page.$(".spacer-bottom");
      if (element) {
        const box = await element.boundingBox();
        if (box) {
          const x = box.x + 25;
          const y = box.y + box.height + 70;
          await page.mouse.click(x, y);
        }
      }
    } catch (error) {
      if (error.message.includes("has been closed")) return;
    }
    return pass_verify();
  };

  let headers: any = {};
  // 通过监听request事件获取headers
  page.on("request", (request) => {
    if (request.url().startsWith(url)) {
      const reqHeaders = request.headers();
      delete reqHeaders["cookie"];
      headers = { ...headers, ...reqHeaders, host: new URL(url).hostname };
    }
  });

  pass_verify();

  let cookie = "";

  while (!cookie) {
    await sleep(0.2);
    const cookies = await context.cookies();
    if (cookies.find((cookie) => cookie.name === "cf_clearance")) {
      cookie = cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
    }
  }

  const unuseless_header_keys = ["host", "content-type"];
  unuseless_header_keys.forEach((key) => {
    delete headers[key];
  });
  headers = { ...headers, cookie };
  await browser.close();
  global.browserLength--;
  console.log(`✅ 解码成功｜${url}`, JSON.stringify(headers));
  return { code: 200, cookie, headers };
};

function parseTgProxyString(proxyString: string) {
  if (!proxyString) return {};
  const proxy = proxyString.split("://")[1];
  const protocal = proxyString.split("://")[0];
  const has_auth = proxy.includes("@");
  let [host, port] = proxy.split("@")[has_auth ? 1 : 0].split(":");
  let username = "";
  let password = "";
  if (has_auth) {
    [username, password] = proxy.split("@")[0].split(":");
  }
  return {
    host: protocal + "://" + host,
    port: +port,
    username,
    password,
  } as any;
}

app.post("/api", async (req, res) => {
  const type = req.body.type;
  if (type === "cf5s") {
    const websiteUrl = req.body.websiteUrl;
    if (global.browserLength >= global.browserLimit)
      return res.status(429).json({ code: 429, message: "超出请求数限制" });
    let proxy = req.body.proxy;
    console.log(`🚥 开始解码|${websiteUrl}`, proxy ? `|使用代理:${proxy}` : "");
    proxy = proxy ? parseTgProxyString(proxy) : {};
    const browser = await chromium.launch({
      headless: false,
      proxy: proxy.host
        ? {
            server: `${proxy.host}:${proxy.port}`,
            username: proxy.username,
            password: proxy.password,
          }
        : undefined,
    });
    try {
      const response = await Promise.race([
        scrape(browser, websiteUrl),
        // 60s超时
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`解码超时`)), 60_000)
        ),
      ]);
      res.send(response);
    } catch (error) {
      console.log(`❌ 解码失败|${websiteUrl}`, error.message);
      await browser.close().catch(() => {});
      global.browserLength--;
      res.status(500).json({ code: 500, message: error.message });
    }
  } else {
    res.status(400).json({ code: 400, message: `${type}解码暂未实现` });
  }
});

app.use((req, res) => {
  res.status(404).json({ code: 404, message: "Not Found" });
});

app.listen(port, () => {
  console.log(`🌟 Server running on port ${port}`);
});

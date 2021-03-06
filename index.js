import http2 from "http2";
import http from "http";

async function run() {
  const client = http2.connect("https://www.strava.com");

  async function getSession() {
    return new Promise((resolve, reject) => {
      let s4;

      const req = client.request({
        [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_GET,
        [http2.constants.HTTP2_HEADER_PATH]: "/login",
      });

      req.on("response", (headers, flags) => {
        // console.log(headers["set-cookie"]);
        // for (const name in headers) {
        //   console.log(`${name}: ${headers[name]}`);
        // }

        const status = headers[http2.constants.HTTP2_HEADER_STATUS];

        const re = /_strava4_session=(\w+);/;

        if (status === http2.constants.HTTP_STATUS_OK) {
          let m;

          if ((m = re.exec(headers["set-cookie"]))) {
            s4 = m[1];
          } else {
            reject(new Error("session not found"));
          }
        } else {
          reject(new Error(`status ${status}`));
        }
      });

      req.setEncoding("utf8");

      const data = [];

      req.on("data", (chunk) => {
        data.push(chunk);
      });

      req.on("end", () => {
        const re = /.*<input type="hidden" name="authenticity_token" value="([^"]*)".*/gm;

        const m = re.exec(data.join(""));

        if (!m) {
          reject(new Error("no authenticity_token found"));
        } else {
          resolve({ at: m[1], s4 });
        }
      });

      req.end();
    });
  }

  async function login(at, s4) {
    return new Promise((resolve, reject) => {
      const u = new URLSearchParams();
      u.set("email", process.env.SP_EMAIL);
      u.set("password", process.env.SP_PASSWORD);
      u.set("authenticity_token", at);
      u.set("utf8", "\u2713");
      u.set("plan", "");

      const buf = Buffer.from(u.toString(), "utf8");

      const req = client.request({
        [http2.constants.HTTP2_HEADER_METHOD]:
          http2.constants.HTTP2_METHOD_POST,
        [http2.constants.HTTP2_HEADER_PATH]: "/session",
        [http2.constants.HTTP2_HEADER_CONTENT_TYPE]:
          "application/x-www-form-urlencoded",
        [http2.constants.HTTP2_HEADER_COOKIE]: [`_strava4_session=${s4}`],
        [http2.constants.HTTP2_HEADER_CONTENT_LENGTH]: buf.length,
      });

      req.on("response", (headers, flags) => {
        const status = headers[http2.constants.HTTP2_HEADER_STATUS];

        // console.log(headers[http2.constants.HTTP2_HEADER_SET_COOKIE]);
        // for (const name in headers) {
        //   console.log(`${name}: ${headers[name]}`);
        // }

        const re = /_strava4_session=(\w+);/;

        let m;

        if (status !== http2.constants.HTTP_STATUS_FOUND) {
          reject(new Error(`status ${status}`));
        } else if ((m = re.exec(headers["set-cookie"]))) {
          resolve(m[1]);
        } else {
          reject(new Error("session not found"));
        }
      });

      req.setEncoding("utf8");

      const data = [];

      req.on("data", (chunk) => {
        data.push(chunk);
      });

      req.on("end", () => {
        // resolve();
      });

      req.write(buf);
      req.end();
    });
  }

  const { at, s4 } = await getSession();

  const ss4 = await login(at, s4);

  client.close();

  let client2;

  function getClient2() {
    if (client2 && !client2.destroyed) {
      return client2;
    }

    return http2.connect("https://heatmap-external-a.strava.com");
  }

  async function getCfSession(s4) {
    return new Promise((resolve, reject) => {
      const req = getClient2().request({
        [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_GET,
        [http2.constants.HTTP2_HEADER_PATH]: "/auth",
        [http2.constants.HTTP2_HEADER_COOKIE]: [`_strava4_session=${s4}`],
      });

      req.on("response", (headers, flags) => {
        const status = headers[http2.constants.HTTP2_HEADER_STATUS];

        // for (const name in headers) {
        //   console.log(`${name}: ${headers[name]}`);
        // }

        if (status !== http2.constants.HTTP_STATUS_OK) {
          reject(new Error(`status ${status}`));
        } else {
          resolve(headers[http2.constants.HTTP2_HEADER_SET_COOKIE]);
        }
      });

      req.on("error", (err) => {
        reject(err);
      });

      req.setEncoding("utf8");

      req.on("data", (chunk) => {
        // ignore
      });

      req.end();
    });
  }

  const cooks = await getCfSession(ss4);

  console.log(cooks);

  http
    .createServer((req1, res1) => {
      const req = getClient2().request({
        [http2.constants.HTTP2_HEADER_METHOD]: http2.constants.HTTP2_METHOD_GET,
        [http2.constants.HTTP2_HEADER_PATH]: "/tiles-auth" + req1.url,
        [http2.constants.HTTP2_HEADER_COOKIE]: [
          `_strava4_session=${ss4}`,
          ...cooks.map((cook) => cook.replace(/;.*/, "")),
        ],
      });

      req.on("response", (headers, flags) => {
        const status = headers[http2.constants.HTTP2_HEADER_STATUS];

        const ct = headers[http2.constants.HTTP2_HEADER_CONTENT_TYPE];

        if (status === 200 && ct && ct.startsWith("image/")) {
          res1.setHeader("Content-Type", ct);
        } else if (status === 404) {
          res1.writeHead(404).end();
        } else {
          for (const name in headers) {
            console.log(`> ${name}: ${headers[name]}`);
          }

          res1.writeHead(500).end();
        }
      });

      req.on("error", (err) => {
        console.error(err);

        if (!res1.headersSent) {
          res1.writeHead(500);
        }

        res1.end();
      });

      req.on("data", (chunk) => {
        res1.write(chunk);
      });

      req.on("end", () => {
        res1.end();
      });

      req.end();
    })
    .listen(Number(process.env.SP_PORT || "8080"));
}

run().catch((err) => console.error(err));

#!/usr/bin/env node
import tls from "tls";
import crypto from "crypto";
import fs from "fs";
import exec from "child_process";
import readline from "node:readline";
import express from "express";
import { Server } from "node:http";
import JSONbig from 'json-bigint';
import { WebSocket } from "ws";

const USER_ID_NOT_SET_ERR_CODE: number = 10;
const USER_ID_NOT_SET_ERR_MSG: string = "not authenticated, userId is not set";

const AUTH0_DOMAIN = "dev-epfxvx2scaq4cj3t.us.auth0.com";
const CLIENT_ID = "94AKF0INP2ApjXud6TTirxyjoQxqNpEk";
const REDIRECT_URI = "http://localhost:3000/callback";

function base64URLEncode(str: Buffer) {
  return str
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sha256(buffer: string) {
  return crypto.createHash("sha256").update(buffer).digest();
}

function generatePKCECodes() {
  const verifier = base64URLEncode(crypto.randomBytes(32)); // your "original code verifier"
  const challenge = base64URLEncode(sha256(verifier)); // hashed "code challenge"
  return { verifier, challenge };
}

const { verifier, challenge } = generatePKCECodes();

class Decillion {
  port: number = 8077;
  port2: number = 8076;
  host: string = "api.decillionai.com";
  protocol: string = "ws";
  callbacks: { [key: string]: (packageId: number, obj: any) => void } = {};
  socket: tls.TLSSocket | undefined;
  websocket: WebSocket | undefined;
  received: Buffer = Buffer.from([]);
  observePhase: boolean = true;
  nextLength: number = 0;
  readBytes() {
    if (this.observePhase) {
      if (this.received.length >= 4) {
        this.nextLength = this.received.subarray(0, 4).readIntBE(0, 4);
        this.received = this.received.subarray(4);
        this.observePhase = false;
        this.readBytes();
      }
    } else {
      if (this.received.length >= this.nextLength) {
        let payload = this.received.subarray(0, this.nextLength);
        this.received = this.received.subarray(this.nextLength);
        this.observePhase = true;
        this.processPacket(payload);
        this.readBytes();
      }
    }
  }
  private async connectoToTlsServer() {
    return new Promise((resolve, reject) => {
      const insecure = process.env.DECILLION_INSECURE === "1";
      if (this.protocol === "tcp") {
        const options: tls.ConnectionOptions = {
          host: this.host,
          port: this.port,
          servername: this.host,
          rejectUnauthorized: !insecure,
        };
        this.socket = tls.connect(options, () => {
          if (this.socket?.authorized) {
            console.log("✔ Tcp TLS connection authorized");
            this.authenticate();
          } else {
            console.log(
              "⚠ TLS connection not authorized:",
              this.socket?.authorizationError
            );
          }
          resolve(undefined);
        });
        this.socket.on("error", async (e) => {
          console.log(e);
        });
        this.socket.on("close", (e) => {
          console.log(e);
          this.connectoToTlsServer();
        });
        this.socket.on("data", (data) => {
          setTimeout(() => {
            this.received = Buffer.concat([this.received, data]);
            this.readBytes();
          });
        });
      } else {
        this.websocket = new WebSocket(`wss://${this.host}:${this.port2}`, { rejectUnauthorized: !insecure } as any);
        this.websocket.on('open', () => {
          console.log("✔ Ws TLS connection authorized");
          this.authenticate();
          resolve(undefined);
        });
        this.websocket.on("error", (e) => {
          console.log("error:", e);
        });
        this.websocket.on("close", (e) => {
          console.log("close", e);
          this.connectoToTlsServer();
        });
        this.websocket.on("message", (data) => {
          setTimeout(() => {
            this.received = Buffer.concat([this.received, data as Buffer]);
            this.readBytes();
          });
        });
      }
    });
  }
  // Async req/res over the signaling channel: signalMiniapp registers a
  // resolver keyed by correlationId here, then waits for an inbound 0x01
  // packet (key "creatures/signal/result") carrying that same id.
  private pendingSignalResponses: { [correlationId: string]: (resp: any) => void } = {};
  private processPacket(data: Buffer) {
    try {
      let pointer = 0;
      if (data.at(pointer) == 0x01) {
        pointer++;
        let keyLen = data.subarray(pointer, pointer + 4).readIntBE(0, 4);
        pointer += 4;
        let key = data.subarray(pointer, pointer + keyLen).toString();
        pointer += keyLen;
        let payload = data.subarray(pointer);
        let obj: any;
        try {
          obj = JSONbig.parse(payload.toString());
        } catch {
          obj = payload.toString();
        }
        if (key == "creatures/signal/result") {
          const cid = obj && typeof obj === "object" ? obj.correlationId : undefined;
          if (cid && this.pendingSignalResponses[cid]) {
            const resolve = this.pendingSignalResponses[cid];
            delete this.pendingSignalResponses[cid];
            resolve(obj);
          } else {
            console.log("[signal-result]", obj);
          }
        } else if (
          key == "creatures/signal" &&
          obj && typeof obj === "object" &&
          obj.correlationId &&
          this.pendingSignalResponses[obj.correlationId]
        ) {
          // Response relayed back through a Caspar proxy entity: the node
          // delivers it on the plain "creatures/signal" key with the proxy
          // entity as sender and the original correlationId preserved. The
          // useful payload is the Send packet's `data` JSON string.
          const resolve = this.pendingSignalResponses[obj.correlationId];
          delete this.pendingSignalResponses[obj.correlationId];
          let inner: any = obj.data;
          if (typeof inner === "string") {
            try { inner = JSONbig.parse(inner); } catch { /* keep raw string */ }
          }
          resolve(inner !== undefined && inner !== "" ? inner : obj);
        } else if (key == "pc/message") {
          if (pcId) process.stdout.write(obj.message);
        } else if (key == "docker/build") {
          if (dockBuild) process.stdout.write(obj.message + "\n");
        } else {
          console.log(key, obj);
        }
      } else if (data.at(pointer) == 0x02) {
        pointer++;
        let pidLen = data.subarray(pointer, pointer + 4).readIntBE(0, 4);
        pointer += 4;
        let packetId = data.subarray(pointer, pointer + pidLen).toString();

        pointer += pidLen;
        let resCode = data.subarray(pointer, pointer + 4).readIntBE(0, 4);
        pointer += 4;
        let payload = data.subarray(pointer).toString();
        let obj = JSONbig.parse(payload);
        let cb = this.callbacks[packetId];
        if (cb) cb(resCode, obj);
      }
    } catch (ex) {
      console.log(ex);
    }
    setTimeout(() => {
      if (this.protocol === "tcp") {
        this.socket?.write(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]));
      } else {
        this.websocket?.send(Buffer.from([0x00, 0x00, 0x00, 0x01, 0x01]));
      }
    });
  }
  private sign(b: Buffer) {
    if (this.privateKey) {
      const sign = crypto.sign(null, b, {
        key: this.privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      });
      return sign.toString('base64');
    } else {
      return "";
    }
  }
  private intToBytes(x: number) {
    const bytes = Buffer.alloc(4);
    bytes.writeInt32BE(x);
    return bytes;
  }
  private longToBytes(x: bigint) {
    const bytes = Buffer.alloc(8);
    bytes.writeBigInt64BE(x);
    return bytes;
  }
  private stringToBytes(x: string) {
    const bytes = Buffer.from(x);
    return bytes;
  }
  private createRequest(userId: string, path: string, obj: any) {
    let packetId = Math.random().toString().substring(2);
    let payload = this.stringToBytes(JSONbig.stringify(obj));
    let signature = this.stringToBytes(this.sign(payload));
    let uidBytes = this.stringToBytes(userId);
    let pidBytes = this.stringToBytes(packetId);
    let pathBytes = this.stringToBytes(path);
    let b = Buffer.concat([
      this.intToBytes(signature.length),
      signature,
      this.intToBytes(uidBytes.length),
      uidBytes,
      this.intToBytes(pathBytes.length),
      pathBytes,
      this.intToBytes(pidBytes.length),
      pidBytes,
      payload,
    ]);
    return {
      packetId: packetId,
      data: Buffer.concat([this.intToBytes(b.length), b]),
    };
  }
  private async sendRequest(
    userId: string,
    path: string,
    obj: any
  ): Promise<{ resCode: number; obj: any }> {
    return new Promise((resolve, reject) => {
      let data = this.createRequest(userId, path, obj);
      let to: NodeJS.Timeout;
      this.callbacks[data.packetId] = (resCode, obj) => {
        if (to) {
          clearTimeout(to);
        }
        resolve({ resCode, obj });
      };
      to = setTimeout(() => {
        resolve({ resCode: 20, obj: { message: "request timeout" } });
        clearTimeout(to);
      }, 360000);
      setTimeout(() => {
        if (this.protocol === "tcp") {
          this.socket?.write(data.data);
        } else {
          this.websocket?.send(data.data);
        }
      });
    });
  }
  private async sleep(ms: number) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(undefined);
      }, ms);
    });
  }
  private userId: string | undefined;
  private privateKey: string | undefined;
  private username: string | undefined;
  public constructor(proto = "ws", host?: string, port?: number) {
    this.protocol = proto;
    if (host) this.host = host;
    if (port) {
      if (proto === "tcp") {
        this.port = port;
      } else {
        this.port2 = port;
      }
    }
    if (!fs.existsSync("auth")) fs.mkdirSync("auth");
    if (!fs.existsSync("files")) fs.mkdirSync("files");
    if (
      fs.existsSync("auth/userId.txt") &&
      fs.existsSync("auth/privateKey.txt")
    ) {
      this.userId = fs.readFileSync("auth/userId.txt", { encoding: "utf-8" });
      let pk = fs.readFileSync("auth/privateKey.txt", { encoding: "utf-8" });
      this.privateKey = pk;
    }
  }
  public async connect() {
    await this.connectoToTlsServer();
    if (this.userId && this.privateKey) {
      let auth = await this.authenticateSession();
      console.log(auth.obj);
    }
  }
  public async connectTransport() {
    await this.connectoToTlsServer();
  }
  public hasCredentials(): boolean {
    return !!this.userId && !!this.privateKey;
  }
  public async authenticateSession(): Promise<{ resCode: number; obj: any }> {
    if (!this.userId || !this.privateKey) {
      return {
        resCode: USER_ID_NOT_SET_ERR_CODE,
        obj: { message: USER_ID_NOT_SET_ERR_MSG },
      };
    }
    const authRes = await this.authenticate();
    if (authRes.resCode !== 0) {
      return authRes;
    }
    const meRes = await this.creatures.me();
    if (meRes.resCode !== 0) {
      return meRes;
    }
    this.username = meRes.obj?.user?.username;
    return { resCode: 0, obj: { message: "authenticated", user: meRes.obj?.user } };
  }
  private loginServer: Server | undefined;
  private runLoginServer() {
    const server = express();
    const port = 3000;
    server.use(express.static('../login'));
    server.use(express.json());
    server.use(express.urlencoded());
    server.post("/callback", async (req, responder) => {
      try {

        const idToken = req.body.idToken;

        let res = await this.sendRequest("", "/creatures/login", {
          username: this.pendingUsername,
          emailToken: idToken,
          metadata: {
            public: {
              profile: { name: this.pendingUsername },
            },
          },
        });
        if (res.resCode == 0) {
          this.userId = res.obj.user.id;
          this.privateKey = res.obj.privateKey;
          await Promise.all([
            new Promise((resolve, _) => {
              fs.writeFile(
                "auth/userId.txt",
                this.userId ?? "",
                { encoding: "utf-8" },
                () => {
                  resolve(undefined);
                }
              );
            }),
            new Promise((resolve, _) => {
              fs.writeFile(
                "auth/privateKey.txt",
                res.obj.privateKey ?? "",
                { encoding: "utf-8" },
                () => {
                  resolve(undefined);
                }
              );
            }),
          ]);
          await this.authenticate();
          this.username = (await this.creatures.me()).obj.user.username;
        }
        console.log("Login successfull");
        if (this.loginServer) {
          this.loginServer.close(() => { });
          if (this.loginPromise) {
            responder.send(JSON.stringify({ success: true }));
            this.loginPromise(res);
          }
        }
      } catch (err) {
        console.error("Auth error:", err);
        responder.status(500).send("Authentication failed");
      }
    });

    this.loginServer = server.listen(port, () => {
      console.log(`Waiting for your login to complete...`);
    });
  }
  private loginPromise:
    | ((
      value:
        | { resCode: number; obj: any }
        | PromiseLike<{ resCode: number; obj: any }>
    ) => void)
    | undefined;
  private pendingUsername: string | undefined;
  public async login(username: string): Promise<{ resCode: number; obj: any }> {
    return new Promise((resolve, reject) => {
      this.pendingUsername = username;
      this.loginPromise = resolve;
      this.runLoginServer();
      console.log("\nOpen this url and login:\n");
      console.log('http://localhost:3000/index.html');
      console.log("");
    });
  }
  // Non-interactive dev login: skips the browser/Auth0 round-trip and submits
  // a raw email as the "emailToken". Works against caspar nodes running with
  // Firebase disabled (DEV mode); the server then treats the token as an email.
  public async loginDev(username: string, email?: string): Promise<{ resCode: number; obj: any }> {
    const devEmail = email && email.includes("@") ? email : `${username}@dev.local`;
    const res = await this.sendRequest("", "/creatures/login", {
      username,
      emailToken: devEmail,
      metadata: {
        public: {
          profile: { name: username },
        },
      },
    });
    if (res.resCode == 0) {
      this.userId = res.obj.user.id;
      this.privateKey = res.obj.privateKey;
      await Promise.all([
        new Promise((resolve) => fs.writeFile("auth/userId.txt", this.userId ?? "", { encoding: "utf-8" }, () => resolve(undefined))),
        new Promise((resolve) => fs.writeFile("auth/privateKey.txt", this.privateKey ?? "", { encoding: "utf-8" }, () => resolve(undefined))),
      ]);
      await this.authenticate();
      this.username = (await this.creatures.me()).obj?.user?.username;
      console.log("Dev login successful");
    }
    return res;
  }
  public async authenticate(): Promise<{ resCode: number; obj: any }> {
    if (!this.userId) {
      return {
        resCode: USER_ID_NOT_SET_ERR_CODE,
        obj: { message: USER_ID_NOT_SET_ERR_MSG },
      };
    }
    return await this.sendRequest(this.userId, "/creatures/authenticate", {});
  }
  public logout() {
    if (fs.existsSync("auth/userId.txt")) fs.rmSync("auth/userId.txt");
    if (fs.existsSync("auth/privateKey.txt")) fs.rmSync("auth/privateKey.txt");
    if (!this.userId && !this.privateKey && !this.username) {
      return { resCode: 1, obj: { message: "user is not logged in" } };
    }
    this.userId = undefined;
    this.privateKey = undefined;
    this.username = undefined;
    return { resCode: 0, obj: { message: "user logged out" } };
  }
  public myUsername(): string {
    return this.username ?? "Decillion User";
  }

  public myPrivateKey(): string {
    if (this.privateKey) {
      let str = this.privateKey
        .toString()
        .slice("-----BEGIN RSA PRIVATE KEY-----\n".length);
      str = str.slice(
        0,
        str.length - "\n-----END RSA PRIVATE KEY-----\n".length
      );
      return str;
    } else {
      return "empty";
    }
  }
  public async generatePayment(): Promise<string> {
    let payload = this.stringToBytes(BigInt(Date.now()).toString());
    let sign = this.sign(payload);
    let res = await fetch(
      "https://payment.decillionai.com/create-checkout-session",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSONbig.stringify({
          userId: this.userId,
          payload: payload.toString("base64"),
          signature: sign,
        }),
      }
    );
    return await res.text();
  }
  public creatures = {
    get: async (userId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/get", {
        userId: userId,
      });
    },
    lockToken: async (amount: number, type: string, target: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      let res = await this.sendRequest(this.userId, "/creatures/lockToken", {
        amount: amount,
        type: type,
        target: target
      });
      console.log();
      console.log(this.sign(Buffer.from(res.obj.tokenId)));
      console.log();
      return res;
    },
    consumeLock: async (lockId: string, type: string, amount: number): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/consumeLock", {
        amount: amount,
        type: type,
        lockId: lockId,
        signature: this.sign(Buffer.from(lockId)),
        userId: this.userId
      });
    },
    me: async (): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/get", {
        userId: this.userId,
      });
    },
    list: async (
      offset: number,
      count: number
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/list", {
        offset: offset,
        count: count,
      });
    },
    transfer: async (
      toUsername: string,
      amount: number
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/transfer", {
        toUsername,
        amount,
      });
    },
    mint: async (
      toUserEmail: string,
      amount: number
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/mint", {
        toUserEmail,
        amount,
      });
    },
    checkSign: async (
      userId: string,
      payload: string,
      signature: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/checkSign", {
        userId,
        payload,
        signature,
      });
    },
    signal: async (
      creatureId: string,
      programId: string,
      entity: string,
      data: string,
      storeId?: string,
      temp?: boolean
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }

      // If the caller-supplied `data` is a JSON object that doesn't already
      // carry a correlationId, inject one and wait for the WASM creature to
      // signal the result back over key "creatures/signal/result". This makes
      // direct signals symmetrical with miniapp signals: the call resolves to
      // the actual VM response instead of just the synchronous ACK.
      //
      // If the data already has a correlationId we leave it alone — that
      // means the call came from `signalMiniapp`, which manages its own
      // pendingSignalResponses entry and would have ours overwrite its.
      let waitForResponse = false;
      let correlationId = "";
      let innerForSend = data;
      try {
        const parsed: any = JSONbig.parse(data);
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          !parsed.correlationId
        ) {
          correlationId = crypto.randomBytes(16).toString("hex");
          parsed.correlationId = correlationId;
          innerForSend = JSONbig.stringify(parsed);
          waitForResponse = true;
        }
      } catch {
        // data is not JSON — keep legacy fire-and-forget behavior.
      }

      let responsePromise: Promise<{ resCode: number; obj: any }> | undefined;
      if (waitForResponse) {
        const timeoutMs = Number(process.env.DECILLION_SIGNAL_TIMEOUT_MS || "30000");
        const cid = correlationId;
        responsePromise = new Promise<{ resCode: number; obj: any }>((resolve) => {
          let timer: NodeJS.Timeout | undefined;
          this.pendingSignalResponses[cid] = (resp: any) => {
            if (timer) clearTimeout(timer);
            resolve({ resCode: 0, obj: resp });
          };
          timer = setTimeout(() => {
            if (this.pendingSignalResponses[cid]) {
              delete this.pendingSignalResponses[cid];
              resolve({
                resCode: 32,
                obj: {
                  message: `creature signal response timeout`,
                  correlationId: cid,
                  timeoutMs,
                },
              });
            }
          }, timeoutMs);
        });
      }

      const sendRes = await this.sendRequest(this.userId, "/creatures/signal", {
        type: "pvp",
        creatureId,
        // Forward programId and entityId at the top level so the server's
        // Signal action can route the packet to the program's VM listener
        // (Vmm.Assign registers listeners under the programId). Without these
        // the signal falls back to the creature, where no VM is listening.
        programId,
        entityId: entity,
        storeId,
        temp,
        data: JSONbig.stringify({ programId, entity, payload: innerForSend }),
      });
      if (!waitForResponse || sendRes.resCode !== 0) {
        if (waitForResponse && correlationId && this.pendingSignalResponses[correlationId]) {
          delete this.pendingSignalResponses[correlationId];
        }
        return sendRes;
      }
      return responsePromise!;
    },
    create: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      return await this.sendRequest("", "/creatures/create", payload);
    },
    delete: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/delete", payload);
    },
    update: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/update", payload);
    },
    meta: async (userId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/meta", { userId });
    },
    getByUsername: async (
      username: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/getByUsername", { username });
    },
    find: async (
      offset: number,
      count: number,
      query: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/find", { offset, count, query });
    },
    authenticate: async (): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/authenticate", {});
    },
  };
  private miniappTarget(key: string): { creatureId: string; programId: string; entityId: string; storeId?: string } | undefined {
    const prefix = `DECILLION_${key.toUpperCase()}`;
    const creatureId = process.env[`${prefix}_CREATURE_ID`];
    const programId = process.env[`${prefix}_PROGRAM_ID`];
    const entityId = process.env[`${prefix}_ENTITY`] ?? "main";
    const storeId = process.env[`${prefix}_STORE_ID`];
    if (!creatureId || !programId) return undefined;
    return { creatureId, programId, entityId, storeId };
  }

  // Request/response over signaling: each miniapp call attaches a correlation
  // id, ships the signal, and waits for the creature to signal the requester
  // back with key "creatures/signal/result" carrying the same id. The resolved
  // payload is the JSON the creature emitted at the end of its run().
  private async signalMiniapp(key: string, action: string, payload: any, temp = false): Promise<{ resCode: number; obj: any }> {
    if (!this.userId) {
      return {
        resCode: USER_ID_NOT_SET_ERR_CODE,
        obj: { message: USER_ID_NOT_SET_ERR_MSG },
      };
    }
    const target = this.miniappTarget(key);
    if (!target) {
      return {
        resCode: 31,
        obj: {
          message: `miniapp target is not configured: set DECILLION_${key.toUpperCase()}_CREATURE_ID and DECILLION_${key.toUpperCase()}_PROGRAM_ID`,
        },
      };
    }
    const correlationId = crypto.randomBytes(16).toString("hex");
    const data = JSONbig.stringify({
      action,
      programId: target.programId,
      entity: target.entityId,
      correlationId,
      payload,
    });
    // Default timeout chosen to comfortably cover wasm cold-start + host ops.
    const timeoutMs = Number(process.env.DECILLION_SIGNAL_TIMEOUT_MS || "30000");
    const responsePromise = new Promise<{ resCode: number; obj: any }>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      this.pendingSignalResponses[correlationId] = (resp: any) => {
        if (timer) clearTimeout(timer);
        resolve({ resCode: 0, obj: resp });
      };
      timer = setTimeout(() => {
        if (this.pendingSignalResponses[correlationId]) {
          delete this.pendingSignalResponses[correlationId];
          resolve({
            resCode: 32,
            obj: { message: `creature signal response timeout`, correlationId, key, action, timeoutMs },
          });
        }
      }, timeoutMs);
    });
    const sendRes = await this.creatures.signal(target.creatureId, target.programId, target.entityId, data, target.storeId, temp);
    if (sendRes.resCode !== 0) {
      // /creatures/signal itself failed (auth, validation, etc); the creature
      // won't run, so nothing will ever signal us back. Clean up the listener
      // and propagate the underlying error.
      if (this.pendingSignalResponses[correlationId]) {
        delete this.pendingSignalResponses[correlationId];
      }
      return sendRes;
    }
    return responsePromise;
  }

  public spaces = {
    create: async (isPublic: boolean, persHist: boolean, origin: string, metadata: { [key: string]: any }) =>
      this.signalMiniapp("spaces", "create", { isPublic, persHist, origin, metadata }),
    update: async (spaceId: string, isPublic: boolean, persHist: boolean) =>
      this.signalMiniapp("spaces", "update", { storeId: spaceId, isPublic, persHist }),
    delete: async (spaceId: string) => this.signalMiniapp("spaces", "delete", { storeId: spaceId }),
    get: async (spaceId: string) => this.signalMiniapp("spaces", "get", { storeId: spaceId }),
    mySpaces: async (offset: number, count: number, tag: string, orig: string) =>
      this.signalMiniapp("spaces", "read", { offset, count, tag, orig }),
    list: async (offset: number, count: number) => this.signalMiniapp("spaces", "list", { offset, count }),
    join: async (spaceId: string) => this.signalMiniapp("spaces", "join", { storeId: spaceId }),
    history: async (spaceId: string) => this.signalMiniapp("spaces", "history", { storeId: spaceId }),
    signal: async (spaceId: string, userId: string, typ: string, data: string, lockId?: string, isTemp?: boolean) =>
      this.signalMiniapp("spaces", "signal", { storeId: spaceId, userId, type: typ, data, lockId }, !!isTemp),
    addMachine: async (spaceId: string, appId: string, machineId: string) =>
      this.signalMiniapp("spaces", "addProgram", { storeId: spaceId, creatureId: appId, programId: machineId }),
    addMember: async (userId: string, spaceId: string, metadata: { [key: string]: any }) =>
      this.signalMiniapp("spaces", "addMember", { storeId: spaceId, userId, metadata }),
    updateMember: async (userId: string, spaceId: string, metadata: { [key: string]: any }) =>
      this.signalMiniapp("spaces", "updateMember", { storeId: spaceId, userId, metadata }),
    removeMember: async (userId: string, spaceId: string) =>
      this.signalMiniapp("spaces", "removeMember", { storeId: spaceId, userId }),
    listMembers: async (spaceId: string) => this.signalMiniapp("spaces", "readMembers", { storeId: spaceId }),
    leave: async (spaceId: string) => this.signalMiniapp("spaces", "leave", { storeId: spaceId }),
    addApp: async (payload: any) => this.signalMiniapp("spaces", "addCreature", payload),
    listApps: async (payload: any) => this.signalMiniapp("spaces", "listCreatures", payload),
    updateMachine: async (payload: any) => this.signalMiniapp("spaces", "updateProgram", payload),
    removeApp: async (payload: any) => this.signalMiniapp("spaces", "removeCreature", payload),
    removeMachine: async (payload: any) => this.signalMiniapp("spaces", "removeProgram", payload),
    updateMemberAccess: async (payload: any) => this.signalMiniapp("spaces", "updateMemberAccess", payload),
    updateMachineAccess: async (payload: any) => this.signalMiniapp("spaces", "updateProgramAccess", payload),
    getDefaultAccess: async (payload: any) => this.signalMiniapp("spaces", "getDefaultAccess", payload),
    meta: async (spaceId: string) => this.signalMiniapp("spaces", "meta", { storeId: spaceId }),
  };

  public invites = {
    create: async (spaceId: string, userId: string) => this.signalMiniapp("invites", "create", { storeId: spaceId, userId }),
    cancel: async (spaceId: string, userId: string) => this.signalMiniapp("invites", "cancel", { storeId: spaceId, userId }),
    accept: async (spaceId: string) => this.signalMiniapp("invites", "accept", { storeId: spaceId }),
    decline: async (spaceId: string) => this.signalMiniapp("invites", "decline", { storeId: spaceId }),
    listPointInvites: async (spaceId: string) => this.signalMiniapp("invites", "listPointInvites", { storeId: spaceId }),
    listUserInvites: async () => this.signalMiniapp("invites", "listUserInvites", {}),
  };

  public chains = {
    create: async (participants: { [key: string]: number }, isTemp: boolean) =>
      this.signalMiniapp("chains", "create", { participants, isTemp }),
    submitBaseTrx: async (chainId: BigInt, key: string, obj: any) =>
      this.signalMiniapp("chains", "submitBaseTrx", { chainId, key, payload: obj }),
    registerNode: async (orig: string) => this.signalMiniapp("chains", "registerNode", { orig }),
    createFromPoint: async (spaceId: string, isTemp: boolean) =>
      this.signalMiniapp("chains", "createFromPoint", { storeId: spaceId, isTemp }),
  };

  public programs = {
    createApp: async (
      chainId: string,
      username: string,
      title: string,
      desc: string,
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/create", {
        type: "machine",
        username: username,
        chainId: chainId,
        metadata: {
          'public': {
            'profile': {
              'title': title,
              'avatar': '123',
              'desc': desc
            }
          }
        },
      });
    },
    createMachine: async (
      username: string,
      appId: string,
      path: string,
      runtime: string,
      comment: string,
      publicKey: string,
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/create", {
        username: username,
        appId: appId,
        path: path,
        publicKey: publicKey,
        runtime: runtime,
        comment: comment,
      });
    },
    deleteMachine: async (
      machineId: string,
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/delete", {
        programId: machineId,
      });
    },
    updateMachine: async (
      machineId: string,
      path: string,
      metadata: any,
      promptFile?: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      if (promptFile) {
        metadata["prompt"] = fs.readFileSync(promptFile, { encoding: 'utf-8' });
      }
      return await this.sendRequest(this.userId, "/programs/update", {
        programId: machineId,
        path: path,
        metadata: metadata
      });
    },
    deploy: async (
      machineId: string,
      byteCode: string,
      runtime: string,
      metadata: { [key: string]: any }
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      if (runtime == "docker") {
        if (!metadata["imageName"] && !metadata["standalone"]) {
          return {
            resCode: 100,
            obj: { message: "docker image name must be specified" },
          };
        }
        if (!metadata["files"]) {
          return {
            resCode: 101,
            obj: { message: "source files must be specified" },
          };
        }
        dockBuild = machineId;
        console.clear();
        console.log("starting docker build...");
      }
      // The server's DeployInput uses { machineId, entityId, entityType, payload, metadata, downloadable }.
      // Map the legacy CLI args onto that shape so both ends agree:
      //   byteCode (base64) -> payload
      //   runtime           -> entityType
      //   metadata.entity / metadata.entityId can override the default "main"
      const entityId = (metadata && (metadata.entityId || metadata.entity)) || "main";
      const downloadable = !!(metadata && metadata.downloadable);
      return await this.sendRequest(this.userId, "/programs/deploy", {
        machineId: machineId,
        entityId: entityId,
        entityType: runtime,
        payload: byteCode,
        downloadable: downloadable,
        metadata: metadata,
      });
    },
    // Deploy a front-end app (Elpian VM script) as a downloadable program
    // entity. Nothing runs on the node; clients fetch the script with
    // programs.downloadEntity and execute it locally.
    deployFrontend: async (
      machineId: string,
      entityId: string,
      scriptB64: string,
      metadata: { [key: string]: any } = {}
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/deploy", {
        machineId,
        entityId,
        entityType: metadata.entityType || "elpian",
        payload: scriptB64,
        downloadable: true,
        metadata: { ...metadata, delivery: "download" },
      });
    },
    // Deploy a back-end service as a wasm program entity: it runs whenever a
    // signal is sent to it (the natural wasm-VM behaviour in Caspar).
    deployBackend: async (
      machineId: string,
      entityId: string,
      moduleB64: string,
      metadata: { [key: string]: any } = {}
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/deploy", {
        machineId,
        entityId,
        entityType: "wasm",
        payload: moduleB64,
        metadata,
      });
    },
    // Deploy an AI agent: a skill file shipped as a Caspar *proxy* entity
    // targeting a davinci docker-VM creature. Signals to the agent entity are
    // forwarded with the skill attached (used as the davinci session's system
    // instruction) and davinci's result is routed back through the proxy with
    // the correlation id preserved — so creatures.signal resolves with it.
    deployAgent: async (
      machineId: string,
      entityId: string,
      skillB64: string,
      targetProgramId: string,
      targetEntityId: string = "",
      attachField: string = "skill",
      metadata: { [key: string]: any } = {}
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/deploy", {
        machineId,
        entityId,
        entityType: "proxy",
        payload: skillB64,
        metadata: {
          ...metadata,
          proxy: {
            // extras like correlationTtlMs (correlation-record lifetime, ms)
            // pass through from metadata.proxy; explicit args win.
            ...(metadata.proxy || {}),
            targetProgramId,
            targetEntityId,
            attachField,
          },
        },
      });
    },
    // Fetch a downloadable entity (e.g. a deployed front-end script) as
    // base64 for client-side execution.
    downloadEntity: async (
      machineId: string,
      entityId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/downloadEntity", {
        machineId,
        entityId,
      });
    },
    runMachine: async (
      machineId: string,
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/runEntity", {
        machineId: machineId,
        entityId: "main",
      });
    },
    listApps: async (
      offset: number,
      count: number
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/list", {
        offset: offset,
        count: count,
      });
    },
    listMachines: async (
      offset: number,
      count: number
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/list", {
        offset: offset,
        count: count,
      });
    },
    deleteApp: async (appId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/delete", { creatureId: appId });
    },
    updateApp: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/update", payload);
    },
    myCreatedApps: async (
      offset: number,
      count: number
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/creatures/list", { offset, count });
    },
    signal: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/signal", payload);
    },
    stopMachine: async (
      machineId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/stopEntity", { programId: machineId, entityId: "main" });
    },
    readBuildLogs: async (
      machineId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/readVmLogs", { vmId: machineId });
    },
    readMachineBuilds: async (
      machineId: string,
      offset: number,
      count: number
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/readBuilds", {
        machineId,
        offset,
        count,
      });
    },
    listAppMachines: async (
      appId: string,
      offset: number,
      count: number
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/programs/listByCreature", { creatureId: appId });
    },
  };
  storage = {
    upload: async (spaceId: string, data: Buffer, fileId?: string) => {
      return this.signalMiniapp("storage", "upload", { storeId: spaceId, data: data.toString("base64"), fileId });
    },
    uploadUserEntity: async (data: Buffer, entityId: string, machineId?: string) => {
      return this.signalMiniapp("storage", "uploadCreatureEntity", { machineId, data: data.toString("base64"), entityId });
    },
    deleteUserEntity: async (entityId: string) => {
      return this.signalMiniapp("storage", "deleteCreatureEntity", { entityId });
    },
    uploadPointEntity: async (spaceId: string, entityId: string, data: Buffer) => {
      return this.signalMiniapp("storage", "uploadStoreEntity", { storeId: spaceId, entityId, data: data.toString("base64") });
    },
    uploadAppEntity: async (appId: string, entityId: string, data: Buffer) => {
      return this.signalMiniapp("storage", "uploadMachineEntity", { appId, entityId, data: data.toString("base64") });
    },
    deletePointEntity: async (spaceId: string, entityId: string) => {
      return this.signalMiniapp("storage", "deleteStoreEntity", { storeId: spaceId, entityId });
    },
  download: async (spaceId: string, fileId: string) => {
      let res = await this.signalMiniapp("storage", "download", { storeId: spaceId, fileId });
      if (res.resCode === 0) {
        return new Promise((resolve, reject) => {
          fs.writeFile(
            "files/" + fileId,
            res.obj.data,
            { encoding: "binary" },
            () => {
              resolve(undefined);
            }
          );
        });
      }
    },
  };
  pc = {
    runPc: async () => {
      return this.signalMiniapp("pc", "run", {});
    },
    execCommand: async (vmId: string, command: string) => {
      return this.signalMiniapp("pc", "exec", { vmId, command });
    },
  };
  public miniapps = {
    invites: this.invites,
    storage: this.storage,
    chains: this.chains,
    pc: {
      run: () => this.pc.runPc(),
      exec: (vmId: string, command: string) => this.pc.execCommand(vmId, command),
    },
  };
}

function isNumeric(str: string) {
  try {
    BigInt(str);
    return true;
  } catch {
    return false;
  }
}

async function executeBash(command: string) {
  return new Promise((resolve, reject) => {
    let dir = exec.exec(command, function (err, stdout, stderr) {
      if (err) {
        reject(err);
      }
      console.log(stdout);
    });
    dir.on("exit", function (code) {
      resolve(code);
    });
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const envHost = process.env.DECILLION_HOST;
const envProto = process.env.DECILLION_PROTO || "ws";
const envPortStr = process.env.DECILLION_PORT;
const envPort = envPortStr ? parseInt(envPortStr, 10) : undefined;
let app = new Decillion(envProto, envHost, envPort);
let pcId: string | undefined = undefined;
let dockBuild: string | undefined = undefined;

const commands: {
  [key: string]: (args: string[]) => Promise<{ resCode: number; obj: any }>;
} = {
  login: async (args: string[]): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.login(args[0]);
  },
  loginDev: async (args: string[]): Promise<{ resCode: number; obj: any }> => {
    if (args.length < 1 || args.length > 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.loginDev(args[0], args[1]);
  },
  logout: async (args: string[]): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 0) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return app.logout();
  },
  charge: async (args: string[]): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 0) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return { resCode: 0, obj: { paymentUrl: await app.generatePayment() } };
  },
  printPrivateKey: async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 0) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    console.log("");
    console.log(app.myPrivateKey());
    console.log("");
    return { resCode: 0, obj: { message: "printed." } };
  },
  "creatures.me": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 0) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return app.creatures.me();
  },
  "creatures.get": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return app.creatures.get(args[0]);
  },
  "creatures.lockToken": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (!isNumeric(args[0])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: amount --> " + args[0] },
      };
    }
    return app.creatures.lockToken(Number(args[0]), args[1], args[2]);
  },
  "creatures.consumeLock": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (!isNumeric(args[2])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: amount --> " + args[2] },
      };
    }
    return app.creatures.consumeLock(args[0], args[1], Number(args[2]));
  },
  "creatures.list": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (!isNumeric(args[0])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: offset --> " + args[0] },
      };
    }
    if (!isNumeric(args[1])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: count --> " + args[1] },
      };
    }
    return app.creatures.list(Number(args[0]), Number(args[1]));
  },
  "creatures.signal": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4 && args.length !== 5) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return app.creatures.signal(args[0], args[1], args[2], args[3], args.length === 5 ? args[4] : undefined);
  },
  "spaces.create": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (args[0] !== "true" && args[0] !== "false") {
      return {
        resCode: 30,
        obj: { message: "unknown parameter value: isPublic --> " + args[0] },
      };
    }
    if (args[1] !== "true" && args[1] !== "false") {
      return {
        resCode: 30,
        obj: { message: "unknown parameter value: persHist --> " + args[1] },
      };
    }
    return await app.spaces.create(
      args[0] === "true",
      args[1] === "true",
      args[2],
      {
        'public': {
          'profile': {
            'title': args[3],
            'avatar': '123'
          }
        }
      }
    );
  },
  "spaces.update": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (args[1] !== "true" && args[1] !== "false") {
      return {
        resCode: 30,
        obj: { message: "unknown parameter value: isPublic --> " + args[1] },
      };
    }
    if (args[2] !== "true" && args[2] !== "false") {
      return {
        resCode: 30,
        obj: { message: "unknown parameter value: persHist --> " + args[2] },
      };
    }
    return await app.spaces.update(
      args[0],
      args[1] === "true",
      args[2] === "true"
    );
  },
  "spaces.get": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.get(args[0]);
  },
  "spaces.delete": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.delete(args[0]);
  },
  "spaces.join": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.join(args[0]);
  },
  "spaces.mySpaces": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (!isNumeric(args[0])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: offset --> " + args[0] },
      };
    }
    if (!isNumeric(args[1])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: count --> " + args[1] },
      };
    }
    return await app.spaces.mySpaces(
      Number(args[0]),
      Number(args[1]),
      "",
      args[2]
    );
  },
  "spaces.list": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (!isNumeric(args[0])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: offset --> " + args[0] },
      };
    }
    if (!isNumeric(args[1])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: count --> " + args[1] },
      };
    }
    return await app.spaces.list(Number(args[0]), Number(args[1]));
  },
  "spaces.history": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.history(args[0]);
  },
  "spaces.signal": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.signal(args[0], args[1], args[2], args[3]);
  },
  "spaces.fileSignal": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.signal(args[0], args[1], args[2], args[3]);
  },
  "spaces.paidSignal": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 5) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.signal(args[0], args[1], args[2], args[3], args[4]);
  },
  "spaces.addMember": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    let metadata: { [key: string]: any } = {};
    try {
      metadata = JSONbig.parse(args[2]);
    } catch (ex) {
      return { resCode: 30, obj: { message: "invalid metadata json" } };
    }
    return await app.spaces.addMember(args[0], args[1], metadata);
  },
  "spaces.updateMember": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    let metadata: { [key: string]: any } = {};
    try {
      metadata = JSONbig.parse(args[2]);
    } catch (ex) {
      return { resCode: 30, obj: { message: "invalid metadata json" } };
    }
    return await app.spaces.updateMember(args[0], args[1], metadata);
  },
  "spaces.removeMember": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.removeMember(args[0], args[1]);
  },
  "spaces.listMembers": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.listMembers(args[0]);
  },
  "spaces.addMachine": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.spaces.addMachine(args[0], args[1], args[2]);
  },
  "invites.create": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.miniapps.invites.create(args[0], args[1]);
  },
  "invites.cancel": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.miniapps.invites.cancel(args[0], args[1]);
  },
  "invites.accept": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.miniapps.invites.accept(args[0]);
  },
  "invites.decline": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.miniapps.invites.decline(args[0]);
  },
  "storage.upload": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2 && args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (args.length === 2) {
      return await app.miniapps.storage.upload(args[0], fs.readFileSync(args[1]));
    } else {
      return await app.miniapps.storage.upload(
        args[0],
        fs.readFileSync(args[1]),
        args[2]
      );
    }
  },
  "storage.uploadUserEntity": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2 && args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (args.length == 2) {
      return await app.miniapps.storage.uploadUserEntity(fs.readFileSync(args[1]), args[0]);
    } else {
      return await app.miniapps.storage.uploadUserEntity(fs.readFileSync(args[1]), args[0], args[2]);
    }
  },
  "storage.download": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    await app.miniapps.storage.download(args[0], args[1]);
    return { resCode: 0, obj: { message: `file ${args[1]} downloaded.` } };
  },
  "chains.create": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    let participants: { [key: string]: number } = {};
    try {
      participants = JSONbig.parse(args[0]);
    } catch (ex) {
      return { resCode: 30, obj: { message: "invalid participants json" } };
    }
    if (args[1] !== "true" && args[1] !== "false") {
      return {
        resCode: 30,
        obj: { message: "unknown parameter value: isTemp --> " + args[1] },
      };
    }
    return await app.miniapps.chains.create(participants, args[1] == "true");
  },
  "chains.submitBaseTrx": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2 && args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (!isNumeric(args[0])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: chainId --> " + args[0] },
      };
    }
    let obj: any = {};
    try {
      obj = JSONbig.parse(args[2]);
    } catch (ex) {
      return { resCode: 30, obj: { message: "invalid object json" } };
    }
    return await app.miniapps.chains.submitBaseTrx(BigInt(args[0]), args[1], obj);
  },
  "chains.registerNode": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.miniapps.chains.registerNode(args[0]);
  },
  "creatures.createMachine": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.programs.createApp(args[0], args[1], args[2], args[3]);
  },
  "programs.create": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 5) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.programs.createMachine(args[0], args[1], args[2], args[3], args[4], "");
  },
  
  "programs.delete": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.programs.deleteMachine(args[0]);
  },
  "programs.update": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3 && args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    let metadata: any = {};
    try {
      metadata = JSONbig.parse(args[2]);
    } catch (ex) {
      try {
        metadata = JSON.parse(fs.readFileSync(args[2], { encoding: 'utf-8' }));
      } catch (ex) {
        return { resCode: 30, obj: { message: "invalid metadata json" } };
      }
    }
    if (args.length == 4) {
      return await app.programs.updateMachine(args[0], args[1], metadata, args[3]);
    } else {
      return await app.programs.updateMachine(args[0], args[1], metadata);
    }
  },
  // Deploys a prebuilt wasm/binary directly from a file path, skipping the
  // builder/src convention used by `programs.deploy`. Useful for shipping
  // creature endpoints whose .wasm is produced by an external toolchain
  // (e.g. tinygo) without restructuring into the legacy build folder.
  "programs.deployRaw": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length < 3 || args.length > 5) {
      return { resCode: 30, obj: { message: "usage: programs.deployRaw [machineId] [entityId] [wasmPath] [optional runtime=wasm] [optional metadataJson]" } };
    }
    const [machineId, entityId, wasmPath, runtimeArg, metaArg] = args;
    const runtime = runtimeArg || "wasm";
    let metadata: any = {};
    if (metaArg) {
      try {
        metadata = JSONbig.parse(metaArg);
      } catch (ex) {
        return { resCode: 30, obj: { message: "invalid metadata json" } };
      }
    }
    metadata.entityId = entityId;
    let bc: Buffer;
    try {
      bc = fs.readFileSync(wasmPath);
    } catch (ex: any) {
      return { resCode: 30, obj: { message: `cannot read wasm file: ${ex.message}` } };
    }
    return await app.programs.deploy(
      machineId,
      bc.toString("base64"),
      runtime,
      metadata
    );
  },
  // Deploy an Elpian front-end app as a downloadable entity.
  // usage: programs.deployFrontend [machineId] [entityId] [scriptPath] [optional metadataJson]
  "programs.deployFrontend": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length < 3 || args.length > 4) {
      return { resCode: 30, obj: { message: "usage: programs.deployFrontend [machineId] [entityId] [scriptPath] [optional metadataJson]" } };
    }
    const [machineId, entityId, scriptPath, metaArg] = args;
    let metadata: any = {};
    if (metaArg) {
      try {
        metadata = JSONbig.parse(metaArg);
      } catch (ex) {
        return { resCode: 30, obj: { message: "invalid metadata json" } };
      }
    }
    let script: Buffer;
    try {
      script = fs.readFileSync(scriptPath);
    } catch (ex: any) {
      return { resCode: 30, obj: { message: `cannot read script file: ${ex.message}` } };
    }
    return await app.programs.deployFrontend(machineId, entityId, script.toString("base64"), metadata);
  },
  // Deploy a wasm back-end service entity (runs on incoming signals).
  // usage: programs.deployBackend [machineId] [entityId] [wasmPath] [optional metadataJson]
  "programs.deployBackend": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length < 3 || args.length > 4) {
      return { resCode: 30, obj: { message: "usage: programs.deployBackend [machineId] [entityId] [wasmPath] [optional metadataJson]" } };
    }
    const [machineId, entityId, wasmPath, metaArg] = args;
    let metadata: any = {};
    if (metaArg) {
      try {
        metadata = JSONbig.parse(metaArg);
      } catch (ex) {
        return { resCode: 30, obj: { message: "invalid metadata json" } };
      }
    }
    let bc: Buffer;
    try {
      bc = fs.readFileSync(wasmPath);
    } catch (ex: any) {
      return { resCode: 30, obj: { message: `cannot read wasm file: ${ex.message}` } };
    }
    return await app.programs.deployBackend(machineId, entityId, bc.toString("base64"), metadata);
  },
  // Deploy an AI agent skill as a proxy entity targeting a davinci creature.
  // usage: programs.deployAgent [machineId] [entityId] [skillPath] [davinciProgramId] [optional davinciEntityId]
  "programs.deployAgent": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length < 4 || args.length > 5) {
      return { resCode: 30, obj: { message: "usage: programs.deployAgent [machineId] [entityId] [skillPath] [davinciProgramId] [optional davinciEntityId]" } };
    }
    const [machineId, entityId, skillPath, davinciProgramId, davinciEntityId] = args;
    let skill: Buffer;
    try {
      skill = fs.readFileSync(skillPath);
    } catch (ex: any) {
      return { resCode: 30, obj: { message: `cannot read skill file: ${ex.message}` } };
    }
    return await app.programs.deployAgent(
      machineId,
      entityId,
      skill.toString("base64"),
      davinciProgramId,
      davinciEntityId || ""
    );
  },
  // Download a downloadable entity's script (e.g. a deployed front-end app).
  // usage: programs.downloadEntity [machineId] [entityId] [optional outPath]
  "programs.downloadEntity": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length < 2 || args.length > 3) {
      return { resCode: 30, obj: { message: "usage: programs.downloadEntity [machineId] [entityId] [optional outPath]" } };
    }
    const res = await app.programs.downloadEntity(args[0], args[1]);
    if (res.resCode === 0 && args[2] && res.obj && res.obj.payload) {
      try {
        fs.writeFileSync(args[2], Buffer.from(res.obj.payload, "base64"));
        res.obj.savedTo = args[2];
      } catch (ex: any) {
        return { resCode: 31, obj: { message: `cannot write output file: ${ex.message}` } };
      }
    }
    return res;
  },
  "programs.deploy": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    let metadata: any = {};
    try {
      metadata = JSONbig.parse(args[3]);
    } catch (ex) {
      return { resCode: 30, obj: { message: "invalid metadata json" } };
    }
    await executeBash(`cd ${args[1]}/builder && bash build.sh`);
    let bc = fs.readFileSync(`${args[1]}/builder/bytecode`);
    let files: { [name: string]: string } = {};
    fs.readdirSync(`${args[1]}/src`, { withFileTypes: true })
      .filter(item => !item.isDirectory())
      .map(item => {
        files[item.name] = fs.readFileSync(`${args[1]}/src/${item.name}`).toString('base64');
      });
    metadata["files"] = files;
    return await app.programs.deploy(
      args[0],
      bc.toString("base64"),
      args[2],
      metadata
    );
  },
  "programs.run": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.programs.runMachine(
      args[0],
    );
  },
  "creatures.listMachines": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (!isNumeric(args[0])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: offset --> " + args[0] },
      };
    }
    if (!isNumeric(args[1])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: count --> " + args[1] },
      };
    }
    return await app.programs.listApps(Number(args[0]), Number(args[1]));
  },
  "programs.list": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (!isNumeric(args[0])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: offset --> " + args[0] },
      };
    }
    if (!isNumeric(args[1])) {
      return {
        resCode: 30,
        obj: { message: "invalid numeric value: count --> " + args[1] },
      };
    }
    return await app.programs.listMachines(Number(args[0]), Number(args[1]));
  },
  
  
  "pc.run": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 0) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    console.clear();
    let res = await app.miniapps.pc.run();
    pcId = res.obj.vmId;
    return res;
  },
};

const helpEntries: { [key: string]: string } = {
  login: `login [username]
  → Log into your account.
  Example: login alice123`,
  logout: `logout
  → Log out and clear locally stored authentication credentials.
  Example: logout`,
  charge: `charge
  → Create a payment checkout session URL for your account.
  Example: charge`,
  printPrivateKey: `printPrivateKey
  → Print your account private key in base64 body format.
  Example: printPrivateKey`,
  "creatures.lockToken": `creatures.lockToken [amount] [type] [target]
  → Lock tokens for payment/execution use-cases.
  Example: creatures.lockToken 100 pay 145@global`,
  "creatures.consumeLock": `creatures.consumeLock [lockId] [type] [amount]
  → Consume a previously created token lock and settle payment.
  Example: creatures.consumeLock 4f0f02a8d0 pay 100`,
  "creatures.me": `creatures.me
  → Get your own creature profile.
  Example: creatures.me`,
  "creatures.get": `creatures.get [creatureId]
  → Get data for a specific creature by ID.
  Example: creatures.get 123@global`,
  "creatures.list": `creatures.list [offset] [count]
  → List creatures in paginated format.
  Example: creatures.list 0 10`,
  "creatures.signal": `creatures.signal [creatureId] [programId] [entity] [data] [optional storeId]
  → Send a signal to a creature miniapp program/entity target.
  Example: creatures.signal 123@global 456@global main '{"cmd":"ping"}'`,
  "spaces.create": `spaces.create [isPublic] [hasPersistentHistory] [origin] [title]
  → Create a new space.
  Example: spaces.create true true global study-room`,
  "spaces.update": `spaces.update [spaceId] [isPublic] [hasPersistentHistory]
  → Update visibility/history settings for a space.
  Example: spaces.update 345@global false true`,
  "spaces.get": `spaces.get [spaceId]
  → Retrieve details of a space.
  Example: spaces.get 345@global`,
  "spaces.delete": `spaces.delete [spaceId]
  → Delete a space.
  Example: spaces.delete 345@global`,
  "spaces.join": `spaces.join [spaceId]
  → Join a public space.
  Example: spaces.join 345@global`,
  "spaces.mySpaces": `spaces.mySpaces [offset] [count] [origin]
  → List your own spaces in an origin.
  Example: spaces.mySpaces 0 10 global`,
  "spaces.list": `spaces.list [offset] [count]
  → List spaces with pagination.
  Example: spaces.list 0 10`,
  "spaces.history": `spaces.history [spaceId]
  → Read signal/history log of a space.
  Example: spaces.history 345@global`,
  "spaces.signal": `spaces.signal [spaceId] [userId] [transferType] [data]
  → Send a signal/message.
  Example: spaces.signal 345@global - broadcast {"text":"hello"}`,
  "spaces.fileSignal": `spaces.fileSignal [spaceId] [userId] [transferType] [data]
  → Send a signal carrying file/entity metadata.
  Example: spaces.fileSignal 345@global 123@global single {"fileId":"789@global"}`,
  "spaces.paidSignal": `spaces.paidSignal [spaceId] [userId] [transferType] [data] [lockId]
  → Send a paid signal bound to a lock id.
  Example: spaces.paidSignal 345@global 123@global single {"task":"run"} 4f0f02a8d0`,
  "spaces.addMember": `spaces.addMember [userId] [spaceId] [metadata]
  → Add user membership to a space.
  Example: spaces.addMember 123@global 345@global {"role":"teacher"}`,
  "spaces.updateMember": `spaces.updateMember [userId] [spaceId] [metadata]
  → Update a user's space membership metadata.
  Example: spaces.updateMember 123@global 345@global {"role":"moderator"}`,
  "spaces.removeMember": `spaces.removeMember [userId] [spaceId]
  → Revoke a user membership from a space.
  Example: spaces.removeMember 123@global 345@global`,
  "spaces.listMembers": `spaces.listMembers [spaceId]
  → List members in a space.
  Example: spaces.listMembers 345@global`,
  "spaces.addMachine": `spaces.addMachine [spaceId] [appId] [machineId]
  → Attach a machine to a space.
  Example: spaces.addMachine 345@global 984@global 876@global`,
  "invites.create": `invites.create [spaceId] [userId]
  → Invite a user to a space.
  Example: invites.create 345@global 123@global`,
  "invites.cancel": `invites.cancel [spaceId] [userId]
  → Cancel a previously sent invitation.
  Example: invites.cancel 345@global 123@global`,
  "invites.accept": `invites.accept [spaceId]
  → Accept a space invitation.
  Example: invites.accept 345@global`,
  "invites.decline": `invites.decline [spaceId]
  → Decline a space invitation.
  Example: invites.decline 345@global`,
  "storage.upload": `storage.upload [spaceId] [filePath] [optional fileId]
  → Upload a file to a space.
  Example: storage.upload 345@global ./book.pdf`,
  "storage.uploadUserEntity": `storage.uploadUserEntity [entityId] [filePath] [optional machineId]
  → Upload a user-scoped entity file.
  Example: storage.uploadUserEntity avatar-v1 ./avatar.png`,
  "storage.download": `storage.download [spaceId] [fileId]
  → Download a file from a space.
  Example: storage.download 345@global 789@global`,
  "chains.create": `chains.create [participants stakes json] [isTemporary]
  → Create a workchain.
  Example: chains.create {"123.124.125.126":1600} false`,
  "chains.submitBaseTrx": `chains.submitBaseTrx [chainId] [key] [payload]
  → Submit a base transaction on-chain.
  Example: chains.submitBaseTrx 1 /points/create {"isPublic":true,"persHist":true,"orig":"global"}`,
  "chains.registerNode": `chains.registerNode [origin]
  → Register current node on a chain origin.
  Example: chains.registerNode global`,
  "creatures.createMachine": `creatures.createMachine [chainId] [username] [title] [desc]
  → Create a new app on a workchain.
  Example: creatures.createMachine 1 calcapp Calculator "simple calc app"`,
  "programs.create": `programs.create [username] [appId] [path] [runtime] [comment]
  → Create a machine under an app.
  Example: programs.create calculator 984@global /api/sum wasm "sum machine"`,
  "programs.delete": `programs.delete [machineId]
  → Delete an existing machine.
  Example: programs.delete 876@global`,
  "programs.update": `programs.update [machineId] [path] [metadataJsonOrFilePath] [optional promptFile]
  → Update machine route path and metadata.
  Example: programs.update 876@global /api/sum '{"public":{"profile":{"title":"Calc"}}}'`,
  "programs.deploy": `programs.deploy [machineId] [machineFolderPath] [runtime] [metadata]
  → Deploy project code as machine.
  Example: programs.deploy 876@global ./calculator-proj wasm {}`,
  "programs.run": `programs.run [machineId]
  → Start/run a deployed machine.
  Example: programs.run 876@global`,
  "creatures.listMachines": `creatures.listMachines [offset] [count]
  → List created apps with pagination.
  Example: creatures.listMachines 0 15`,
  "programs.list": `programs.list [offset] [count]
  → List created machines with pagination.
  Example: programs.list 0 15`,
  "pc.run": `pc.run
  → Create a cloud Linux PC micro-VM.
  Example: pc.run`,
};

const fullHelp = `Decillion AI CLI – Command Reference
For full documentation, visit: https://decillionai.com/docs/cli

${Object.values(helpEntries).join("\n\n")}

help [optional command]
  → Show full help or command-specific help.
  Example1: help
  Example2: help spaces.signal

Non-interactive mode:
  1) Single command: decillion <command> [args...]
     Example: decillion creatures.me
  2) Batch inline: decillion --batch "creatures.me; creatures.list 0 10"
  3) Batch file: decillion --batch-file ./commands.txt
`;


function parseCommandParts(str: string): string[] {
  let parts: string[] = [];
  let inVal = false;
  let valEdge = '';
  let temp = '';
  for (let i = 0; i < str.length; i++) {
    if (inVal) {
      if (str[i] === valEdge) {
        inVal = false;
        valEdge = '';
      } else {
        temp += str[i];
      }
    } else {
      if (str[i] === '\'' || str[i] === '"') {
        inVal = true;
        valEdge = str[i];
      } else if (str[i] === ' ') {
        if (temp !== '') {
          parts.push(temp);
          temp = '';
        }
      } else {
        temp += str[i];
      }
    }
  }
  if (temp !== '') {
    parts.push(temp);
  }
  return parts;
}

async function runParsedCommand(parts: string[]): Promise<number> {
  if (parts.length === 0) return 0;
  if (parts.length === 1 && parts[0] === 'help') {
    console.log(fullHelp);
    return 0;
  }
  if (parts.length === 2 && parts[0] === 'help') {
    let itemHelp = helpEntries[parts[1]];
    if (itemHelp) {
      console.log(itemHelp + "\n");
      return 0;
    }
    console.log(`help not found for command: ${parts[1]}`);
    return 1;
  }
  if (parts.length === 1 && parts[0] === 'clear') {
    console.clear();
    return 0;
  }
  let fn = commands[parts[0]];
  if (fn !== undefined) {
    let res = await fn(parts.slice(1));
    if (res.resCode == 0) {
      console.log(res.obj);
      return 0;
    }
    console.log("Error: ", res.obj);
    return res.resCode;
  }
  console.log("command not detected.");
  return 1;
}

function commandRequiresAuth(command: string): boolean {
  return command !== "login" && command !== "loginDev" && command !== "help" && command !== "clear";
}

async function runNonInteractive(argv: string[]): Promise<number> {
  // Short-circuit offline-only commands so users can browse help without
  // a live server connection.
  const firstArg = argv[0]?.trim();
  if (firstArg === "help" || firstArg === "clear") {
    return await runParsedCommand(parseCommandParts(argv.join(" ").trim()));
  }
  await app.connectTransport();

  let batches: string[] = [];
  if (argv[0] === "--batch") {
    const raw = argv.slice(1).join(" ").trim();
    batches = raw.split(";").map((x) => x.trim()).filter((x) => x.length > 0);
  } else if (argv[0] === "--batch-file" && argv[1]) {
    const raw = fs.readFileSync(argv[1], { encoding: "utf-8" });
    batches = raw
      .split("\n")
      .map((x) => x.trim())
      .filter((x) => x.length > 0 && !x.startsWith("#"));
  } else {
    batches = [argv.join(" ").trim()];
  }

  for (let i = 0; i < batches.length; i++) {
    const parts = parseCommandParts(batches[i]);
    if (parts.length === 0) continue;

    if (commandRequiresAuth(parts[0])) {
      if (!app.hasCredentials()) {
        console.log('Error: not authenticated. Please login first using: login [username]');
        return 10;
      }
      const auth = await app.authenticateSession();
      if (auth.resCode !== 0) {
        console.log('Error: authentication failed. Please login again with: login [username]');
        console.log(auth.obj);
        return auth.resCode;
      }
    }

    const code = await runParsedCommand(parts);
    if (code !== 0) return code;
  }
  return 0;
}

let ask = () => {
  rl.question(`${app.myUsername()}$ `, async (q) => {
    let str = q.trim();
    let parts = parseCommandParts(str);
    if (pcId) {
      let command = q.trim();
      if (parts.length == 2 && parts[0] === "pc" && parts[1] == "stop") {
        pcId = undefined;
        console.log(
          'Welcome to Decillion AI shell, enter your command or enter "help" to view commands instructions: \n'
        );
        setTimeout(() => {
          ask();
        });
      } else if (parts.length == 3 && parts[0] === "docker" && parts[1] == "logs" && parts[2] == "exit") {
        dockBuild = undefined;
        console.log(
          'Welcome to Decillion AI shell, enter your command or enter "help" to view commands instructions: \n'
        );
        setTimeout(() => {
          ask();
        });
      } else {
        await app.pc.execCommand(pcId, command);
        setTimeout(() => {
          ask();
        });
      }
      return;
    }

    await runParsedCommand(parts);
    setTimeout(() => {
      ask();
    });
  });
};

(async () => {
  console.clear();
  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    const code = await runNonInteractive(argv);
    process.exit(code);
  }
  await app.connect();
  console.log(
    'Welcome to Decillion AI shell, enter your command or enter "help" to view commands instructions: \n'
  );
  ask();
})();

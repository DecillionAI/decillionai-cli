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
      if (this.protocol === "tcp") {
        const options: tls.ConnectionOptions = {
          host: this.host,
          port: this.port,
          servername: this.host,
          rejectUnauthorized: true,
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
        this.websocket = new WebSocket(`wss://${this.host}:${this.port2}`);
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
        let obj = JSONbig.parse(payload.toString());
        if (key == "pc/message") {
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
    const meRes = await this.users.me();
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

        let res = await this.sendRequest("", "/users/login", {
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
          this.username = (await this.users.me()).obj.user.username;
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
  public async authenticate(): Promise<{ resCode: number; obj: any }> {
    if (!this.userId) {
      return {
        resCode: USER_ID_NOT_SET_ERR_CODE,
        obj: { message: USER_ID_NOT_SET_ERR_MSG },
      };
    }
    return await this.sendRequest(this.userId, "authenticate", {});
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
  public users = {
    get: async (userId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/users/get", {
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
      let res = await this.sendRequest(this.userId, "/users/lockToken", {
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
      return await this.sendRequest(this.userId, "/users/consumeLock", {
        amount: amount,
        type: type,
        lockId: lockId,
        signature: this.sign(Buffer.from(lockId)),
        userid: this.userId
      });
    },
    me: async (): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/users/get", {
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
      return await this.sendRequest(this.userId, "/users/list", {
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
      return await this.sendRequest(this.userId, "/users/transfer", {
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
      return await this.sendRequest(this.userId, "/users/mint", {
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
      return await this.sendRequest(this.userId, "/users/checkSign", {
        userId,
        payload,
        signature,
      });
    },
    create: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      return await this.sendRequest("", "/users/create", payload);
    },
    delete: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/users/delete", payload);
    },
    update: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/users/update", payload);
    },
    meta: async (userId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/users/meta", { userId });
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
      return await this.sendRequest(this.userId, "/users/getByUsername", { username });
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
      return await this.sendRequest(this.userId, "/users/find", { offset, count, query });
    },
    authenticate: async (): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/users/authenticate", {});
    },
  };
  public points = {
    create: async (
      isPublic: boolean,
      persHist: boolean,
      origin: string,
      metadata: { [key: string]: any }
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/create", {
        isPublic: isPublic,
        persHist: persHist,
        orig: origin,
        metadata,
        tag: 'group'
      });
    },
    update: async (
      pointId: string,
      isPublic: boolean,
      persHist: boolean
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/update", {
        pointId: pointId,
        isPublic: isPublic,
        persHist: persHist,
      });
    },
    delete: async (pointId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/delete", {
        pointId: pointId,
      });
    },
    get: async (pointId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/get", {
        pointId: pointId,
        includeMeta: true,
      });
    },
    myPoints: async (
      offset: number,
      count: number,
      tag: string,
      orig: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/read", {
        offset: offset,
        count: count,
        tag: tag,
        orig: orig,
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
      return await this.sendRequest(this.userId, "/points/list", {
        offset: offset,
        count: count,
      });
    },
    join: async (pointId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/join", {
        pointId: pointId,
      });
    },
    history: async (
      pointId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/history", {
        pointId: pointId,
      });
    },
    signal: async (
      pointId: string,
      userId: string,
      typ: string,
      data: string,
      lockId?: string,
      isTemp?: boolean,
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      if (lockId) {
        let m = JSONbig.parse(data);
        m["paymentLockId"] = lockId;
        m["lockSignature"] = this.sign(Buffer.from(lockId));
        let newData = JSONbig.stringify(m);
        this.sendRequest(this.userId, "/points/signal", {
          pointId: pointId,
          userId: userId,
          type: typ,
          data: newData,
          temp: isTemp
        });
      } else {
        this.sendRequest(this.userId, "/points/signal", {
          pointId: pointId,
          userId: userId,
          type: typ,
          data: data,
          temp: isTemp
        });
      }
      return {
        resCode: 0,
        obj: { message: "job created" },
      };
    },
    addMachine: async (
      pointId: string,
      appId: string,
      machineId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/addMachine", {
        pointId: pointId,
        appId: appId,
        machineMeta: { machineId: machineId, identifier: '0', metadata: {}, access: { "sendSignal": true } },
      });
    },
    addMember: async (
      userId: string,
      pointId: string,
      metadata: { [key: string]: any }
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/addMember", {
        pointId: pointId,
        userId: userId,
        metadata: metadata,
      });
    },
    updateMember: async (
      userId: string,
      pointId: string,
      metadata: { [key: string]: any }
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/updateMember", {
        pointId: pointId,
        userId: userId,
        metadata: metadata,
      });
    },
    removeMember: async (
      userId: string,
      pointId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/removeMember", {
        pointId: pointId,
        userId: userId,
      });
    },
    listMembers: async (
      pointId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/readMembers", {
        pointId,
      });
    },
    leave: async (pointId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/leave", { pointId });
    },
    addApp: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/addApp", payload);
    },
    listApps: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/listApps", payload);
    },
    updateMachine: async (
      payload: any
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/updateMachine", payload);
    },
    removeApp: async (
      payload: any
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/removeApp", payload);
    },
    removeMachine: async (
      payload: any
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/removeMachine", payload);
    },
    updateMemberAccess: async (
      payload: any
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/updateMemberAccess", payload);
    },
    updateMachineAccess: async (
      payload: any
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/updateMachineAccess", payload);
    },
    getDefaultAccess: async (
      payload: any
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/getDefaultAccess", payload);
    },
    meta: async (pointId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/points/meta", { pointId });
    },
  };
  public invites = {
    create: async (
      pointId: string,
      userId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/invites/create", {
        pointId: pointId,
        userId: userId,
      });
    },
    cancel: async (
      pointId: string,
      userId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/invites/cancel", {
        pointId: pointId,
        userId: userId,
      });
    },
    accept: async (pointId: string): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/invites/accept", {
        pointId: pointId,
      });
    },
    decline: async (
      pointId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/invites/decline", {
        pointId: pointId,
      });
    },
    listPointInvites: async (
      pointId: string
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/invites/listPointInvites", { pointId });
    },
    listUserInvites: async (): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/invites/listUserInvites", {});
    },
  };
  public chains = {
    create: async (
      participants: { [key: string]: number },
      isTemp: boolean
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/chains/create", {
        participants: participants,
        isTemp: isTemp,
      });
    },
    submitBaseTrx: async (
      chainId: BigInt,
      key: string,
      obj: any
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      let payload = this.stringToBytes(JSONbig.stringify(obj));
      let signature = this.sign(payload);
      return await this.sendRequest(this.userId, "/chains/submitBaseTrx", {
        chainId: chainId,
        key: key,
        payload: payload,
        signature: signature,
      });
    },
    registerNode: async (
      orig: string,
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/chains/registerNode", {
        orig: orig,
      });
    },
    createFromPoint: async (
      pointId: string,
      isTemp: boolean
    ): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/chains/createFromPoint", { pointId, isTemp });
    },
  };
  public machines = {
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
      return await this.sendRequest(this.userId, "/apps/create", {
        chainId: chainId,
        username: username,
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
      return await this.sendRequest(this.userId, "/machines/create", {
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
      return await this.sendRequest(this.userId, "/apps/deleteMachine", {
        machineId: machineId,
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
      return await this.sendRequest(this.userId, "/apps/updateMachine", {
        machineId: machineId,
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
      return await this.sendRequest(this.userId, "/machines/deploy", {
        machineId: machineId,
        byteCode: byteCode,
        runtime: runtime,
        metadata: metadata,
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
      return await this.sendRequest(this.userId, "/apps/runMachine", {
        machineId: machineId,
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
      return await this.sendRequest(this.userId, "/apps/list", {
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
      return await this.sendRequest(this.userId, "/machines/list", {
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
      return await this.sendRequest(this.userId, "/apps/deleteApp", { appId });
    },
    updateApp: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/apps/updateApp", payload);
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
      return await this.sendRequest(this.userId, "/apps/myCreatedApps", { offset, count });
    },
    signal: async (payload: any): Promise<{ resCode: number; obj: any }> => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/machines/signal", payload);
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
      return await this.sendRequest(this.userId, "/apps/stopMachine", { machineId });
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
      return await this.sendRequest(this.userId, "/machines/readBuildLogs", { machineId });
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
      return await this.sendRequest(this.userId, "/machines/readMachineBuilds", {
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
      return await this.sendRequest(this.userId, "/machines/listAppMachines", { appId, offset, count });
    },
  };
  storage = {
    upload: async (pointId: string, data: Buffer, fileId?: string) => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/storage/upload", {
        pointId: pointId,
        data: data.toString("base64"),
        fileId: fileId,
      });
    },
    uploadUserEntity: async (data: Buffer, entityId: string, machineId?: string) => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/storage/uploadUserEntity", {
        machineId: machineId,
        data: data.toString("base64"),
        entityId: entityId,
      });
    },
    deleteUserEntity: async (entityId: string) => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/storage/deleteUserEntity", { entityId });
    },
    uploadPointEntity: async (pointId: string, entityId: string, data: Buffer) => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/storage/uploadPointEntity", {
        pointId,
        entityId,
        data: data.toString("base64"),
      });
    },
    uploadAppEntity: async (appId: string, entityId: string, data: Buffer) => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/storage/uploadAppEntity", {
        appId,
        entityId,
        data: data.toString("base64"),
      });
    },
    deletePointEntity: async (pointId: string, entityId: string) => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/storage/deletePointEntity", { pointId, entityId });
    },
  download: async (pointId: string, fileId: string) => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      let res = await this.sendRequest(this.userId, "/storage/download", {
        pointId: pointId,
        fileId: fileId,
      });
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
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/pc/runPc", {});
    },
    execCommand: async (vmId: string, command: string) => {
      if (!this.userId) {
        return {
          resCode: USER_ID_NOT_SET_ERR_CODE,
          obj: { message: USER_ID_NOT_SET_ERR_MSG },
        };
      }
      return await this.sendRequest(this.userId, "/pc/execCommand", {
        vmId: vmId,
        command: command,
      });
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

let app = new Decillion();
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
  "users.me": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 0) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return app.users.me();
  },
  "users.get": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return app.users.get(args[0]);
  },
  "users.lockToken": async (
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
    return app.users.lockToken(Number(args[0]), args[1], args[2]);
  },
  "users.consumeLock": async (
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
    return app.users.consumeLock(args[0], args[1], Number(args[2]));
  },
  "users.list": async (
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
    return app.users.list(Number(args[0]), Number(args[1]));
  },
  "points.create": async (
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
    return await app.points.create(
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
  "points.update": async (
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
    return await app.points.update(
      args[0],
      args[1] === "true",
      args[2] === "true"
    );
  },
  "points.get": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.get(args[0]);
  },
  "points.delete": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.delete(args[0]);
  },
  "points.join": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.join(args[0]);
  },
  "points.myPoints": async (
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
    return await app.points.myPoints(
      Number(args[0]),
      Number(args[1]),
      "",
      args[2]
    );
  },
  "points.list": async (
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
    return await app.points.list(Number(args[0]), Number(args[1]));
  },
  "points.history": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.history(args[0]);
  },
  "points.signal": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.signal(args[0], args[1], args[2], args[3]);
  },
  "points.fileSignal": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.signal(args[0], args[1], args[2], args[3]);
  },
  "points.paidSignal": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 5) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.signal(args[0], args[1], args[2], args[3], args[4]);
  },
  "points.addMember": async (
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
    return await app.points.addMember(args[0], args[1], metadata);
  },
  "points.updateMember": async (
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
    return await app.points.updateMember(args[0], args[1], metadata);
  },
  "points.removeMember": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.removeMember(args[0], args[1]);
  },
  "points.listMembers": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.listMembers(args[0]);
  },
  "points.addMachine": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.points.addMachine(args[0], args[1], args[2]);
  },
  "invites.create": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.invites.create(args[0], args[1]);
  },
  "invites.cancel": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.invites.cancel(args[0], args[1]);
  },
  "invites.accept": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.invites.accept(args[0]);
  },
  "invites.decline": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.invites.decline(args[0]);
  },
  "storage.upload": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2 && args.length !== 3) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    if (args.length === 2) {
      return await app.storage.upload(args[0], fs.readFileSync(args[1]));
    } else {
      return await app.storage.upload(
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
      return await app.storage.uploadUserEntity(fs.readFileSync(args[1]), args[0]);
    } else {
      return await app.storage.uploadUserEntity(fs.readFileSync(args[1]), args[0], args[2]);
    }
  },
  "storage.download": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 2) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    await app.storage.download(args[0], args[1]);
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
    return await app.chains.create(participants, args[1] == "true");
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
    return await app.chains.submitBaseTrx(BigInt(args[0]), args[1], obj);
  },
  "chains.registerNode": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.chains.registerNode(args[0]);
  },
  "machines.createApp": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 4) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.machines.createApp(args[0], args[1], args[2], args[3]);
  },
  "machines.createMachine": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 5) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.machines.createMachine(args[0], args[1], args[2], args[3], args[4], "");
  },
  "machines.deleteMachine": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.machines.deleteMachine(args[0]);
  },
  "machines.updateMachine": async (
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
      return await app.machines.updateMachine(args[0], args[1], metadata, args[3]);
    } else {
      return await app.machines.updateMachine(args[0], args[1], metadata);
    }
  },
  "machines.deploy": async (
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
    return await app.machines.deploy(
      args[0],
      bc.toString("base64"),
      args[2],
      metadata
    );
  },
  "machines.runMachine": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 1) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    return await app.machines.runMachine(
      args[0],
    );
  },
  "machines.listApps": async (
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
    return await app.machines.listApps(Number(args[0]), Number(args[1]));
  },
  "machines.listMachines": async (
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
    return await app.machines.listMachines(Number(args[0]), Number(args[1]));
  },
  "pc.runPc": async (
    args: string[]
  ): Promise<{ resCode: number; obj: any }> => {
    if (args.length !== 0) {
      return { resCode: 30, obj: { message: "invalid parameters count" } };
    }
    console.clear();
    let res = await app.pc.runPc();
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
  "users.me": `users.me
  → Get your own user profile and metadata.
  Example: users.me`,
  "users.get": `users.get [userId]
  → Get data for a specific user by ID.
  Example: users.get 123@global`,
  "users.lockToken": `users.lockToken [amount] [type] [target]
  → Lock tokens for payment/execution use-cases.
  Example: users.lockToken 100 pay 145@global`,
  "users.consumeLock": `users.consumeLock [lockId] [type] [amount]
  → Consume a previously created token lock and settle payment.
  Example: users.consumeLock 4f0f02a8d0 pay 100`,
  "users.list": `users.list [offset] [count]
  → List users in paginated format.
  Example: users.list 0 10`,
  "points.create": `points.create [isPublic] [hasPersistentHistory] [origin] [title]
  → Create a new point.
  Example: points.create true true global study-room`,
  "points.update": `points.update [pointId] [isPublic] [hasPersistentHistory]
  → Update visibility/history settings for a point.
  Example: points.update 345@global false true`,
  "points.get": `points.get [pointId]
  → Retrieve details of a point.
  Example: points.get 345@global`,
  "points.delete": `points.delete [pointId]
  → Delete a point.
  Example: points.delete 345@global`,
  "points.join": `points.join [pointId]
  → Join a public point.
  Example: points.join 345@global`,
  "points.myPoints": `points.myPoints [offset] [count] [origin]
  → List your own points in an origin.
  Example: points.myPoints 0 10 global`,
  "points.list": `points.list [offset] [count]
  → List points with pagination.
  Example: points.list 0 10`,
  "points.history": `points.history [pointId]
  → Read signal/history log of a point.
  Example: points.history 345@global`,
  "points.signal": `points.signal [pointId] [userId] [transferType] [data]
  → Send a signal/message.
  Example: points.signal 345@global - broadcast {"text":"hello"}`,
  "points.fileSignal": `points.fileSignal [pointId] [userId] [transferType] [data]
  → Send a signal carrying file/entity metadata.
  Example: points.fileSignal 345@global 123@global single {"fileId":"789@global"}`,
  "points.paidSignal": `points.paidSignal [pointId] [userId] [transferType] [data] [lockId]
  → Send a paid signal bound to a lock id.
  Example: points.paidSignal 345@global 123@global single {"task":"run"} 4f0f02a8d0`,
  "points.addMember": `points.addMember [userId] [pointId] [metadata]
  → Add user membership to a point.
  Example: points.addMember 123@global 345@global {"role":"teacher"}`,
  "points.updateMember": `points.updateMember [userId] [pointId] [metadata]
  → Update a user's point membership metadata.
  Example: points.updateMember 123@global 345@global {"role":"moderator"}`,
  "points.removeMember": `points.removeMember [userId] [pointId]
  → Revoke a user membership from a point.
  Example: points.removeMember 123@global 345@global`,
  "points.listMembers": `points.listMembers [pointId]
  → List members in a point.
  Example: points.listMembers 345@global`,
  "points.addMachine": `points.addMachine [pointId] [appId] [machineId]
  → Attach a machine to a point.
  Example: points.addMachine 345@global 984@global 876@global`,
  "invites.create": `invites.create [pointId] [userId]
  → Invite a user to a point.
  Example: invites.create 345@global 123@global`,
  "invites.cancel": `invites.cancel [pointId] [userId]
  → Cancel a previously sent invitation.
  Example: invites.cancel 345@global 123@global`,
  "invites.accept": `invites.accept [pointId]
  → Accept a point invitation.
  Example: invites.accept 345@global`,
  "invites.decline": `invites.decline [pointId]
  → Decline a point invitation.
  Example: invites.decline 345@global`,
  "storage.upload": `storage.upload [pointId] [filePath] [optional fileId]
  → Upload a file to a point.
  Example: storage.upload 345@global ./book.pdf`,
  "storage.uploadUserEntity": `storage.uploadUserEntity [entityId] [filePath] [optional machineId]
  → Upload a user-scoped entity file.
  Example: storage.uploadUserEntity avatar-v1 ./avatar.png`,
  "storage.download": `storage.download [pointId] [fileId]
  → Download a file from a point.
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
  "machines.createApp": `machines.createApp [chainId] [username] [title] [desc]
  → Create a new app on a workchain.
  Example: machines.createApp 1 calcapp Calculator "simple calc app"`,
  "machines.createMachine": `machines.createMachine [username] [appId] [path] [runtime] [comment]
  → Create a machine under an app.
  Example: machines.createMachine calculator 984@global /api/sum wasm "sum machine"`,
  "machines.deleteMachine": `machines.deleteMachine [machineId]
  → Delete an existing machine.
  Example: machines.deleteMachine 876@global`,
  "machines.updateMachine": `machines.updateMachine [machineId] [path] [metadataJsonOrFilePath] [optional promptFile]
  → Update machine route path and metadata.
  Example: machines.updateMachine 876@global /api/sum '{"public":{"profile":{"title":"Calc"}}}'`,
  "machines.deploy": `machines.deploy [machineId] [machineFolderPath] [runtime] [metadata]
  → Deploy project code as machine.
  Example: machines.deploy 876@global ./calculator-proj wasm {}`,
  "machines.runMachine": `machines.runMachine [machineId]
  → Start/run a deployed machine.
  Example: machines.runMachine 876@global`,
  "machines.listApps": `machines.listApps [offset] [count]
  → List created apps with pagination.
  Example: machines.listApps 0 15`,
  "machines.listMachines": `machines.listMachines [offset] [count]
  → List created machines with pagination.
  Example: machines.listMachines 0 15`,
  "pc.runPc": `pc.runPc
  → Create a cloud Linux PC micro-VM.
  Example: pc.runPc`,
};

const fullHelp = `Decillion AI CLI – Command Reference
For full documentation, visit: https://decillionai.com/docs/cli

${Object.values(helpEntries).join("\n\n")}

help [optional command]
  → Show full help or command-specific help.
  Example1: help
  Example2: help points.signal

Non-interactive mode:
  1) Single command: decillion <command> [args...]
     Example: decillion users.me
  2) Batch inline: decillion --batch "users.me; users.list 0 10"
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
  return command !== "login" && command !== "help" && command !== "clear";
}

async function runNonInteractive(argv: string[]): Promise<number> {
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

import "dotenv/config";
import express, { Request, Response } from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer, Socket } from "socket.io";
import {
  Client as SSHClient,
  SFTPWrapper,
  ClientChannel,
  ExecOptions,
} from "ssh2";
import fs from "fs";
import path from "path";
import admin, { ServiceAccount } from "firebase-admin";
import dbConnect from "./lib/mongodb";

/* ====================
   Define Interfaces 
   ==================== */
interface FileType {
  filename: string;
  code: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

interface Sheet {
  _id: string;
  playgroundId: string;
  title: string;
  files: FileType[];
  canvasData: any;
  createdAt: string;
  updatedAt: string;
}

/* ====================
   Initialize Firebase Admin
   ==================== */
if (!admin.apps.length) {
  const serviceAccount: ServiceAccount = JSON.parse(
    process.env.FIREBASE_ADMIN_CRED || "{}"
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

/* ====================
   Utility Functions
   ==================== */

/**
 * Parses an environment file string into an object.
 */
function parseEnvFile(content: string): Record<string, string> {
  const envVars: Record<string, string> = {};
  content.split("\n").forEach((line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const parts = trimmed.split("=");
    const key = parts.shift();
    const value = parts.join("=");
    if (key) {
      envVars[key] = value;
    }
  });
  return envVars;
}

/**
 * Recursively creates a directory on the remote SFTP server.
 */
function mkdirRecursive(
  sftp: SFTPWrapper,
  remoteDir: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remoteDir, { mode: 0o755 }, (err: any) => {
      if (!err) {
        console.log(`mkdir: Created ${remoteDir}`);
        return resolve();
      }
      // If mkdir fails, try stat to see if directory already exists.
      sftp.stat(remoteDir, (statErr: any) => {
        if (!statErr) {
          console.log(`mkdir: ${remoteDir} already exists`);
          return resolve();
        }
        const parent = path.posix.dirname(remoteDir);
        if (parent === remoteDir) return resolve();
        mkdirRecursive(sftp, parent)
          .then(() => {
            sftp.mkdir(remoteDir, { mode: 0o755 }, (err2: any) => {
              if (err2) {
                console.error(`mkdir: Error creating ${remoteDir}:`, err2);
                reject(err2);
              } else {
                console.log(
                  `mkdir: Created ${remoteDir} after creating parent directories`
                );
                resolve();
              }
            });
          })
          .catch(reject);
      });
    });
  });
}

/**
 * Uploads a file’s content to the remote path.
 *
 * (Modified to use ws.end(content) and listen for "close" event so that the stream properly signals completion.)
 */
function uploadFile(
  sftp: SFTPWrapper,
  remoteFilePath: string,
  content: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream(remoteFilePath);
    ws.on("error", (error: any) => {
      console.error(`uploadFile: Error writing to ${remoteFilePath}:`, error);
      reject(error);
    });
    ws.on("close", () => {
      console.log(`uploadFile: Finished uploading ${remoteFilePath}`);
      resolve();
    });
    ws.end(content);
  });
}

/**
 * Uploads multiple files to a remote directory.
 */
async function uploadFiles(
  sftp: SFTPWrapper,
  remoteDir: string,
  files: FileType[]
): Promise<void> {
  for (const file of files) {
    const remoteFilePath = path.posix.join(remoteDir, file.filename);
    const remoteFileDir = path.posix.dirname(remoteFilePath);
    console.log(
      `uploadFiles: Creating directory for file ${file.filename} in ${remoteFileDir}`
    );
    await mkdirRecursive(sftp, remoteFileDir);
    await uploadFile(sftp, remoteFilePath, file.code);
  }
}

/* ====================
   Express and Socket.io Setup
   ==================== */
const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

const io = new SocketIOServer(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.get("/", (_req: Request, res: Response) => {
  res.send("Terminal WebSocket server is running.");
});

/* ====================
   Main Socket.io Handler
   ==================== */
io.on("connection", (socket: Socket) => {
  console.log("Client connected via WebSocket.");

  socket.on("start", async (data: any) => {
    console.log("Start event received with data:", data);
    socket.emit("message", "Backend: Preparing to run your code...\r\n");

    try {
      await dbConnect();

      // Dynamically import the Sheet model
      const SheetModel = (await import("./models/Sheet")).default;
      const sheet = (await SheetModel.findOne({
        _id: data.sheetId,
        playgroundId: data.playgroundId,
      }).lean()) as Sheet | null;

      if (!sheet) {
        socket.emit("message", "Error: Sheet not found.\r\n");
        socket.disconnect();
        return;
      }

      const files: FileType[] = sheet.files;
      if (!files || files.length === 0) {
        socket.emit("message", "Error: No files found.\r\n");
        socket.disconnect();
        return;
      }

      // Merge environment variables from all .env files
      let extraEnv: Record<string, string> = {};
      for (const file of files) {
        if (file.filename.endsWith(".env")) {
          const envVars = parseEnvFile(file.code);
          extraEnv = { ...extraEnv, ...envVars };
        }
      }

      const lang: string = files[0].language.toLowerCase();
      let entryFilename: string = files[0].filename;
      if (lang === "javascript" && files.some((f) => f.filename === "index.js")) {
        entryFilename = "index.js";
      } else if (lang === "python" && files.some((f) => f.filename === "main.py")) {
        entryFilename = "main.py";
      } else if (lang !== "javascript" && lang !== "python") {
        socket.emit("message", "Error: Unsupported language.\r\n");
        socket.disconnect();
        return;
      }

      const remoteTempDir: string = `/tmp/run-${Date.now()}-${Math.floor(
        Math.random() * 1000
      )}`;
      console.log("Remote temp dir:", remoteTempDir);

      const conn = new SSHClient();

      conn.on("ready", () => {
        console.log("SSH Connection ready.");
        // Start SFTP session
        conn.sftp(
          (
            sftpErr: Error | null | undefined,
            sftp: SFTPWrapper | undefined
          ) => {
            if (sftpErr || !sftp) {
              socket.emit(
                "message",
                `Error establishing SFTP: ${sftpErr ? sftpErr.message : "Unknown error"
                }\r\n`
              );
              socket.disconnect();
              return;
            }
            console.log("SFTP session established.");
            (async () => {
              try {
                console.log("Creating remote directory...");
                await mkdirRecursive(sftp, remoteTempDir);
                console.log("Remote directory created.");

                console.log("Uploading files...");
                await uploadFiles(sftp, remoteTempDir, files);
                console.log("Files uploaded successfully.");

                // End SFTP session to free the resource.
                if (typeof sftp.end === "function") {
                  sftp.end();
                  console.log("SFTP session ended.");
                }

                // Build the command string based on language.
                let cmd: string;
                if (lang === "javascript") {
                  const hasPackageJson = files.some(
                    (f) => f.filename === "package.json"
                  );
                  cmd = `cd ${remoteTempDir} && ${hasPackageJson ? "npm install && " : ""
                    }node ${entryFilename}`;
                } else {
                  const pythonCmd = process.env.PYTHON_CMD || "python3";
                  cmd = `cd ${remoteTempDir} && ${pythonCmd} ${entryFilename}`;
                }

                console.log("Final remote command:", cmd);
                socket.emit(
                  "message",
                  "Backend: Code execution started.\r\n"
                );

                // Execute the command using a pseudo-terminal.
                const execOptions = {
                  pty: true,
                  env: { ...process.env, ...extraEnv },
                } as ExecOptions;

                conn.exec(
                  cmd,
                  execOptions,
                  (
                    execErr: Error | null | undefined,
                    stream: ClientChannel | undefined
                  ) => {
                    if (execErr || !stream) {
                      socket.emit(
                        "message",
                        `Error executing command: ${execErr ? execErr.message : "Unknown error"
                        }\r\n`
                      );
                      socket.disconnect();
                      return;
                    }
                    console.log("Command execution started.");
                    // Link the stream so that input can be forwarded
                    (socket as any).sshStream = stream;

                    stream.on("data", (chunk: Buffer) => {
                      const output = chunk.toString();
                      console.log("STDOUT:", output);
                      socket.emit("message", output);
                    });

                    stream.stderr.on("data", (chunk: Buffer) => {
                      const errOutput = chunk.toString();
                      console.error("STDERR:", errOutput);
                      socket.emit("message", errOutput);
                    });

                    stream.on("close", (code: number, signal: string) => {
                      socket.emit(
                        "message",
                        `\r\nBackend: Process exited with code ${code}.\r\n`
                      );
                      conn.end();
                    });
                  }
                );
              } catch (uploadError: unknown) {
                const errorMessage =
                  uploadError instanceof Error ? uploadError.message : "Unknown error";
                socket.emit("message", `Error during file upload: ${errorMessage}\r\n`);
                conn.end();
              }
            })();
          }
        );
      });

      conn.on("error", (connErr: Error) => {
        socket.emit("message", `SSH Connection Error: ${connErr.message}\r\n`);
        socket.disconnect();
      });

      conn.connect({
        host: process.env.SSH_HOST!,
        port: process.env.SSH_PORT ? parseInt(process.env.SSH_PORT) : 22,
        username: process.env.SSH_USER!,
        privateKey: process.env.SSH_PRIVATE_KEY
          ? fs.readFileSync(process.env.SSH_PRIVATE_KEY)
          : undefined,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      socket.emit("message", `Error: ${errorMessage}\r\n`);
    }
  });

  socket.on("input", (data: { input: string }) => {
    const stream: ClientChannel | undefined = (socket as any).sshStream;
    if (stream) {
      stream.write(data.input);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected.");
  });
});

const PORT: number = process.env.PORT ? parseInt(process.env.PORT) : 3001;
server.listen(PORT, () => {
  console.log(`WebSocket Terminal server is running on port ${PORT}`);
});

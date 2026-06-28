import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "./env.js";

let io: Server | undefined;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, { cors: { origin: env.clientOrigin } });

  io.on("connection", (socket) => {
    socket.on("join:queueBoard", () => socket.join("queueBoard"));
    socket.on("join:tracking", (token: string) => socket.join(`tracking:${token}`));
  });

  return io;
}

export function emitQueueBoardUpdate() {
  io?.to("queueBoard").emit("queueBoard:update");
}

export function emitTrackingUpdate(token: string, payload: unknown) {
  io?.to(`tracking:${token}`).emit("tracking:update", payload);
}

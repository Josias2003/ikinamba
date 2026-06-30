import { io } from "socket.io-client";

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
export const socket = io(apiUrl, { autoConnect: false });

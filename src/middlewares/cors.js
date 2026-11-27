import cors from "cors";
import { env } from "../config/index.js";
import { AppError } from "../utils/index.js";

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:8081"];

const CORS_EXPOSED_HEADERS = [
  "X-Total-Count",
  "X-Truncated",
  "Content-Disposition",
];

const corsOptionsDelegate = (req, callback) => {
  const origin = req.headers.origin;

  if (!origin) {
    return callback(null, {
      origin: true,
      credentials: true,
      exposedHeaders: CORS_EXPOSED_HEADERS,
    });
  }

  if (allowedOrigins.includes(origin)) {
    return callback(null, {
      origin: true,
      credentials: true,
      exposedHeaders: CORS_EXPOSED_HEADERS,
    });
  }

  const clientIp = req.ip || req.socket?.remoteAddress || "desconhecido";
  const method = req.method;
  const path = req.originalUrl || req.url;

  return callback(
    new AppError(
      `Bloqueio de CORS: Origem '${origin}' não autorizada para o IP ${clientIp} em ${method} ${path}.`,
      403
    )
  );
};

export default cors(corsOptionsDelegate);

import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");

// StorageProvider boundary: local disk for dev, swap to Firebase/S3 later by
// changing this module only -- routes just read back `/uploads/<filename>` URLs.
export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const publicUrlFor = (filename: string) => `/uploads/${filename}`;

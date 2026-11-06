// `output: standalone` leaves out what a CDN would normally serve. We serve it ourselves.
import { cpSync } from "node:fs";

cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("public", ".next/standalone/public", { recursive: true });

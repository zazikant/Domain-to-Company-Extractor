import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";

import { join } from "path";
const LOG_FILE = process.env.LOG_FILE || join(process.cwd(), "logs", "request-log.txt");

export async function GET() {
  try {
    if (!existsSync(LOG_FILE)) {
      return NextResponse.json({ logs: [], message: `No log file found at ${LOG_FILE}` });
    }
    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    // Return last 50 entries
    const recent = lines.slice(-50).map((line) => {
      try { return JSON.parse(line); }
      catch { return { raw: line }; }
    });
    return NextResponse.json({ logs: recent, total: lines.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read logs", path: LOG_FILE },
      { status: 500 }
    );
  }
}

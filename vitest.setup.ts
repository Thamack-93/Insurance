import { vi } from "vitest";

// Next.js provides `server-only` as a compile-time boundary. Vitest does not
// need that marker at runtime, so provide one process-wide test stub instead
// of requiring every logic fixture to repeat the same mock.
vi.mock("server-only", () => ({}));

// The application marks server modules with `server-only`. A controlled
// operator CLI is itself a server process, so this preload makes that marker a
// no-op for the CLI process without changing application bundles.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return load.call(this, request, parent, isMain);
};

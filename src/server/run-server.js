import path from "node:path";

import { createProtocolServer } from "./create-server.js";
import { FileBackedStateStore } from "./state-store.js";

export async function startProtocolServer({
  port = 8080,
  host = "127.0.0.1",
  dataFile = path.resolve("data/server-state.json"),
}) {
  const store = new FileBackedStateStore(dataFile);
  await store.init();

  const server = createProtocolServer({ store });

  await new Promise((resolve) => {
    server.listen(port, host, resolve);
  });

  return {
    server,
    store,
    baseUrl: `http://${host}:${server.address().port}`,
  };
}

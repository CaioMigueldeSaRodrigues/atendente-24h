import { server } from "./app/run-operator-preview.js";

const port = Number(process.env.PORT) || 3000;
const host = "127.0.0.1";

server.listen(port, host, () => {
  console.log(`Ampliview preview listening on http://${host}:${port}`);
});

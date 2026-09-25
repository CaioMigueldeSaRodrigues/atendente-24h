import { server } from "./app/run-operator-preview.js";

const port = Number(process.env.PORT) || 3000;

server.listen(port, () => {
  console.log(`Ampliview preview listening on port ${port}`);
});

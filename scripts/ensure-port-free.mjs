import net from "net";

const port = Number(process.env.PORT ?? "3002");

function canConnect(host, p) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: p });

    const done = (result) => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function checkPortInUse(p) {
  // Try both IPv4 and IPv6 loopback. On Windows a process can listen on :: without occupying 127.0.0.1.
  const v4 = await canConnect("127.0.0.1", p);
  if (v4) return true;
  const v6 = await canConnect("::1", p);
  return v6;
}

const inUse = await checkPortInUse(port);
if (inUse) {
  // eslint-disable-next-line no-console
  console.error(
    `Port ${port} is already in use. Stop the running Next dev server before running dev:clean (otherwise .next gets deleted while the server is live, causing missing CSS/chunks).`
  );
  process.exit(1);
}

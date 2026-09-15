import { useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc/lib/rfb";

function connectionFromHash(): { url: string; password: string } {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const connectionUrl = params.get("connectionUrl");
  const password = params.get("password");
  if (!connectionUrl || !password) throw new Error("The Orgo desktop link is incomplete.");
  const base = new URL(connectionUrl);
  if (base.protocol !== "https:" || !/^\/desktops\/[A-Za-z0-9_-]+\/?$/.test(base.pathname)) {
    throw new Error("The Orgo desktop address is invalid.");
  }
  base.protocol = "wss:";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/ws/websockify`;
  base.search = "";
  base.hash = "";
  base.searchParams.set("token", password);
  return { url: base.toString(), password };
}

export function OrgoViewerPage() {
  const screen = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("Connecting to Orgo…");

  useEffect(() => {
    if (!screen.current) return;
    let rfb: RFB | null = null;
    try {
      const connection = connectionFromHash();
      rfb = new RFB(screen.current, connection.url, { credentials: { password: connection.password } });
      rfb.scaleViewport = true;
      rfb.resizeSession = true;
      rfb.clipViewport = true;
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 2;
      rfb.addEventListener("connect", () => setMessage(""));
      rfb.addEventListener("credentialsrequired", () => rfb?.sendCredentials({ password: connection.password }));
      rfb.addEventListener("securityfailure", () => setMessage("Orgo rejected the desktop credential. Reopen the desktop to refresh it."));
      rfb.addEventListener("disconnect", (event: Event) => {
        if (!(event as CustomEvent<{ clean?: boolean }>).detail?.clean) {
          setMessage("The Orgo desktop disconnected. Close this window and reopen it to reconnect.");
        }
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Orgo desktop could not be opened.");
    }
    return () => rfb?.disconnect();
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <div ref={screen} className="h-full w-full" aria-label="Orgo live desktop" />
      {message ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/85 p-8 text-center text-sm text-white/70">
          {message}
        </div>
      ) : null}
    </main>
  );
}

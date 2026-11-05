"""Serve the independent Vite dist with SPA history fallback on loopback."""
import functools
import http.server
from pathlib import Path
import threading
import webbrowser
import argparse
import socket
from urllib.parse import urlsplit


class LocalServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = not hasattr(socket, "SO_EXCLUSIVEADDRUSE")

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class AppHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".css": "text/css",
                      ".webp": "image/webp", ".svg": "image/svg+xml"}

    def do_GET(self):
        path = urlsplit(self.path).path
        target = Path(self.translate_path(path))
        if not target.is_file() and (not Path(path).suffix or path.endswith("/index.html")):
            self.path = "/index.html"
        super().do_GET()


def main():
    directory = Path(__file__).resolve().parent / "dist"
    if not (directory / "index.html").is_file():
        raise SystemExit("尚未构建 Vue 版本。请先运行 npm ci 和 npm run build，再运行本脚本。")
    handler = functools.partial(AppHandler, directory=str(directory))
    parser = argparse.ArgumentParser(description="启动帝龙本地工作台")
    parser.add_argument("--port", type=int, default=51458, help="固定端口，默认51458；浏览器保存的数据按地址区分")
    parser.add_argument("--no-browser", action="store_true", help="仅启动服务，不自动打开浏览器")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口必须为1—65535")
    try:
        server = LocalServer(("127.0.0.1", args.port), handler)
    except OSError as error:
        raise SystemExit(f"无法启动端口 {args.port}：{error}。请关闭占用此端口的服务后重试；更换端口会使用另一份浏览器存储。") from error
    with server:
        url = f"http://127.0.0.1:{server.server_address[1]}/"
        print(f"帝龙平台已启动：{url}", flush=True)
        print("请保持此终端运行；退出请按 Control+C。", flush=True)
        if not args.no_browser:
            threading.Timer(0.5, webbrowser.open, args=(url,)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n已关闭。", flush=True)


if __name__ == "__main__":
    main()

"""Serve only this package on loopback; no installation or internet needed."""
import functools
import http.server
from pathlib import Path
import threading
import webbrowser
import argparse
import socket


class LocalServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = not hasattr(socket, "SO_EXCLUSIVEADDRUSE")

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    directory = Path(__file__).resolve().parent
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    parser = argparse.ArgumentParser(description="启动帝龙本地工作台")
    parser.add_argument("--port", type=int, default=51455, help="固定端口，默认51455；浏览器保存的数据按地址区分")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口必须为1—65535")
    try:
        server = LocalServer(("127.0.0.1", args.port), handler)
    except OSError as error:
        raise SystemExit(f"无法启动端口 {args.port}：{error}。请关闭占用此端口的服务后重试；更换端口会使用另一份浏览器存储。") from error
    with server:
        url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
        print(f"帝龙平台已启动：{url}", flush=True)
        print("请保持此终端运行；退出请按 Control+C。", flush=True)
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n已关闭。", flush=True)


if __name__ == "__main__":
    main()

"""
WizarPOS Dev Server - APK server + Log viewer + Auto-discovery

Usage:
    py serve_apk.py

Features:
    - Serves APK to device on port 8888
    - Receives and displays logs from device via POST /log
    - Broadcasts UDP beacon so device can auto-detect this PC
    - Saves all device logs to device_log.txt
    - Keyboard: b=Build  l=Clear  q=Quit  h=Help
"""

import http.server
import os
import subprocess
import sys
import threading
import time
import socket
from datetime import datetime

PORT = 8888
BEACON_PORT = 8889
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
APK_PATH = os.path.join(PROJECT_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk")
LOG_FILE = os.path.join(PROJECT_DIR, "device_log.txt")
JAVA_HOME = r"C:\Program Files\Android\Android Studio1\jbr"

# Terminal colors
class C:
    RESET = "\033[0m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    DIM = "\033[90m"
    BOLD = "\033[1m"

log_lock = threading.Lock()

def ts():
    return datetime.now().strftime("%H:%M:%S")

def plog(tag, msg, color=C.RESET):
    print(f"{C.DIM}[{ts()}]{C.RESET} {color}{tag:>5}{C.RESET}  {msg}")


# ---- HTTP Handler ----

class DevHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/app-debug.apk" or self.path == "/":
            self.serve_apk()
        elif self.path == "/ping":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"pong")
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/log":
            self.receive_log()
        else:
            self.send_error(404)

    def serve_apk(self):
        if not os.path.exists(APK_PATH):
            self.send_error(404, "APK not found")
            plog("APK", "NOT FOUND - press 'b' to build", C.RED)
            return
        file_size = os.path.getsize(APK_PATH)
        mod_time = datetime.fromtimestamp(os.path.getmtime(APK_PATH)).strftime("%H:%M:%S")
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.android.package-archive")
        self.send_header("Content-Length", str(file_size))
        self.end_headers()
        with open(APK_PATH, "rb") as f:
            self.wfile.write(f.read())
        plog("APK", f"Served {file_size // 1024} KB (built {mod_time}) -> {self.client_address[0]}", C.GREEN)

    def receive_log(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")

            with log_lock:
                for line in body.strip().split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    color = C.RESET
                    if "ERROR" in line or "FAIL" in line:
                        color = C.RED
                    elif "OK" in line or "success" in line.lower() or "completed" in line.lower():
                        color = C.GREEN
                    elif "---" in line or "===" in line:
                        color = C.CYAN
                    elif "bind(" in line or "desc=" in line or "=>" in line:
                        color = C.YELLOW
                    plog("DEV", line, color)

                # Append to log file
                with open(LOG_FILE, "a", encoding="utf-8") as f:
                    f.write(f"[{ts()}] {body.strip()}\n")

        except Exception as e:
            plog("ERR", str(e), C.RED)
            try:
                self.send_error(500)
            except Exception:
                pass

    def log_message(self, format, *args):
        pass


# ---- UDP Beacon ----

def udp_beacon(local_ip):
    """Broadcast UDP beacon so device can auto-detect this PC."""
    msg = f"WIZARPOS_DEV_SERVER:{local_ip}".encode("utf-8")
    while True:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.sendto(msg, ("255.255.255.255", BEACON_PORT))
            sock.close()
        except Exception:
            pass
        time.sleep(2)


# ---- Build ----

def build_apk():
    plog("BUILD", "Building APK...", C.YELLOW)
    gradlew = os.path.join(PROJECT_DIR, "gradlew.bat")
    env = os.environ.copy()
    env["JAVA_HOME"] = JAVA_HOME
    try:
        result = subprocess.run(
            [gradlew, "assembleDebug"],
            cwd=PROJECT_DIR, env=env,
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            size = os.path.getsize(APK_PATH) // 1024 if os.path.exists(APK_PATH) else 0
            plog("BUILD", f"SUCCESS ({size} KB) - tap Update on device", C.GREEN)
        else:
            lines = (result.stderr or result.stdout).strip().split("\n")
            for line in lines[-8:]:
                if line.strip():
                    plog("BUILD", line.strip(), C.RED)
    except subprocess.TimeoutExpired:
        plog("BUILD", "TIMEOUT", C.RED)
    except Exception as e:
        plog("BUILD", str(e), C.RED)


# ---- Keyboard ----

def keyboard_listener():
    while True:
        try:
            cmd = input().strip().lower()
            if cmd == "b":
                threading.Thread(target=build_apk, daemon=True).start()
            elif cmd == "l":
                plog("SYS", "Log cleared", C.CYAN)
            elif cmd == "q":
                plog("SYS", "Bye!", C.YELLOW)
                os._exit(0)
            elif cmd == "h" or cmd == "?":
                print(f"\n  {C.CYAN}b{C.RESET} = Build APK    "
                      f"{C.CYAN}l{C.RESET} = Clear log    "
                      f"{C.CYAN}q{C.RESET} = Quit\n")
        except EOFError:
            break


# ---- Main ----

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    local_ip = get_local_ip()
    apk_ready = os.path.exists(APK_PATH)

    print(f"""
  {C.GREEN}{C.BOLD}{'=' * 48}
   WizarPOS Dev Server
  {'=' * 48}{C.RESET}

  {C.CYAN}PC IP:{C.RESET}     {C.BOLD}{local_ip}{C.RESET}
  {C.CYAN}HTTP:{C.RESET}      port {PORT}
  {C.CYAN}Beacon:{C.RESET}    UDP broadcast on port {BEACON_PORT}
  {C.CYAN}APK:{C.RESET}       {"READY" if apk_ready else "NOT BUILT (press b)"}
  {C.CYAN}Log file:{C.RESET}  {LOG_FILE}

  {C.YELLOW}Keys:{C.RESET}  b=Build  l=Clear  q=Quit

  {C.DIM}Device will auto-detect this PC, or enter {local_ip}{C.RESET}
""")

    # Start UDP beacon
    threading.Thread(target=udp_beacon, args=(local_ip,), daemon=True).start()

    # Start keyboard listener
    threading.Thread(target=keyboard_listener, daemon=True).start()

    # Start HTTP server
    server = http.server.HTTPServer(("0.0.0.0", PORT), DevHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        plog("SYS", "Stopped.", C.YELLOW)
        server.server_close()

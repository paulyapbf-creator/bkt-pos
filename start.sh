#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")"
termux-wake-lock
echo "Starting POS server..."
node server.js

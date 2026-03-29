@echo off
pause
echo POS system setup
echo
pause

cd C:\bkt-pos
start "POS Server" node server.js

echo Setup done

pause

rem C:\Users\<username>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
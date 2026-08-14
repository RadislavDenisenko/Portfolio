@echo off
rem Double-click this to open the dashboard. Close this window to stop it.
cd /d "%~dp0"

rem Grab anything new from Gmail FIRST - invoices, receipts, odometer readings -
rem so the page that opens is already up to date. One double-click, not two.
rem If the network is down this fails loudly above and the dashboard still
rem opens with whatever was already stored.
echo Checking Gmail for new invoices and receipts...
python fetch_invoices.py
echo.

rem Let the server bind before the browser knocks. Opening the tab first races
rem Python's startup, and a browser that loses shows a connection error rather
rem than retrying.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & explorer http://localhost:8080/"

echo Dashboard: http://localhost:8080/
echo Close this window to stop it.
echo.

rem Loopback only: nothing else on the network can reach your pay data, and
rem Windows Firewall has no reason to prompt.
python -m http.server 8080 --bind 127.0.0.1

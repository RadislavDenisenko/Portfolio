@echo off
rem Double-click this to open the dashboard. Close the window to stop it.
cd /d "%~dp0"
start "" http://localhost:8080/
python -m http.server 8080

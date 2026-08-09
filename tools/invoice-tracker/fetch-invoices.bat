@echo off
rem Double-click this to pull new invoices AND new receipt photos out of Gmail.
cd /d "%~dp0"
python fetch_invoices.py
echo.
pause


@echo off
cd /d "%~dp0"

set "MODEL=%~dp0models\qwen2.5-1.5b-instruct-q4_k_m.gguf"
set "SERVER=%~dp0llama-server.exe"

echo ==========================================
echo       LLAMA 3.2 1B LOCAL CHAT
echo ==========================================

if not exist "%MODEL%" (
    echo ERROR: Model file not found:
    echo %MODEL%
    pause
    exit /b 1
)

if not exist "%SERVER%" (
    echo ERROR: llama-server.exe not found.
    pause
    exit /b 1
)

"%SERVER%" -m "%MODEL%" --host 127.0.0.1 --port 8080 -c 2048 -t 4 -np 1

pause

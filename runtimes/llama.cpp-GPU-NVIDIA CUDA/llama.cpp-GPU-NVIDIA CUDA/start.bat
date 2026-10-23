
@echo off
cd /d "%~dp0"
set "PATH=%~dp0;%PATH%"

echo ========================================
echo       QWEN 2.5 1.5B CUDA SERVER
echo ========================================
echo.
echo GPU: NVIDIA CUDA
echo Server: http://127.0.0.1:8080
echo Press Ctrl+C to stop the server.
echo.

llama-server.exe ^
  -m "models\qwen2.5-1.5b-instruct-q4_k_m.gguf" ^
  --host 127.0.0.1 ^
  --port 8080 ^
  -ngl 99 ^
  -c 2048 ^
  -t 4

echo.
echo Server stopped.
pause

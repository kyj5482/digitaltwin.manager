# Windows 작업 스케줄러에 "매일 자동 커밋" 작업 등록 (서버를 항상 켜두지 않는 경우의 대안)
# 관리자 PowerShell에서 실행:  .\scripts\register-task.ps1
# 해제:  schtasks /Delete /TN "NorthPole-AutoCommit" /F
$root = Split-Path $PSScriptRoot -Parent
$cmd  = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\autocommit.ps1`""
schtasks /Create /TN "NorthPole-AutoCommit" /SC DAILY /ST 23:50 /TR $cmd /F
Write-Host "등록 완료 — 매일 23:50에 데이터 변경분을 자동 커밋·푸시합니다."

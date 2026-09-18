# AI/Data North Pole — 데이터 변경분 즉시 커밋·푸시 (서버 미실행 시 대안)
# 사용: PowerShell에서  .\scripts\autocommit.ps1
Set-Location (Split-Path $PSScriptRoot -Parent)
node server.js --commit-now
